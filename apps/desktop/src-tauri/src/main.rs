#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_storage;
mod file_io;
mod layout_cache;
mod layout_service;
mod native_bridge;
mod telemetry;
mod userscript;
mod window_opacity;

use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::Manager;

struct Bridge {
    client: reqwest::Client,
    token_path: PathBuf,
    native: Option<Arc<native_bridge::NativeBridge>>,
}

impl Bridge {
    fn install_url(&self) -> String {
        self.native
            .as_ref()
            .map(|native| native.install_url())
            .unwrap_or_else(|| "http://127.0.0.1:4317/install.user.js".into())
    }

    fn userscript(&self) -> Result<String, String> {
        if let Some(native) = &self.native {
            return Ok(native.userscript());
        }
        let script = std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../dist/userscript/dev.user.js"))
            .map_err(|_| "The development userscript is unavailable. Start npm run dev or npm run dev:desktop first.".to_string())?;
        if !script.starts_with("// ==UserScript==") || script.len() > 8 * 1024 * 1024 {
            return Err("The development userscript is invalid. Restart npm run dev.".into());
        }
        Ok(script)
    }

    async fn request(
        &self,
        method: reqwest::Method,
        route: &'static str,
        query: &[(String, String)],
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        if let Some(native) = &self.native {
            return native.dispatch(method.as_str(), route, query, body.as_ref());
        }
        let token = std::fs::read_to_string(&self.token_path)
            .map_err(|_| "Start the development bridge with npm run dev first.".to_string())?;
        let token = token.trim();
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("The local bridge token is invalid.".to_string());
        }
        // Callers below select fixed endpoints. No arbitrary URL or local token is
        // exposed to the web frontend; query parameters are encoded by reqwest.
        let mut request = self
            .client
            .request(method, format!("http://127.0.0.1:4317{route}"))
            .query(query)
            .header("X-DigDig-Token", token);
        if let Some(value) = body {
            if serde_json::to_vec(&value)
                .map_err(|_| "Invalid bridge request.".to_string())?
                .len()
                > 64 * 1024 * 1024
            {
                return Err("Bridge request exceeds the 64 MiB limit.".to_string());
            }
            request = request.json(&value);
        }
        let mut response = request.send().await.map_err(|_| {
            "Bridge offline. Start npm run dev, then keep the game tab open.".to_string()
        })?;
        let status = response.status();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Could not read bridge telemetry.".to_string())?
        {
            // The bridge caps all sessions at 2,048 tiles. Normal incremental
            // responses are much smaller than this full-snapshot limit.
            if bytes.len() + chunk.len() > 64 * 1024 * 1024 {
                return Err("Bridge telemetry exceeded the viewer limit.".to_string());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "The bridge returned invalid telemetry.".to_string())?;
        if !status.is_success() {
            return Err(value
                .get("error")
                .and_then(|value| value.as_str())
                .filter(|message| message.len() <= 1024)
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    format!(
                        "Bridge returned HTTP {}. Restart it after updating the source.",
                        status.as_u16()
                    )
                }));
        }
        Ok(value)
    }
}

#[tauri::command]
async fn read_telemetry(
    bridge: tauri::State<'_, Bridge>,
    since: Option<u64>,
    server_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut query = Vec::new();
    if let Some(revision) = since {
        query.push(("since".to_string(), revision.to_string()));
    }
    if let Some(id) = server_id {
        if id.len() > 80 {
            return Err("Invalid bridge identity.".to_string());
        }
        query.push(("serverId".to_string(), id));
    }
    bridge
        .request(reqwest::Method::GET, "/telemetry", &query, None)
        .await
}

#[tauri::command]
async fn read_settings(bridge: tauri::State<'_, Bridge>) -> Result<serde_json::Value, String> {
    bridge
        .request(reqwest::Method::GET, "/settings", &[], None)
        .await
}

