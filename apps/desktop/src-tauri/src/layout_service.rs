//! Bounded discovery jobs and per-client validation tickets. Original module
//! bytes are inspected by the desktop worker, never executed by this service.
use crate::layout_cache::{CacheEntry, LayoutCache, LayoutRecipe, SCHEMA_VERSION};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub const RESOLVER_VERSION: &str = "wasm-patterns-1";
pub const MAX_WASM_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_LAYOUT_BODY: usize = 12 * 1024 * 1024;
const MAX_JOBS: usize = 8;
const MAX_TICKETS: usize = 128;
const TTL_MS: u64 = 10 * 60 * 1000;
const JOB_TIMEOUT_MS: u64 = 45 * 1000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn opaque_id() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| "Could not identify a layout request.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn hash_ok(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn object_keys(value: &Value, allowed: &[&str]) -> Result<(), String> {
    if !value
        .as_object()
        .is_some_and(|map| map.keys().all(|key| allowed.contains(&key.as_str())))
    {
        return Err("Unsupported layout request fields.".into());
    }
    Ok(())
}
fn identity(body: &Value) -> Result<(&str, &str), String> {
    let client = body["clientId"].as_str().ok_or("Missing layout client.")?;
    crate::validate_client_id(client)?;
    let hash = body["wasmSha256"]
        .as_str()
        .filter(|hash| hash_ok(hash))
        .ok_or("Invalid WASM SHA-256.")?;
    Ok((client, hash))
}
fn evidence(value: Option<&Value>) -> Result<Value, String> {
    let value = value.cloned().unwrap_or_else(|| json!({}));
    if !value.is_object()
        || serde_json::to_vec(&value)
            .map_err(|_| "Invalid resolver evidence.")?
            .len()
            > 16 * 1024
    {
        return Err("Resolver evidence must be a bounded object.".into());
    }
    Ok(value)
}

enum Analysis {
    Queued(String),
    Running,
    Candidate {
        layout: LayoutRecipe,
        evidence: Value,
        origin: &'static str,
        cached: bool,
    },
    Unsupported {
        message: String,
        evidence: Value,
    },
}
struct Job {
    id: String,
    created: u64,
    touched: u64,
    analysis: Analysis,
}
struct Ticket {
    client: String,
    hash: String,
    touched: u64,
}
#[derive(Default)]
struct State {
    jobs: HashMap<String, Job>,
    tickets: HashMap<String, Ticket>,
}

pub struct LayoutService {
    cache: Arc<LayoutCache>,
    state: Mutex<State>,
}
impl LayoutService {
    pub fn new(cache: Arc<LayoutCache>) -> Self {
        Self {
            cache,
            state: Mutex::new(State::default()),
        }
    }

    fn prune(state: &mut State, now: u64) {
        state
            .jobs
            .retain(|_, job| now.saturating_sub(job.touched) <= TTL_MS);
        for job in state.jobs.values_mut() {
            if matches!(job.analysis, Analysis::Queued(_) | Analysis::Running)
                && now.saturating_sub(job.created) > JOB_TIMEOUT_MS
            {
                job.analysis = Analysis::Unsupported {
                    message: "WASM analysis timed out. Restart the desktop app to retry.".into(),
                    evidence: json!({"reason":"timeout"}),
                };
            }
        }
        state.tickets.retain(|_, ticket| {
            now.saturating_sub(ticket.touched) <= TTL_MS && state.jobs.contains_key(&ticket.hash)
        });
    }

