use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
const MAX_TILES: usize = 2048;

pub(crate) fn validate_marker(marker: &serde_json::Value) -> Result<(), String> {
    let valid_id = marker.get("id").and_then(|v| v.as_str()).is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.:,-".contains(&b))
    });
    let valid_label = marker
        .get("label")
        .and_then(|v| v.as_str())
        .is_some_and(|label| {
            let label = label.trim();
            !label.is_empty()
                && label.encode_utf16().count() <= 240
                && !label.chars().any(|c| c <= '\u{001f}' || c == '\u{007f}')
        });
    let valid_coordinates = ["x", "y"].iter().all(|key| {
        marker
            .get(key)
            .and_then(|v| v.as_f64())
            .is_some_and(|value| value.is_finite() && value.abs() <= 1e9)
    });
    if !valid_id || !valid_label || !valid_coordinates {
        return Err("Marker needs an ID, finite map coordinates, and a label of 1–240 printable characters.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_chunks(contents: &str) -> Result<(), String> {
    if contents.len() > MAX_FILE_BYTES {
        return Err("Chunks file exceeds the 64 MiB limit.".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(contents.trim_start_matches('\u{feff}'))
        .map_err(|_| "The selected file is not valid .chunks JSON.".to_string())?;
    if value.get("format").and_then(|v| v.as_str()) != Some("digdig-chunks")
        || value.get("version").and_then(|v| v.as_u64()) != Some(1)
        || !value.get("source").is_some_and(|v| v.is_object())
        || !value
            .get("tiles")
            .and_then(|v| v.as_array())
            .is_some_and(|v| v.len() <= MAX_TILES)
    {
        return Err("Unsupported .chunks format, version, or tile count.".to_string());
    }
    if let Some(markers) = value.get("markers") {
        let markers = markers
            .as_array()
            .filter(|markers| markers.len() <= 512)
            .ok_or_else(|| "A chunks file may contain at most 512 markers.".to_string())?;
        let mut ids = std::collections::HashSet::new();
        for marker in markers {
            validate_marker(marker)?;
            if !ids.insert(marker.get("id").and_then(|id| id.as_str()).unwrap()) {
                return Err("Chunks file contains duplicate marker IDs.".to_string());
            }
        }
    }
    // Geometry/base64/coverage validation is shared with the browser importer.
    Ok(())
}

fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err("PNG exceeds the 64 MiB export limit.".to_string());
    }
    if bytes.len() < 33 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("The export is not a PNG image.".to_string());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 32 * 1024 * 1024
    {
        return Err("PNG dimensions exceed the export limit.".to_string());
    }
    Ok(())
}

fn extension(mut path: PathBuf, wanted: &str) -> Result<PathBuf, String> {
    if path.extension().is_none() {
        path.set_extension(wanted);
    }
    if !path
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.eq_ignore_ascii_case(wanted))
    {
        return Err(format!("Choose a .{wanted} file."));
    }
    Ok(path)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The selected location has no parent directory.".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create a temporary file at the selected location.".to_string())?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| {
            "Could not finish writing the file. The previous file was kept.".to_string()
        })?;
    temporary.persist(path).map_err(|_| {
        "Could not replace the selected file. The previous file was kept.".to_string()
    })?;
    Ok(())
}

fn read_chunks(path: &Path) -> Result<String, String> {
    let file =
        File::open(path).map_err(|_| "Could not open the selected chunks file.".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "Could not inspect the selected file.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES as u64 {
        return Err("Select a regular .chunks file of at most 64 MiB.".to_string());
    }
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the selected chunks file.".to_string())?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("Chunks file exceeds the 64 MiB limit.".to_string());
    }
    let contents =
        String::from_utf8(bytes).map_err(|_| "Chunks files must use UTF-8 text.".to_string())?;
    validate_chunks(&contents)?;
    Ok(contents)
}

#[tauri::command]
pub async fn save_chunks_file(
    window: tauri::WebviewWindow,
    contents: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_chunks(&contents)?;
        let selected = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Save captured chunks")
            .add_filter("DigDig chunks", &["chunks"])
            .set_file_name("digdig-map.chunks")
            .save_file();
        let Some(path) = selected else {
            return Ok(None);
        };
        let path = extension(path, "chunks")?;
        atomic_write(&path, contents.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "The save dialog could not complete.".to_string())?
}

#[tauri::command]
pub async fn load_chunks_file(
    window: tauri::WebviewWindow,
) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Load captured chunks")
            .add_filter("DigDig chunks", &["chunks"])
            .pick_file();
        let Some(path) = selected else {
            return Ok(None);
        };
        let path = extension(path, "chunks")?;
        let contents = read_chunks(&path)?;
        Ok(Some(
            serde_json::json!({ "path": path.to_string_lossy(), "contents": contents }),
        ))
    })
    .await
    .map_err(|_| "The open dialog could not complete.".to_string())?
}

#[tauri::command]
pub async fn save_png_file(
    window: tauri::WebviewWindow,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_png(&bytes)?;
        let selected = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Export terrain image")
            .add_filter("PNG image", &["png"])
            .set_file_name("digdig-map.png")
            .save_file();
        let Some(path) = selected else {
            return Ok(None);
        };
        let path = extension(path, "png")?;
        atomic_write(&path, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "The export dialog could not complete.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_chunk_boundary_rejects_wrong_versions_and_preserves_saved_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("map.chunks");
        let original = "{\"format\":\"digdig-chunks\",\"version\":1,\"source\":{},\"tiles\":[]}";
        atomic_write(&path, original.as_bytes()).unwrap();
        assert_eq!(read_chunks(&path).unwrap(), original);
        let replacement = format!("{original}\n");
        atomic_write(&path, replacement.as_bytes()).unwrap();
        assert_eq!(read_chunks(&path).unwrap(), replacement);
        assert!(validate_chunks(&original.replace("\"version\":1", "\"version\":2")).is_err());
        assert!(validate_chunks("not json").is_err());
        assert!(extension(directory.path().join("map.wasm"), "chunks").is_err());
        assert_eq!(
            extension(directory.path().join("map"), "chunks").unwrap(),
            path
        );
    }

    #[test]
    fn png_boundary_checks_signature_and_bounded_dimensions() {
        let mut bytes = vec![0_u8; 33];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&64_u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&64_u32.to_be_bytes());
        assert!(validate_png(&bytes).is_ok());
        bytes[16..20].copy_from_slice(&9000_u32.to_be_bytes());
        assert!(validate_png(&bytes).is_err());
        assert!(validate_png(b"not a png").is_err());
    }

    #[test]
    fn native_marker_boundary_accepts_old_files_and_rejects_invalid_markers() {
        let mut document =
            serde_json::json!({"format":"digdig-chunks","version":1,"source":{},"tiles":[]});
        assert!(validate_chunks(&document.to_string()).is_ok());
        let marker =
            serde_json::json!({"id":"ore-1","x":-20.5,"y":100,"label":"Explore after respawn"});
        document["markers"] = serde_json::json!([marker.clone()]);
        assert!(validate_chunks(&document.to_string()).is_ok());
        document["markers"] = serde_json::json!([marker.clone(), marker.clone()]);
        assert!(validate_chunks(&document.to_string()).is_err());
        document["markers"] = serde_json::json!([{"id":"ore-1","x":0,"y":0,"label":" "}]);
        assert!(validate_chunks(&document.to_string()).is_err());
        assert!(
            validate_marker(&serde_json::json!({"id":"ore-1","x":1e10,"y":0,"label":"Ore"}))
                .is_err()
        );
    }
}