#[tauri::command]
async fn update_settings(
    bridge: tauri::State<'_, Bridge>,
    update_interval_ms: Option<u16>,
    show_notifications: Option<bool>,
    auto_reconnect: Option<bool>,
    always_on_top: Option<bool>,
    window_opacity: Option<f64>,
) -> Result<serde_json::Value, String> {
    let patch = settings_patch(
        update_interval_ms,
        show_notifications,
        auto_reconnect,
        always_on_top,
        window_opacity,
    )?;
    bridge
        .request(reqwest::Method::POST, "/settings", &[], Some(patch))
        .await
}

fn settings_patch(
    update_interval_ms: Option<u16>,
    show_notifications: Option<bool>,
    auto_reconnect: Option<bool>,
    always_on_top: Option<bool>,
    window_opacity: Option<f64>,
) -> Result<serde_json::Value, String> {
    let mut patch = serde_json::Map::new();
    if let Some(interval) = update_interval_ms {
        if ![20, 100, 250, 500, 1000].contains(&interval) {
            return Err("Choose an update interval of 20, 100, 250, 500, or 1000 ms.".to_string());
        }
        patch.insert("updateIntervalMs".to_string(), interval.into());
    }
    for (key, value) in [
        ("showNotifications", show_notifications),
        ("autoReconnect", auto_reconnect),
        ("alwaysOnTop", always_on_top),
    ] {
        if let Some(enabled) = value {
            patch.insert(key.to_string(), enabled.into());
        }
    }
    if let Some(opacity) = window_opacity {
        if !opacity.is_finite() || !(0.2..=1.0).contains(&opacity) {
            return Err("Choose a window opacity from 20% to 100%.".to_string());
        }
        patch.insert("windowOpacity".to_string(), opacity.into());
    }
    if patch.is_empty() {
        return Err("Choose a setting to update.".to_string());
    }
    Ok(patch.into())
}

#[tauri::command]
fn set_window_always_on_top(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| format!("Could not change always on top: {error}"))
}

#[tauri::command]
async fn cleanup_sessions(bridge: tauri::State<'_, Bridge>) -> Result<serde_json::Value, String> {
    bridge
        .request(
            reqwest::Method::POST,
            "/telemetry/cleanup",
            &[],
            Some(serde_json::json!({})),
        )
        .await
}

#[tauri::command]
async fn clear_chunks(
    bridge: tauri::State<'_, Bridge>,
    client_id: String,
) -> Result<serde_json::Value, String> {
    validate_client_id(&client_id)?;
    bridge
        .request(
            reqwest::Method::POST,
            "/telemetry/clear",
            &[],
            Some(serde_json::json!({ "clientId": client_id })),
        )
        .await
}

fn validate_client_id(client_id: &str) -> Result<(), String> {
    if client_id.is_empty()
        || client_id.len() > 80
        || !client_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid browser session.".to_string());
    }
    Ok(())
}