    pub fn resolve(&self, body: &Value) -> Result<Value, String> {
        object_keys(body, &["clientId", "wasmSha256", "wasmBase64"])?;
        let (client, hash) = identity(body)?;
        let encoded = match body.get("wasmBase64") {
            None => None,
            Some(value) => Some(
                value
                    .as_str()
                    .filter(|value| value.len() <= MAX_WASM_BYTES.div_ceil(3) * 4)
                    .ok_or("WASM upload exceeds the 8 MiB limit or is not base64 text.")?,
            ),
        };
        let now = now_ms();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Layout discovery is unavailable.")?;
        Self::prune(&mut state, now);
        if !state.jobs.contains_key(hash) {
            if state.jobs.len() >= MAX_JOBS {
                return Err(
                    "Too many layout builds are being retained. Retry after old requests expire."
                        .into(),
                );
            }
            // Cache failure is nonfatal: discovery can still proceed in memory.
            if let Some(entry) = self.cache.get(hash, RESOLVER_VERSION).unwrap_or(None) {
                state.jobs.insert(
                    hash.to_owned(),
                    Job {
                        id: opaque_id()?,
                        created: now,
                        touched: now,
                        analysis: Analysis::Candidate {
                            layout: entry.layout,
                            evidence: json!({"cached":true}),
                            origin: "cache",
                            cached: true,
                        },
                    },
                );
            } else if let Some(encoded) = encoded {
                let bytes = STANDARD
                    .decode(encoded)
                    .map_err(|_| "WASM upload is not valid base64.")?;
                if bytes.len() < 8
                    || bytes.len() > MAX_WASM_BYTES
                    || bytes[..8] != [0, 97, 115, 109, 1, 0, 0, 0]
                {
                    return Err("Expected an original WASM module of at most 8 MiB.".into());
                }
                if format!("{:x}", Sha256::digest(&bytes)) != hash {
                    return Err("WASM upload does not match its SHA-256.".into());
                }
                state.jobs.insert(
                    hash.to_owned(),
                    Job {
                        id: opaque_id()?,
                        created: now,
                        touched: now,
                        analysis: Analysis::Queued(encoded.to_owned()),
                    },
                );
            } else {
                return Ok(json!({"status":"needs-bytes", "resolverVersion":RESOLVER_VERSION}));
            }
        }
        let candidate = {
            let job = state.jobs.get_mut(hash).unwrap();
            job.touched = now;
            match &job.analysis {
                Analysis::Queued(_) | Analysis::Running => {
                    return Ok(json!({"status":"pending", "resolverVersion":RESOLVER_VERSION}))
                }
                Analysis::Unsupported { message, evidence } => {
                    return Ok(
                        json!({"status":"unsupported", "resolverVersion":RESOLVER_VERSION,"message":message,"evidence":evidence}),
                    )
                }
                Analysis::Candidate {
                    layout,
                    evidence,
                    origin,
                    ..
                } => (layout.clone(), evidence.clone(), *origin),
            }
        };
        let existing = state
            .tickets
            .iter()
            .find(|(_, ticket)| ticket.client == client && ticket.hash == hash)
            .map(|(id, _)| id.clone());
        let ticket = if let Some(id) = existing {
            state.tickets.get_mut(&id).unwrap().touched = now;
            id
        } else {
            if state.tickets.len() >= MAX_TICKETS {
                return Err("Too many pending layout validation sessions.".into());
            }
            let id = opaque_id()?;
            state.tickets.insert(
                id.clone(),
                Ticket {
                    client: client.into(),
                    hash: hash.into(),
                    touched: now,
                },
            );
            id
        };
        Ok(
            json!({"status":"candidate","resolverVersion":RESOLVER_VERSION,"ticket":ticket,"origin":candidate.2,"layout":candidate.0,"evidence":candidate.1}),
        )
    }

    pub fn take_job(&self) -> Result<Value, String> {
        let now = now_ms();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Layout discovery is unavailable.")?;
        Self::prune(&mut state, now);
        if state
            .jobs
            .values()
            .any(|job| matches!(job.analysis, Analysis::Running))
        {
            return Ok(Value::Null);
        }
        let hash = state
            .jobs
            .iter()
            .filter(|(_, job)| matches!(job.analysis, Analysis::Queued(_)))
            .min_by_key(|(_, job)| job.created)
            .map(|(hash, _)| hash.clone());
        let Some(hash) = hash else {
            return Ok(Value::Null);
        };
        let job = state.jobs.get_mut(&hash).unwrap();
        let Analysis::Queued(bytes) = std::mem::replace(&mut job.analysis, Analysis::Running)
        else {
            unreachable!()
        };
        job.touched = now;
        Ok(json!({"id":job.id,"wasmSha256":hash,"wasmBase64":bytes}))
    }

