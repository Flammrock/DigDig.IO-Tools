//! The packaged app owns its bridge. Development keeps the existing Node watcher.
use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    net::{SocketAddr, TcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;

const PORT: u16 = 4319;
const MAX_BODY: usize = 1024 * 1024;
const MAX_MERGE_BODY: usize = 64 * 1024 * 1024;
pub const PAIRING_SENTINEL: &str = "__DIGDIG_PAIRING_TOKEN__";
const BUNDLED_SCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/digdig.user.js"));

struct NativeState {
    telemetry: crate::telemetry::TelemetryStore,
    settings: Value,
    capture_epoch: u64,
}

pub struct NativeBridge {
    pub(crate) layouts: crate::layout_service::LayoutService,
    state: Mutex<NativeState>,
    data_dir: PathBuf,
    token: String,
    server_id: String,
    script: String,
    port: u16,
}

fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Could not generate a local pairing token.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn persist(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing app data directory.")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create an app settings file.".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "Could not save app settings.".to_string())?;
    file.persist(path)
        .map_err(|_| "Could not replace app settings.".to_string())?;
    Ok(())
}

fn load_token(directory: &Path) -> Result<String, String> {
    let path = directory.join("bridge-token");
    match std::fs::read_to_string(&path) {
        Ok(token) if valid_token(token.trim()) => Ok(token.trim().to_owned()),
        Ok(_) => Err("The app pairing token is invalid. Restore the bridge-token file in the app data directory.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let token = random_id()?;
            // create_new prevents two app launches from replacing each other's token.
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)] {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(mut file) => {
                    file.write_all(token.as_bytes()).and_then(|_| file.sync_all())
                        .map_err(|_| "Could not persist the app pairing token.".to_string())?;
                    Ok(token)
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => load_token(directory),
                Err(_) => Err("Could not create the app pairing token.".into()),
            }
        }
        Err(_) => Err("Could not read the app pairing token.".into()),
    }
}

fn defaults() -> Value {
    json!({"updateIntervalMs":100,"showNotifications":false,"autoReconnect":true,"alwaysOnTop":false,"windowOpacity":1.0})
}

fn merge_settings(previous: &Value, patch: &Value) -> Result<Value, String> {
    let values = patch
        .as_object()
        .filter(|values| !values.is_empty())
        .ok_or("Provide one or more supported viewer settings.")?;
    let mut next = previous.clone();
    for (key, value) in values {
        match key.as_str() {
            "updateIntervalMs"
                if value
                    .as_u64()
                    .is_some_and(|value| [20, 100, 250, 500, 1000].contains(&value)) => {}
            "showNotifications" | "autoReconnect" | "alwaysOnTop" if value.is_boolean() => {}
            "windowOpacity"
                if value.as_f64().is_some_and(|opacity| {
                    opacity.is_finite() && (0.2..=1.0).contains(&opacity)
                }) => {}
            _ => return Err("Unsupported viewer setting or invalid value.".into()),
        }
        next[key] = value.clone();
    }
    Ok(next)
}

