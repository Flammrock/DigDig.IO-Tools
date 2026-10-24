use crate::Bridge;
use std::io::Write;

fn export_path(mut path: std::path::PathBuf) -> Result<std::path::PathBuf, String> {
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".user.js"))
    {
        return Ok(path);
    }
    if path.extension().is_none() {
        path.set_extension("user.js");
    } else if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("js"))
    {
        path.set_extension("user.js");
    } else {
        return Err("Choose a .user.js filename for the userscript.".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn userscript_info(bridge: tauri::State<'_, Bridge>) -> serde_json::Value {
    serde_json::json!({
        "filename": if bridge.native.is_some() { "digdig.user.js" } else { "digdig-development.user.js" },
        "installUrl": bridge.install_url(),
        "mode": if bridge.native.is_some() { "standalone" } else { "development" },
        "paired": true,
    })
}

#[tauri::command]
pub fn read_userscript(bridge: tauri::State<'_, Bridge>) -> Result<String, String> {
    bridge.userscript()
}

#[tauri::command]
pub async fn install_userscript(bridge: tauri::State<'_, Bridge>) -> Result<(), String> {
    // Verify the matching script exists before opening the fixed local URL.
    bridge.userscript()?;
    let url = bridge.install_url();
    tauri::async_runtime::spawn_blocking(move || {
        open::that_detached(url).map_err(|_| "Could not open the userscript installer in your browser. Use Copy or Export instead.".to_string())
    }).await.map_err(|_| "Could not start the browser installer.".to_string())?
}

#[tauri::command]
pub async fn copy_userscript(bridge: tauri::State<'_, Bridge>) -> Result<(), String> {
    let script = bridge.userscript()?;
    tauri::async_runtime::spawn_blocking(move || {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(script))
            .map_err(|_| "Could not copy the userscript. Use Export instead.".to_string())
    })
    .await
    .map_err(|_| "Could not access the clipboard.".to_string())?
}

#[tauri::command]
pub async fn export_userscript(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<Option<String>, String> {
    let script = bridge.userscript()?;
    let filename = if bridge.native.is_some() {
        "digdig.user.js"
    } else {
        "digdig-development.user.js"
    };
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Export userscript")
            .add_filter("Userscript JavaScript", &["js"])
            .set_file_name(filename)
            .save_file()
        else {
            return Ok(None);
        };
        let path = export_path(path)?;
        let directory = path
            .parent()
            .ok_or("The selected location has no parent directory.")?;
        let mut file = tempfile::NamedTempFile::new_in(directory)
            .map_err(|_| "Could not create the selected userscript file.".to_string())?;
        file.write_all(script.as_bytes())
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| {
                "Could not write the userscript; any previous file was kept.".to_string()
            })?;
        file.persist(&path).map_err(|_| {
            "Could not replace the userscript file; any previous file was kept.".to_string()
        })?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "The export dialog could not complete.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_keep_the_userscript_extension() {
        assert_eq!(
            export_path("custom".into()).unwrap(),
            std::path::PathBuf::from("custom.user.js")
        );
        assert_eq!(
            export_path("custom.js".into()).unwrap(),
            std::path::PathBuf::from("custom.user.js")
        );
        assert_eq!(
            export_path("custom.user.js".into()).unwrap(),
            std::path::PathBuf::from("custom.user.js")
        );
        assert!(export_path("game.wasm".into()).is_err());
    }
}