    pub fn finish_job(&self, id: &str, result: &Value) -> Result<(), String> {
        if id.len() > 80 {
            return Err("Invalid layout job identity.".into());
        }
        object_keys(result, &["status", "layout", "evidence", "message"])?;
        if serde_json::to_vec(result)
            .map_err(|_| "Invalid resolver result.")?
            .len()
            > 64 * 1024
        {
            return Err("Resolver result is too large.".into());
        }
        let proof = evidence(result.get("evidence"))?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Layout discovery is unavailable.")?;
        Self::prune(&mut state, now_ms());
        let (hash, job) = state
            .jobs
            .iter_mut()
            .find(|(_, job)| job.id == id && matches!(job.analysis, Analysis::Running))
            .ok_or("Layout job expired or was already completed.")?;
        let analysis = match result["status"].as_str() {
            Some("candidate") => {
                let layout: LayoutRecipe = serde_json::from_value(result["layout"].clone())
                    .map_err(|_| "Resolver returned an invalid layout recipe.")?;
                let entry = CacheEntry {
                    schema_version: SCHEMA_VERSION,
                    wasm_sha256: hash.clone(),
                    resolver_version: RESOLVER_VERSION.into(),
                    resolved_at_unix_ms: now_ms(),
                    layout: layout.clone(),
                };
                if !entry.valid() {
                    return Err("Resolver returned an invalid layout recipe.".into());
                }
                Analysis::Candidate {
                    layout,
                    evidence: proof,
                    origin: "resolved",
                    cached: false,
                }
            }
            Some("unsupported") => Analysis::Unsupported {
                message: result["message"]
                    .as_str()
                    .filter(|message| !message.is_empty() && message.len() <= 1024)
                    .unwrap_or("No unique supported layout was resolved for this game build.")
                    .into(),
                evidence: proof,
            },
            _ => return Err("Unsupported resolver result status.".into()),
        };
        job.analysis = analysis;
        job.touched = now_ms();
        Ok(())
    }