impl NativeBridge {
    pub fn start(
        data_dir: PathBuf,
        cache: Arc<crate::layout_cache::LayoutCache>,
    ) -> Result<Arc<Self>, String> {
        let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|_| {
            format!("Could not start the local app bridge on port {PORT}. Close another running DigDig desktop app or the program using that port, then try again.")
        })?;
        let bridge = Self::load_with_cache(data_dir, BUNDLED_SCRIPT, PORT, cache)?;
        Self::serve(bridge.clone(), listener)?;
        Ok(bridge)
    }

    fn load(data_dir: PathBuf, template: &str, port: u16) -> Result<Arc<Self>, String> {
        let cache = Arc::new(crate::layout_cache::LayoutCache::new(
            data_dir.join("layout-cache"),
        ));
        Self::load_with_cache(data_dir, template, port, cache)
    }

    fn load_with_cache(
        data_dir: PathBuf,
        template: &str,
        port: u16,
        cache: Arc<crate::layout_cache::LayoutCache>,
    ) -> Result<Arc<Self>, String> {
        if !template.starts_with("// ==UserScript==")
            || template.matches(PAIRING_SENTINEL).count() != 1
        {
            return Err("The bundled userscript is missing or invalid. Rebuild the app with npm run deploy.".into());
        }
        std::fs::create_dir_all(&data_dir)
            .map_err(|_| "Could not create the app data directory.".to_string())?;
        let token = load_token(&data_dir)?;
        let script = template.replace(PAIRING_SENTINEL, &token);
        let settings_path = data_dir.join("viewer-settings.json");
        let settings = match std::fs::read(&settings_path) {
            Ok(contents) => merge_settings(
                &defaults(),
                &serde_json::from_slice::<Value>(&contents)
                    .map_err(|_| "The app viewer-settings.json is invalid.".to_string())?,
            )?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => defaults(),
            Err(_) => return Err("Could not read the app settings.".into()),
        };
        Ok(Arc::new(Self {
            layouts: crate::layout_service::LayoutService::new(cache),
            state: Mutex::new(NativeState {
                telemetry: crate::telemetry::TelemetryStore::new(),
                settings,
                capture_epoch: 0,
            }),
            data_dir,
            token,
            server_id: random_id()?,
            script,
            port,
        }))
    }

    fn serve(bridge: Arc<Self>, listener: TcpListener) -> Result<(), String> {
        listener
            .set_nonblocking(true)
            .map_err(|_| "Could not configure the local bridge.".to_string())?;
        let listener =
            tauri::async_runtime::block_on(async { tokio::net::TcpListener::from_std(listener) })
                .map_err(|_| "Could not start the local bridge listener.".to_string())?;
        let router = Router::new().fallback(http_request).with_state(bridge);
        tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            {
                let message = format!("The app's local bridge stopped: {error}. Restart DigDig Map Observatory to reconnect the userscript.");
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    rfd::MessageDialog::new()
                        .set_title("DigDig local bridge stopped")
                        .set_description(message)
                        .set_level(rfd::MessageLevel::Error)
                        .show();
                })
                .await;
            }
        });
        Ok(())
    }

    pub fn install_url(&self) -> String {
        format!("http://127.0.0.1:{}/install.user.js", self.port)
    }
    pub fn userscript(&self) -> String {
        self.script.clone()
    }

    pub fn dispatch(
        &self,
        method: &str,
        route: &str,
        query: &[(String, String)],
        body: Option<&Value>,
    ) -> Result<Value, String> {
        if method == "POST" && route == "/layouts/resolve" {
            return self.layouts.resolve(body.ok_or("Missing layout request.")?);
        }
        if method == "POST" && route == "/layouts/validate" {
            return self
                .layouts
                .validate(body.ok_or("Missing layout validation.")?);
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "The native map store is unavailable.".to_string())?;
        match (method, route) {
            ("GET", "/settings") => {
                let mut settings = state.settings.clone();
                settings["serverId"] = self.server_id.clone().into();
                settings["captureEpoch"] = state.capture_epoch.into();
                Ok(settings)
            }
            ("POST", "/settings") => {
                let next =
                    merge_settings(&state.settings, body.ok_or("Missing viewer settings.")?)?;
                if next != state.settings {
                    persist(
                        &self.data_dir.join("viewer-settings.json"),
                        next.to_string().as_bytes(),
                    )?;
                    state.settings = next;
                }
                Ok(state.settings.clone())
            }
            ("GET", "/telemetry")
            | ("POST", "/telemetry/clear")
            | ("POST", "/telemetry/cleanup")
            | ("POST", "/telemetry/merge")
            | ("POST", "/telemetry/delete")
            | ("POST", "/telemetry/markers")
            | ("POST", "/reports") => {
                if route == "/reports"
                    && body
                        .and_then(|body| body.get("kind"))
                        .and_then(Value::as_str)
                        != Some("map-frame")
                {
                    return self.save_report(body.ok_or("Missing diagnostic report.")?);
                }
                let auto = state.settings["autoReconnect"].as_bool().unwrap_or(true);
                let query: Vec<_> = query
                    .iter()
                    .filter(|(key, _)| {
                        key != "since"
                            || query
                                .iter()
                                .any(|(key, value)| key == "serverId" && value == &self.server_id)
                    })
                    .cloned()
                    .collect();
                let mut value = state.telemetry.dispatch(route, body, &query, auto)?;
                if route == "/telemetry" {
                    value["serverId"] = self.server_id.clone().into();
                }
                if route == "/telemetry/clear" {
                    state.capture_epoch = state.capture_epoch.wrapping_add(1);
                }
                Ok(value)
            }
            _ => Err("Unknown local bridge endpoint.".into()),
        }
    }

    fn save_report(&self, body: &Value) -> Result<Value, String> {
        let client = body
            .get("clientId")
            .and_then(Value::as_str)
            .ok_or("Missing report client.")?;
        crate::validate_client_id(client)?;
        let kind = body
            .get("kind")
            .and_then(Value::as_str)
            .filter(|kind| {
                !kind.is_empty()
                    && kind.len() <= 80
                    && kind
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            })
            .ok_or("Invalid report kind.")?;
        if !body
            .get("report")
            .is_some_and(|value| value.is_object() || value.is_array() || value.is_string())
        {
            return Err("A report must contain an object or string.".into());
        }
        let directory = self.data_dir.join("reports");
        std::fs::create_dir_all(&directory)
            .map_err(|_| "Could not create the reports directory.".to_string())?;
        // Bound automatic diagnostic storage; terrain frames are never written here.
        let mut files: Vec<_> = std::fs::read_dir(&directory)
            .map_err(|_| "Could not inspect reports.".to_string())?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.file_name().to_string_lossy().starts_with("report-")
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "txt")
            })
            .collect();
        files.sort_by_key(|entry| entry.file_name());
        let excess = files.len().saturating_sub(127);
        for entry in files.into_iter().take(excess) {
            let _ = std::fs::remove_file(entry.path());
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let filename = format!("report-{stamp:013}-{kind}-{}.txt", &random_id()?[..8]);
        let report = serde_json::to_vec_pretty(body)
            .map_err(|_| "Invalid diagnostic report.".to_string())?;
        persist(&directory.join(&filename), &report)?;
        Ok(json!({"filename":filename}))
    }
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn host_allowed(headers: &HeaderMap, port: u16) -> bool {
    matches!(header_text(headers, "host"), Some(host) if host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}") || host == format!("[::1]:{port}"))
}

