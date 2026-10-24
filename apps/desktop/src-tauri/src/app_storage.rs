//! The active app paths, shared by native persistence and the information panel.
use crate::layout_cache::LayoutCache;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

pub struct AppStorage {
    development: bool,
    data_directory: PathBuf,
    reports_directory: PathBuf,
    pub layout_cache: Arc<LayoutCache>,
}

impl AppStorage {
    pub fn standalone(data_directory: PathBuf) -> Self {
        Self {
            development: false,
            reports_directory: data_directory.join("reports"),
            layout_cache: Arc::new(LayoutCache::new(data_directory.join("layout-cache"))),
            data_directory,
        }
    }

    pub fn development(workspace: &Path) -> Self {
        let data_directory = workspace.join(".local");
        Self {
            development: true,
            reports_directory: workspace.join("reports").join("live"),
            layout_cache: Arc::new(LayoutCache::new(data_directory.join("layout-cache"))),
            data_directory,
        }
    }

    pub fn directory(&self) -> &Path {
        &self.data_directory
    }

    fn info(&self) -> serde_json::Value {
        serde_json::json!({
            "mode": if self.development { "development" } else { "standalone" },
            "dataDirectory": self.data_directory.to_string_lossy(),
            "settingsFile": self.data_directory.join("viewer-settings.json").to_string_lossy(),
            "reportsDirectory": self.reports_directory.to_string_lossy(),
            "layoutCacheDirectory": self.layout_cache.directory().to_string_lossy(),
        })
    }
}

#[tauri::command]
pub fn app_storage_info(storage: tauri::State<'_, AppStorage>) -> serde_json::Value {
    storage.info()
}

#[tauri::command]
pub async fn open_app_data_directory(storage: tauri::State<'_, AppStorage>) -> Result<(), String> {
    // The backend selects the active directory. No path or shell command is
    // accepted from the webview, and this works without a connected game.
    let directory = storage.directory().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&directory)
            .map_err(|_| "Could not create the app data folder.".to_string())?;
        open::that_detached(directory)
            .map_err(|_| "Could not open the app data folder in Explorer.".to_string())
    })
    .await
    .map_err(|_| "Could not start opening the app data folder.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_paths_share_the_configured_app_directory() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::standalone(directory.path().to_path_buf());
        let info = storage.info();
        assert_eq!(info["mode"], "standalone");
        for (key, relative) in [
            ("settingsFile", "viewer-settings.json"),
            ("reportsDirectory", "reports"),
            ("layoutCacheDirectory", "layout-cache"),
        ] {
            assert_eq!(
                info[key].as_str().unwrap(),
                directory.path().join(relative).to_str().unwrap()
            );
        }
        assert_eq!(info["dataDirectory"], directory.path().to_str().unwrap());
        assert_eq!(info.as_object().unwrap().len(), 5);
    }

    #[test]
    fn development_paths_match_the_node_bridge_without_creating_files() {
        let workspace = tempfile::tempdir().unwrap();
        let storage = AppStorage::development(workspace.path());
        let info = storage.info();
        assert_eq!(info["mode"], "development");
        assert_eq!(storage.directory(), workspace.path().join(".local"));
        assert_eq!(
            info["reportsDirectory"],
            workspace
                .path()
                .join("reports")
                .join("live")
                .to_str()
                .unwrap()
        );
        assert_eq!(
            info["layoutCacheDirectory"],
            workspace
                .path()
                .join(".local")
                .join("layout-cache")
                .to_str()
                .unwrap()
        );
        assert!(!storage.directory().exists());
    }
}