    pub fn validate(&self, body: &Value) -> Result<Value, String> {
        object_keys(
            body,
            &[
                "clientId",
                "wasmSha256",
                "resolverVersion",
                "ticket",
                "evidence",
            ],
        )?;
        let (client, hash) = identity(body)?;
        if body["resolverVersion"].as_str() != Some(RESOLVER_VERSION) {
            return Err("Layout resolver version changed. Resolve the build again.".into());
        }
        let id = body["ticket"]
            .as_str()
            .filter(|id| id.len() <= 80)
            .ok_or("Missing layout validation ticket.")?;
        let proof = &body["evidence"];
        object_keys(proof, &["samples", "tiles"])?;
        if !proof["samples"]
            .as_u64()
            .is_some_and(|n| (3..=1_000_000).contains(&n))
            || !proof["tiles"]
                .as_u64()
                .is_some_and(|n| (2..=100_000).contains(&n))
        {
            return Err("A layout needs at least three runtime samples and two distinct terrain placements.".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Layout discovery is unavailable.")?;
        Self::prune(&mut state, now_ms());
        if !state
            .tickets
            .get(id)
            .is_some_and(|ticket| ticket.client == client && ticket.hash == hash)
        {
            return Err("Layout validation session expired or belongs to another client. Resolve the build again.".into());
        }
        let job = state
            .jobs
            .get_mut(hash)
            .ok_or("Layout validation session expired.")?;
        let Analysis::Candidate { layout, cached, .. } = &mut job.analysis else {
            return Err("Layout is not ready for runtime validation.".into());
        };
        if *cached {
            return Ok(json!({"cached":true}));
        }
        let entry = CacheEntry {
            schema_version: SCHEMA_VERSION,
            wasm_sha256: hash.into(),
            resolver_version: RESOLVER_VERSION.into(),
            resolved_at_unix_ms: now_ms(),
            layout: layout.clone(),
        };
        match self.cache.put_validated(&entry) {
            Ok(()) => {
                *cached = true;
                Ok(json!({"cached":true}))
            }
            Err(message) => Ok(json!({"cached":false,"message":message})),
        }
    }
}

#[tauri::command]
pub async fn take_layout_job(bridge: tauri::State<'_, crate::Bridge>) -> Result<Value, String> {
    let Some(native) = bridge.native.clone() else {
        return Ok(Value::Null);
    };
    tauri::async_runtime::spawn_blocking(move || native.layouts.take_job())
        .await
        .map_err(|_| "Could not request a layout job.".to_string())?
}

#[tauri::command]
pub async fn finish_layout_job(
    bridge: tauri::State<'_, crate::Bridge>,
    job_id: String,
    result: Value,
) -> Result<(), String> {
    let native = bridge
        .native
        .clone()
        .ok_or("Development layout jobs are processed by the Node bridge.")?;
    tauri::async_runtime::spawn_blocking(move || native.layouts.finish_job(&job_id, &result))
        .await
        .map_err(|_| "Could not complete a layout job.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const EMPTY_WASM: &[u8] = &[0, 97, 115, 109, 1, 0, 0, 0];

    fn layout() -> Value {
        // Reference metadata is used only to exercise transport/storage. The
        // synthetic empty module is never claimed to resolve these semantics.
        let source: Value =
            serde_json::from_str(include_str!("../../../../reports/current-game-layout.json"))
                .unwrap();
        let mut recipe = json!({});
        for key in [
            "memoryExport",
            "mapX",
            "mapY",
            "mapRadius",
            "cameraPointer",
            "cameraOffset",
            "cameraVtable",
            "scaleMode",
        ] {
            recipe[key] = source[key].clone();
        }
        for (key, field) in [
            ("cameraX", "x"),
            ("cameraY", "y"),
            ("cameraScale", "scale"),
            ("viewWidth", "width"),
            ("viewHeight", "height"),
        ] {
            recipe[key] = source["cameraFields"][field].clone();
        }
        recipe["terrain"] = source["terrain"].clone();
        recipe["terrain"]
            .as_object_mut()
            .unwrap()
            .remove("drawImageArguments");
        recipe["terrain"]["paletteProfile"] = "materials-v1".into();
        recipe
    }
    fn query() -> Value {
        json!({"clientId":"one", "wasmSha256":format!("{:x}",Sha256::digest(EMPTY_WASM))})
    }
    fn upload() -> Value {
        let mut value = query();
        value["wasmBase64"] = STANDARD.encode(EMPTY_WASM).into();
        value
    }
    fn service(root: &tempfile::TempDir) -> LayoutService {
        LayoutService::new(Arc::new(LayoutCache::new(root.path().join("layout-cache"))))
    }
    fn validation(candidate: &Value) -> Value {
        let mut value = query();
        value["resolverVersion"] = RESOLVER_VERSION.into();
        value["ticket"] = candidate["ticket"].clone();
        value["evidence"] = json!({"samples":3,"tiles":2});
        value
    }

    #[test]
    fn discovery_is_deduplicated_and_requires_bound_live_confirmation_before_persisting() {
        let root = tempfile::tempdir().unwrap();
        let first = service(&root);
        assert_eq!(first.resolve(&query()).unwrap()["status"], "needs-bytes");
        assert_eq!(first.resolve(&upload()).unwrap()["status"], "pending");
        let job = first.take_job().unwrap();
        assert_eq!(job["wasmBase64"], STANDARD.encode(EMPTY_WASM));
        assert_eq!(first.resolve(&upload()).unwrap()["status"], "pending");
        assert!(first.take_job().unwrap().is_null());
        first.finish_job(job["id"].as_str().unwrap(), &json!({"status":"candidate","layout":layout(),"evidence":{"coordinateCandidates":1}})).unwrap();
        assert!(!root.path().join("layout-cache").exists());
        let candidate = first.resolve(&query()).unwrap();
        assert_eq!(candidate["origin"], "resolved");
        assert_eq!(
            first.resolve(&query()).unwrap()["ticket"],
            candidate["ticket"]
        );
        let valid = validation(&candidate);
        for key in ["clientId", "wasmSha256", "resolverVersion", "ticket"] {
            let mut forged = valid.clone();
            forged[key] = if key == "wasmSha256" {
                "a".repeat(64).into()
            } else {
                "other".into()
            };
            assert!(first.validate(&forged).is_err(), "{key}");
        }
        let mut weak = valid.clone();
        weak["evidence"]["samples"] = 2.into();
        assert!(first.validate(&weak).is_err());
        let mut injected = valid.clone();
        injected["layout"] = layout();
        assert!(first.validate(&injected).is_err());
        assert_eq!(first.validate(&valid).unwrap(), json!({"cached":true}));
        let restarted = service(&root);
        let hit = restarted.resolve(&query()).unwrap();
        assert_eq!(hit["origin"], "cache");
        assert_eq!(
            serde_json::from_value::<LayoutRecipe>(hit["layout"].clone()).unwrap(),
            serde_json::from_value::<LayoutRecipe>(layout()).unwrap()
        );
        assert_ne!(hit["ticket"], candidate["ticket"]);
        assert!(restarted.take_job().unwrap().is_null());
        assert_eq!(
            restarted.validate(&validation(&hit)).unwrap()["cached"],
            true
        );
    }

    #[test]
    fn upload_limits_and_result_validation_do_not_accept_wrong_modules() {
        let root = tempfile::tempdir().unwrap();
        let service = service(&root);
        let mut wrong = upload();
        wrong["wasmSha256"] = "a".repeat(64).into();
        assert!(service.resolve(&wrong).is_err());
        for encoded in [
            "@".into(),
            STANDARD.encode(b"not wasm"),
            "A".repeat(MAX_WASM_BYTES.div_ceil(3) * 4 + 1),
        ] {
            wrong = query();
            wrong["wasmBase64"] = encoded.into();
            assert!(service.resolve(&wrong).is_err());
        }
        service.resolve(&upload()).unwrap();
        let job = service.take_job().unwrap();
        let mut invalid = layout();
        invalid["cameraOffset"] = u32::MAX.into();
        assert!(service
            .finish_job(
                job["id"].as_str().unwrap(),
                &json!({"status":"candidate","layout":invalid})
            )
            .is_err());
        service.finish_job(job["id"].as_str().unwrap(), &json!({"status":"unsupported","message":"Ambiguous coordinate candidates","evidence":{"count":2}})).unwrap();
        assert_eq!(service.resolve(&query()).unwrap()["status"], "unsupported");
        assert!(!root.path().join("layout-cache").exists());
        assert!(service
            .finish_job(
                job["id"].as_str().unwrap(),
                &json!({"status":"unsupported"})
            )
            .is_err());
    }

    #[test]
    fn corrupt_cache_is_a_miss_and_unavailable_cache_does_not_block_live_result() {
        let root = tempfile::tempdir().unwrap();
        let service = service(&root);
        std::fs::write(root.path().join("layout-cache"), "blocked folder").unwrap();
        assert_eq!(service.resolve(&query()).unwrap()["status"], "needs-bytes");
        service.resolve(&upload()).unwrap();
        let job = service.take_job().unwrap();
        service
            .finish_job(
                job["id"].as_str().unwrap(),
                &json!({"status":"candidate","layout":layout()}),
            )
            .unwrap();
        let candidate = service.resolve(&query()).unwrap();
        assert_eq!(
            service.validate(&validation(&candidate)).unwrap()["cached"],
            false
        );
        assert_eq!(service.resolve(&query()).unwrap()["status"], "candidate");
    }

    #[test]
    fn stale_jobs_expire_without_reusing_their_completion_or_tickets() {
        let root = tempfile::tempdir().unwrap();
        let service = service(&root);
        service.resolve(&upload()).unwrap();
        let job = service.take_job().unwrap();
        {
            let mut state = service.state.lock().unwrap();
            state.jobs.values_mut().next().unwrap().created = 1;
        }
        assert_eq!(service.resolve(&query()).unwrap()["status"], "unsupported");
        assert!(service
            .finish_job(
                job["id"].as_str().unwrap(),
                &json!({"status":"candidate","layout":layout()})
            )
            .is_err());
    }
}