fn validate_item_ids(ids: &[String], limit: usize) -> Result<(), String> {
    if ids.len() > limit
        || ids.iter().any(|id| {
            id.is_empty()
                || id.len() > 128
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.:,-".contains(&b))
        })
    {
        return Err("Invalid map selection.".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn merge_chunks(
    bridge: tauri::State<'_, Bridge>,
    client_id: String,
    document: serde_json::Value,
) -> Result<serde_json::Value, String> {
    validate_client_id(&client_id)?;
    file_io::validate_chunks(&document.to_string())?;
    bridge
        .request(
            reqwest::Method::POST,
            "/telemetry/merge",
            &[],
            Some(serde_json::json!({ "clientId": client_id, "document": document })),
        )
        .await
}

#[tauri::command]
async fn delete_map_items(
    bridge: tauri::State<'_, Bridge>,
    client_id: String,
    tile_keys: Vec<String>,
    marker_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    validate_client_id(&client_id)?;
    validate_item_ids(&tile_keys, 2048)?;
    validate_item_ids(&marker_ids, 512)?;
    bridge
        .request(
            reqwest::Method::POST,
            "/telemetry/delete",
            &[],
            Some(serde_json::json!({ "clientId": client_id, "tileKeys": tile_keys, "markerIds": marker_ids })),
        )
        .await
}

#[tauri::command]
async fn upsert_marker(
    bridge: tauri::State<'_, Bridge>,
    client_id: String,
    marker: serde_json::Value,
) -> Result<serde_json::Value, String> {
    validate_client_id(&client_id)?;
    file_io::validate_marker(&marker)?;
    bridge
        .request(
            reqwest::Method::POST,
            "/telemetry/markers",
            &[],
            Some(serde_json::json!({ "clientId": client_id, "marker": marker })),
        )
        .await
}

fn main() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2500))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .expect("Could not create the local bridge client");
    let result = tauri::Builder::default()
        .setup(move |app| {
            let storage = if cfg!(debug_assertions) {
                let mut workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                for _ in 0..3 {
                    workspace.pop();
                }
                app_storage::AppStorage::development(&workspace)
            } else {
                app_storage::AppStorage::standalone(app.path().app_local_data_dir()?)
            };
            let token_path = storage.directory().join("dev-token");
            let native = if cfg!(debug_assertions) {
                None
            } else {
                let directory = storage.directory().to_path_buf();
                Some(
                    native_bridge::NativeBridge::start(directory, storage.layout_cache.clone())
                        .map_err(std::io::Error::other)?,
                )
            };
            app.manage(storage);
            app.manage(Bridge {
                client,
                token_path,
                native,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_telemetry,
            read_settings,
            update_settings,
            set_window_always_on_top,
            window_opacity::set_window_opacity,
            window_opacity::window_opacity_supported,
            cleanup_sessions,
            clear_chunks,
            merge_chunks,
            delete_map_items,
            upsert_marker,
            file_io::save_chunks_file,
            file_io::load_chunks_file,
            file_io::save_png_file,
            userscript::userscript_info,
            userscript::read_userscript,
            userscript::install_userscript,
            userscript::copy_userscript,
            userscript::export_userscript,
            app_storage::app_storage_info,
            app_storage::open_app_data_directory,
            layout_service::take_layout_job,
            layout_service::finish_layout_job
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        rfd::MessageDialog::new()
            .set_title("DigDig Map Observatory could not start")
            .set_description(error.to_string())
            .set_level(rfd::MessageLevel::Error)
            .show();
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::settings_patch;

    #[test]
    fn settings_patch_preserves_explicit_false_and_omits_untouched_preferences() {
        assert_eq!(
            settings_patch(None, Some(false), None, None, None).unwrap(),
            serde_json::json!({ "showNotifications": false })
        );
        assert_eq!(
            settings_patch(Some(20), None, Some(false), Some(true), None).unwrap(),
            serde_json::json!({ "updateIntervalMs": 20, "autoReconnect": false, "alwaysOnTop": true })
        );
    }

    #[test]
    fn settings_patch_rejects_invalid_intervals_and_empty_updates() {
        assert!(settings_patch(Some(21), Some(true), None, None, None).is_err());
        assert!(settings_patch(None, None, None, None, None).is_err());
        for interval in [20, 100, 250, 500, 1000] {
            assert!(settings_patch(Some(interval), None, None, None, None).is_ok());
        }
    }

    #[test]
    fn settings_patch_accepts_only_visible_finite_opacity() {
        for opacity in [0.2, 0.57, 1.0] {
            assert_eq!(
                settings_patch(None, None, None, None, Some(opacity)).unwrap(),
                serde_json::json!({ "windowOpacity": opacity })
            );
        }
        for opacity in [0.0, 0.19, 1.01, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(settings_patch(None, None, None, None, Some(opacity)).is_err());
        }
    }
}