fn install_origin_allowed(headers: &HeaderMap, port: u16) -> bool {
    if header_text(headers, "sec-fetch-site")
        .is_some_and(|site| !["none", "same-origin"].contains(&site))
    {
        return false;
    }
    header_text(headers, "origin").is_none_or(|origin| {
        [
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
            format!("http://[::1]:{port}"),
        ]
        .contains(&origin.to_string())
    })
}

fn reply(status: StatusCode, contents: impl Into<Body>, content_type: &'static str) -> Response {
    let mut response = (status, contents.into()).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert(
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'"
            .parse()
            .unwrap(),
    );
    response
}

fn error_reply(status: StatusCode, message: &str) -> Response {
    reply(
        status,
        json!({"error":message}).to_string(),
        "application/json; charset=utf-8",
    )
}

async fn http_request(
    State(bridge): State<Arc<NativeBridge>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request<Body>,
) -> Response {
    if !peer.ip().is_loopback() || !host_allowed(request.headers(), bridge.port) {
        return error_reply(
            StatusCode::FORBIDDEN,
            "Host must name this loopback app bridge.",
        );
    }
    let method = request.method().clone();
    let route = request.uri().path().to_string();
    if method == Method::OPTIONS {
        return error_reply(
            StatusCode::FORBIDDEN,
            "Use the userscript manager; page-origin CORS is not enabled.",
        );
    }
    if method == Method::GET && route == "/health" {
        return reply(
            StatusCode::OK,
            json!({"ok":true,"serverId":bridge.server_id,"mode":"standalone"}).to_string(),
            "application/json; charset=utf-8",
        );
    }
    if method == Method::GET && ["/", "/install.user.js"].contains(&route.as_str()) {
        if !install_origin_allowed(request.headers(), bridge.port) {
            return error_reply(
                StatusCode::FORBIDDEN,
                "Open the install address directly in your browser.",
            );
        }
        return if route == "/install.user.js" {
            reply(
                StatusCode::OK,
                bridge.userscript(),
                "application/javascript; charset=utf-8",
            )
        } else {
            reply(StatusCode::OK, "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>DigDig Map Observatory</title><h1>DigDig Map Observatory</h1><p><a href=\"/install.user.js\">Install the paired userscript</a></p><p>Keep the desktop app running, install this script in Tampermonkey, then reload the game.</p></html>", "text/html; charset=utf-8")
        };
    }
    let provided = header_text(request.headers(), "x-digdig-token").unwrap_or("");
    if provided.len() != 64 || !bool::from(provided.as_bytes().ct_eq(bridge.token.as_bytes())) {
        return error_reply(
            StatusCode::UNAUTHORIZED,
            "A valid X-DigDig-Token header is required.",
        );
    }
    let query = reqwest::Url::parse(&format!(
        "http://127.0.0.1:{}{}",
        bridge.port,
        request.uri()
    ))
    .map(|url| {
        url.query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();
    let body = if method == Method::POST {
        if header_text(request.headers(), "content-type")
            .map(|value| value.split(';').next().unwrap_or("").trim())
            != Some("application/json")
        {
            return error_reply(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Content-Type must be application/json.",
            );
        }
        let maximum = if route == "/telemetry/merge" {
            MAX_MERGE_BODY
        } else if route == "/layouts/resolve" {
            crate::layout_service::MAX_LAYOUT_BODY
        } else {
            MAX_BODY
        };
        if header_text(request.headers(), "content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|length| length > maximum)
        {
            return error_reply(
                StatusCode::PAYLOAD_TOO_LARGE,
                "The request exceeds the bridge size limit.",
            );
        }
        let bytes = match tokio::time::timeout(
            Duration::from_secs(5),
            to_bytes(request.into_body(), maximum),
        )
        .await
        {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(_)) => {
                return error_reply(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "The request exceeds the bridge size limit.",
                )
            }
            Err(_) => {
                return error_reply(StatusCode::REQUEST_TIMEOUT, "The local request timed out.")
            }
        };
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) if value.is_object() => Some(value),
            _ => {
                return error_reply(
                    StatusCode::BAD_REQUEST,
                    "Request body must be a JSON object.",
                )
            }
        }
    } else {
        None
    };
    // Validation, shared-map updates, and settings persistence use the exact same
    // dispatch path for IPC and HTTP, so the webview never handles bridge secrets.
    let result = tauri::async_runtime::spawn_blocking(move || {
        bridge.dispatch(method.as_str(), &route, &query, body.as_ref())
    })
    .await;
    match result {
        Ok(Ok(value)) => reply(
            StatusCode::OK,
            value.to_string(),
            "application/json; charset=utf-8",
        ),
        Ok(Err(error)) => error_reply(StatusCode::BAD_REQUEST, &error),
        Err(_) => error_reply(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The local bridge could not complete the request.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const TEMPLATE: &str = "// ==UserScript==\n// @name Test\n// ==/UserScript==\nconst token='__DIGDIG_PAIRING_TOKEN__';";

    #[test]
    fn personalized_script_and_settings_persist_per_installation() {
        let directory = tempfile::tempdir().unwrap();
        let first = NativeBridge::load(directory.path().into(), TEMPLATE, 4319).unwrap();
        assert!(valid_token(&first.token));
        assert!(!first.userscript().contains(PAIRING_SENTINEL));
        first
            .dispatch(
                "POST",
                "/settings",
                &[],
                Some(&json!({"updateIntervalMs":20,"autoReconnect":false})),
            )
            .unwrap();
        let second = NativeBridge::load(directory.path().into(), TEMPLATE, 4319).unwrap();
        assert_eq!(first.token, second.token);
        assert_ne!(first.server_id, second.server_id);
        assert_eq!(
            second.dispatch("GET", "/settings", &[], None).unwrap()["updateIntervalMs"],
            20
        );
        assert_eq!(
            second.dispatch("GET", "/settings", &[], None).unwrap()["autoReconnect"],
            false
        );
        assert!(second
            .dispatch(
                "POST",
                "/settings",
                &[],
                Some(&json!({"updateIntervalMs":21}))
            )
            .is_err());
        assert!(second
            .dispatch("POST", "/settings", &[], Some(&json!({"serverId":"spoof"})))
            .is_err());
    }

    #[test]
    fn opacity_migrates_defaults_persists_and_does_not_reset_capture() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("viewer-settings.json"),
            r#"{"updateIntervalMs":20,"alwaysOnTop":true}"#,
        )
        .unwrap();
        let bridge = NativeBridge::load(directory.path().into(), TEMPLATE, 4319).unwrap();
        let initial = bridge.dispatch("GET", "/settings", &[], None).unwrap();
        assert_eq!(initial["windowOpacity"], 1.0);
        for opacity in [0.2, 0.57, 1.0] {
            bridge
                .dispatch(
                    "POST",
                    "/settings",
                    &[],
                    Some(&json!({"windowOpacity":opacity})),
                )
                .unwrap();
            let reloaded = NativeBridge::load(directory.path().into(), TEMPLATE, 4319).unwrap();
            let settings = reloaded.dispatch("GET", "/settings", &[], None).unwrap();
            assert_eq!(settings["windowOpacity"], opacity);
            assert_eq!(settings["updateIntervalMs"], 20);
            assert_eq!(settings["alwaysOnTop"], true);
            assert_eq!(
                bridge.dispatch("GET", "/settings", &[], None).unwrap()["captureEpoch"],
                initial["captureEpoch"]
            );
        }
        for opacity in [
            json!(0),
            json!(0.19),
            json!(1.01),
            json!("0.5"),
            json!(null),
            json!(true),
        ] {
            assert!(bridge
                .dispatch(
                    "POST",
                    "/settings",
                    &[],
                    Some(&json!({"windowOpacity":opacity}))
                )
                .is_err());
        }
    }

    #[test]
    fn host_and_install_origin_checks_reject_web_pages_and_rebinding() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "127.0.0.1:4319".parse().unwrap());
        assert!(host_allowed(&headers, 4319));
        assert!(install_origin_allowed(&headers, 4319));
        headers.insert("host", "example.com:4319".parse().unwrap());
        assert!(!host_allowed(&headers, 4319));
        headers.insert("origin", "https://digdig.io".parse().unwrap());
        assert!(!install_origin_allowed(&headers, 4319));
        headers.remove("origin");
        headers.insert("sec-fetch-site", "cross-site".parse().unwrap());
        assert!(!install_origin_allowed(&headers, 4319));
        headers.insert("sec-fetch-site", "none".parse().unwrap());
        assert!(install_origin_allowed(&headers, 4319));
    }

    #[test]
    fn native_http_bridge_authenticates_captures_and_rejects_cross_origin_installs() {
        tauri::async_runtime::block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .unwrap();
            let port = listener.local_addr().unwrap().port();
            let bridge = NativeBridge::load(directory.path().into(), TEMPLATE, port).unwrap();
            let router = Router::new()
                .fallback(http_request)
                .with_state(bridge.clone());
            let server = tokio::spawn(async move {
                axum::serve(
                    listener,
                    router.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
                .unwrap();
            });
            let client = reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            let base = format!("http://127.0.0.1:{port}");
            let get = |route: &str| client.get(format!("{base}{route}"));
            let post = |route: &str| {
                client
                    .post(format!("{base}{route}"))
                    .header("X-DigDig-Token", &bridge.token)
            };
            assert_eq!(get("/settings").send().await.unwrap().status(), 401);
            assert_eq!(get("/layouts/resolve").send().await.unwrap().status(), 401);
            assert_eq!(
                get("/health")
                    .header("Host", "example.com")
                    .send()
                    .await
                    .unwrap()
                    .status(),
                403
            );
            assert_eq!(
                get("/install.user.js")
                    .header("Origin", "https://digdig.io")
                    .send()
                    .await
                    .unwrap()
                    .status(),
                403
            );
            assert_eq!(
                get("/install.user.js")
                    .header("Sec-Fetch-Site", "cross-site")
                    .send()
                    .await
                    .unwrap()
                    .status(),
                403
            );
            let install = get("/install.user.js")
                .header("Sec-Fetch-Site", "none")
                .send()
                .await
                .unwrap();
            assert_eq!(install.status(), 200);
            assert!(!install
                .headers()
                .contains_key("Access-Control-Allow-Origin"));
            assert_eq!(install.text().await.unwrap(), bridge.userscript());
            assert_eq!(
                client
                    .request(reqwest::Method::OPTIONS, format!("{base}/reports"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                403
            );
            let settings: Value = get("/settings")
                .header("X-DigDig-Token", &bridge.token)
                .header("Origin", "https://digdig.io")
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(settings["updateIntervalMs"], 100);
            assert_eq!(settings["serverId"], bridge.server_id);
            assert_eq!(settings["captureEpoch"], 0);
            assert_eq!(
                post("/settings").body("{}").send().await.unwrap().status(),
                415
            );
            assert_eq!(
                post("/settings")
                    .header("Content-Type", "application/json")
                    .body("not json")
                    .send()
                    .await
                    .unwrap()
                    .status(),
                400
            );
            assert_eq!(
                post("/reports")
                    .header("Content-Type", "application/json")
                    .body(vec![b' '; MAX_BODY + 1])
                    .send()
                    .await
                    .unwrap()
                    .status(),
                413
            );
            let empty_module = [0u8, 97, 115, 109, 1, 0, 0, 0];
            let module_hash = {
                use sha2::Digest;
                format!("{:x}", sha2::Sha256::digest(empty_module))
            };
            let discovery = post("/layouts/resolve")
                .json(&json!({"clientId":"native-layout-test", "wasmSha256":module_hash}))
                .send()
                .await
                .unwrap();
            assert_eq!(discovery.status(), 200);
            assert_eq!(
                discovery.json::<Value>().await.unwrap()["status"],
                "needs-bytes"
            );
            assert_eq!(
                post("/layouts/resolve")
                    .header("Content-Type", "application/json")
                    .header(
                        "Content-Length",
                        (crate::layout_service::MAX_LAYOUT_BODY + 1).to_string()
                    )
                    .body("")
                    .send()
                    .await
                    .unwrap()
                    .status(),
                413
            );
            let mut module = empty_module.to_vec();
            module.push(0); // Independently authored custom section, no code.
            let mut remaining = MAX_BODY + 1;
            loop {
                let mut byte = (remaining & 127) as u8;
                remaining >>= 7;
                if remaining != 0 {
                    byte |= 128;
                }
                module.push(byte);
                if remaining == 0 {
                    break;
                }
            }
            module.push(0); // Empty custom-section name.
            module.extend(vec![0; MAX_BODY]);
            let large_hash = {
                use sha2::Digest;
                format!("{:x}", sha2::Sha256::digest(&module))
            };
            let encoded = {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(&module)
            };
            let large = post("/layouts/resolve").json(&json!({"clientId":"native-layout-test", "wasmSha256":large_hash,"wasmBase64":encoded})).send().await.unwrap();
            assert_eq!(large.status(), 200);
            assert_eq!(large.json::<Value>().await.unwrap()["status"], "pending");
            assert!(!bridge.layouts.take_job().unwrap().is_null());
            let frame = json!({
                "clientId":"native-http-test", "kind":"map-frame", "report":{
                    "version":1, "source":"game", "status":"live", "message":"Synthetic native integration test",
                    "buildHash":"a".repeat(64), "capturedAt":"2026-10-24T12:00:00.000Z", "terrainMode":"materials-v1",
                    "world":{"centerX":0,"centerY":0,"radius":400},
                    "player":{"x":0,"y":0,"normalizedX":0,"normalizedY":0},
                    "camera":{"x":0,"y":0,"scale":1,"width":800,"height":600},
                    "tiles":[{"key":"test-tile","x":0,"y":0,"width":64,"height":64,"pixelWidth":1,"pixelHeight":1,"rgba":"eEQA/w=="}]
                }
            });
            let capture = post("/reports").json(&frame).send().await.unwrap();
            let status = capture.status();
            let response = capture.text().await.unwrap();
            assert_eq!(status, 200, "{response}");
            let telemetry: Value = get("/telemetry")
                .header("X-DigDig-Token", &bridge.token)
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(telemetry["serverId"], bridge.server_id);
            assert_eq!(
                telemetry["clients"][0]["tiles"].as_array().unwrap().len(),
                1
            );
            assert_eq!(telemetry["clients"][0]["mapId"], "game-shared");
            assert_eq!(
                post("/settings")
                    .json(&json!({"updateIntervalMs":20}))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                200
            );
            assert_eq!(
                post("/telemetry/clear")
                    .json(&json!({"clientId":"native-http-test"}))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                200
            );
            let settings = bridge.dispatch("GET", "/settings", &[], None).unwrap();
            assert_eq!(settings["updateIntervalMs"], 20);
            assert_eq!(settings["captureEpoch"], 1);
            server.abort();
            let _ = server.await;
        });
    }
}
