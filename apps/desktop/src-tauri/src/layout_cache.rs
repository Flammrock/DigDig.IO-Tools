//! Persistent address recipes. Discovery and live-memory validation belong to the resolver.
//!
//! A cache hit is never proof that a live game instance is ready. The caller must
//! reread object pointers and validate the recipe against that instance before capture.

use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, Metadata},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const SCHEMA_VERSION: u32 = 1;
const MAX_ENTRY_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 128;
const FILE_PREFIX: &str = "layout-v1-";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheEntry {
    pub schema_version: u32,
    pub wasm_sha256: String,
    pub resolver_version: String,
    pub resolved_at_unix_ms: u64,
    pub layout: LayoutRecipe,
}

/// A wasm32 address recipe, not a snapshot of the current camera allocation.
/// If camera_pointer is present it identifies the pointer SLOT in linear memory;
/// camera_offset is added to that slot's current value on every read. Otherwise
/// camera_offset is the statically resolved camera address.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutRecipe {
    pub memory_export: String,
    pub map_x: u32,
    pub map_y: u32,
    pub map_radius: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_pointer: Option<u32>,
    pub camera_offset: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_vtable: Option<u32>,
    pub camera_x: u32,
    pub camera_y: u32,
    pub camera_scale: u32,
    pub view_width: u32,
    pub view_height: u32,
    pub scale_mode: ScaleMode,
    pub terrain: TerrainRecipe,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScaleMode {
    DivideF32,
    LegacyReciprocal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerrainRecipe {
    pub source_width: u16,
    pub source_height: u16,
    pub world_grid_spacing: f64,
    pub world_draw_size: f64,
    pub world_draw_inset: f64,
    /// Identifies a supported palette; it does not infer new material meanings.
    pub palette_profile: String,
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-+".contains(&b))
}

fn disjoint_fields(values: &[u32]) -> bool {
    values.iter().enumerate().all(|(i, value)| {
        *value <= u32::MAX - 3
            && values[..i]
                .iter()
                .all(|previous| value.abs_diff(*previous) >= 4)
    })
}

impl CacheEntry {
    pub(crate) fn valid(&self) -> bool {
        let layout = &self.layout;
        let fields = [
            layout.camera_x,
            layout.camera_y,
            layout.camera_scale,
            layout.view_width,
            layout.view_height,
        ];
        let terrain = &layout.terrain;
        self.schema_version == SCHEMA_VERSION
            && valid_hash(&self.wasm_sha256)
            && valid_version(&self.resolver_version)
            && (1..=9_007_199_254_740_991).contains(&self.resolved_at_unix_ms)
            && !layout.memory_export.is_empty()
            && layout.memory_export.len() <= 128
            && !layout.memory_export.chars().any(char::is_control)
            && disjoint_fields(&[layout.map_x, layout.map_y, layout.map_radius])
            && disjoint_fields(&fields)
            && layout
                .camera_pointer
                .is_none_or(|slot| slot <= u32::MAX - 3)
            && fields.iter().all(|offset| {
                layout
                    .camera_offset
                    .checked_add(*offset)
                    .is_some_and(|value| value <= u32::MAX - 3)
            })
            && (1..=1024).contains(&terrain.source_width)
            && (1..=1024).contains(&terrain.source_height)
            && terrain.world_grid_spacing.is_finite()
            && terrain.world_grid_spacing > 0.0
            && terrain.world_grid_spacing <= 1e7
            && terrain.world_draw_size.is_finite()
            && terrain.world_draw_size > 0.0
            && terrain.world_draw_size <= 1e7
            && terrain.world_draw_inset.is_finite()
            && terrain.world_draw_inset.abs() <= terrain.world_draw_size
            && valid_version(&terrain.palette_profile)
    }
}

pub struct LayoutCache {
    directory: PathBuf,
    io: Mutex<()>,
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions and other reparse points, not only symbolic links.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn metadata(path: &Path) -> Result<Option<Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(value) if is_link(&value) => {
            Err("Layout cache cannot use links or reparse points.".into())
        }
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not inspect the layout cache.".into()),
    }
}

impl LayoutCache {
    /// Lazy construction: an unavailable cache must not prevent app startup.
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            io: Mutex::new(()),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    fn checked_directory(&self, create: bool) -> Result<bool, String> {
        // Inspect existing ancestors before creating or using the cache folder.
        for ancestor in self.directory.ancestors() {
            if ancestor.as_os_str().is_empty() {
                continue;
            }
            if let Some(value) = metadata(ancestor)? {
                if !value.is_dir() {
                    return Err("Layout cache path is not a directory.".into());
                }
            }
        }
        if create {
            fs::create_dir_all(&self.directory)
                .map_err(|_| "Could not create the layout cache directory.".to_string())?;
        }
        Ok(metadata(&self.directory)?.is_some())
    }

    fn entry_path(&self, hash: &str, resolver: &str) -> Result<PathBuf, String> {
        if !valid_hash(hash) || !valid_version(resolver) {
            return Err("Invalid layout cache hash or resolver version.".into());
        }
        Ok(self
            .directory
            .join(format!("{FILE_PREFIX}{resolver}--{hash}.json")))
    }

    fn entry_files(&self) -> Result<Vec<PathBuf>, String> {
        let mut entries = Vec::new();
        for item in fs::read_dir(&self.directory)
            .map_err(|_| "Could not list the layout cache.".to_string())?
        {
            let item = item.map_err(|_| "Could not inspect a layout cache entry.".to_string())?;
            let name = item.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some((resolver, hash)) = name
                .strip_prefix(FILE_PREFIX)
                .and_then(|name| name.strip_suffix(".json"))
                .and_then(|name| name.rsplit_once("--"))
            else {
                continue;
            };
            if !valid_version(resolver) || !valid_hash(hash) {
                continue;
            }
            let path = item.path();
            if let Some(value) = metadata(&path)? {
                if !value.is_file() {
                    return Err("A layout cache entry is not a regular file.".into());
                }
                entries.push(path);
            }
        }
        Ok(entries)
    }

    /// Missing, malformed, oversized or incompatible data is a cache miss.
    /// Operational filesystem errors are returned for diagnostics; callers may
    /// continue discovery without caching when persistent storage is unavailable.
    pub fn get(&self, hash: &str, resolver: &str) -> Result<Option<CacheEntry>, String> {
        let _guard = self
            .io
            .lock()
            .map_err(|_| "Layout cache is unavailable.".to_string())?;
        let path = self.entry_path(hash, resolver)?;
        if !self.checked_directory(false)? {
            return Ok(None);
        }
        let Some(value) = metadata(&path)? else {
            return Ok(None);
        };
        if !value.is_file() {
            return Err("A layout cache entry is not a regular file.".into());
        }
        if value.len() > MAX_ENTRY_BYTES {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        match File::open(&path) {
            Ok(file) => file
                .take(MAX_ENTRY_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read the layout cache entry.".to_string())?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not open the layout cache entry.".into()),
        };
        if bytes.len() as u64 > MAX_ENTRY_BYTES {
            return Ok(None);
        }
        let Ok(entry) = serde_json::from_slice::<CacheEntry>(&bytes) else {
            return Ok(None);
        };
        Ok(
            (entry.valid() && entry.wasm_sha256 == hash && entry.resolver_version == resolver)
                .then_some(entry),
        )
    }

    /// Only call after unique static resolution AND live validation. This method
    /// validates the storage schema, not game semantics. Even persisted entries
    /// must be validated again against each new game instance before capture.
    pub fn put_validated(&self, entry: &CacheEntry) -> Result<(), String> {
        let _guard = self
            .io
            .lock()
            .map_err(|_| "Layout cache is unavailable.".to_string())?;
        if !entry.valid() {
            return Err("Invalid layout cache recipe.".into());
        }
        let bytes = serde_json::to_vec_pretty(entry)
            .map_err(|_| "Could not encode the layout cache entry.".to_string())?;
        if bytes.len() as u64 > MAX_ENTRY_BYTES {
            return Err("Layout cache entry is too large.".into());
        }
        let path = self.entry_path(&entry.wasm_sha256, &entry.resolver_version)?;
        self.checked_directory(true)?;
        match metadata(&path)? {
            Some(value) if !value.is_file() => {
                return Err("A layout cache entry is not a regular file.".into())
            }
            None if self.entry_files()?.len() >= MAX_ENTRIES => {
                return Err(
                    "Layout cache is full. Remove old entries before saving another layout.".into(),
                )
            }
            _ => {}
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|_| "Could not create a temporary layout cache entry.".to_string())?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| "Could not write the layout cache entry.".to_string())?;
        // Recheck before replacement. No recursive deletion or traversal occurs.
        self.checked_directory(false)?;
        if metadata(&path)?.is_some_and(|value| !value.is_file()) {
            return Err("A layout cache entry is not a regular file.".into());
        }
        temporary.persist(&path).map_err(|_| {
            "Could not replace the layout cache entry; the previous file was kept.".to_string()
        })?;
        Ok(())
    }

    pub fn remove(&self, hash: &str, resolver: &str) -> Result<bool, String> {
        let _guard = self
            .io
            .lock()
            .map_err(|_| "Layout cache is unavailable.".to_string())?;
        let path = self.entry_path(hash, resolver)?;
        if !self.checked_directory(false)? {
            return Ok(false);
        }
        let Some(value) = metadata(&path)? else {
            return Ok(false);
        };
        if !value.is_file() {
            return Err("A layout cache entry is not a regular file.".into());
        }
        fs::remove_file(path)
            .map_err(|_| "Could not remove the layout cache entry.".to_string())?;
        Ok(true)
    }

    /// Remove recognized cache files only. Unrelated files, subdirectories, and
    /// settings/pairing/report files in the parent folder are never deleted.
    pub fn clear(&self) -> Result<usize, String> {
        let _guard = self
            .io
            .lock()
            .map_err(|_| "Layout cache is unavailable.".to_string())?;
        if !self.checked_directory(false)? {
            return Ok(0);
        }
        let paths = self.entry_files()?;
        let mut removed = 0;
        for path in paths {
            self.checked_directory(false)?;
            if let Some(value) = metadata(&path)? {
                if !value.is_file() {
                    return Err("A layout cache entry is not a regular file.".into());
                }
                fs::remove_file(path)
                    .map_err(|_| "Could not clear a layout cache entry.".to_string())?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn known_entry() -> CacheEntry {
        // Read-only reference evidence. No game module is loaded or changed.
        let source: Value =
            serde_json::from_str(include_str!("../../../../reports/current-game-layout.json"))
                .unwrap();
        let mut layout = json!({});
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
            layout[key] = source[key].clone();
        }
        for (key, field) in [
            ("cameraX", "x"),
            ("cameraY", "y"),
            ("cameraScale", "scale"),
            ("viewWidth", "width"),
            ("viewHeight", "height"),
        ] {
            layout[key] = source["cameraFields"][field].clone();
        }
        layout["terrain"] = source["terrain"].clone();
        layout["terrain"]
            .as_object_mut()
            .unwrap()
            .remove("drawImageArguments");
        layout["terrain"]["paletteProfile"] = "materials-v1".into();
        serde_json::from_value(json!({"schemaVersion":1, "wasmSha256":source["sha256"], "resolverVersion":"patterns-1.0.0", "resolvedAtUnixMs":1792803766253_u64, "layout":layout})).unwrap()
    }

    fn cache(directory: &tempfile::TempDir) -> LayoutCache {
        LayoutCache::new(directory.path().join("layout-cache"))
    }

    #[test]
    fn known_recipe_survives_restart_and_replacement_without_live_addresses() {
        let root = tempfile::tempdir().unwrap();
        let first = cache(&root);
        let mut entry = known_entry();
        assert!(!first.directory().exists());
        assert!(first
            .get(&entry.wasm_sha256, &entry.resolver_version)
            .unwrap()
            .is_none());
        assert!(!first.directory().exists());
        first.put_validated(&entry).unwrap();
        let restarted = cache(&root);
        assert_eq!(
            restarted
                .get(&entry.wasm_sha256, &entry.resolver_version)
                .unwrap(),
            Some(entry.clone())
        );
        entry.resolved_at_unix_ms += 1;
        restarted.put_validated(&entry).unwrap();
        assert_eq!(
            first
                .get(&entry.wasm_sha256, &entry.resolver_version)
                .unwrap(),
            Some(entry.clone())
        );
        assert_eq!(entry.layout.camera_pointer, Some(332320));
        assert_eq!(entry.layout.camera_offset, 185632);
        assert!(first
            .get(&"a".repeat(64), &entry.resolver_version)
            .unwrap()
            .is_none());
        assert!(first
            .get(&entry.wasm_sha256, "patterns-2.0.0")
            .unwrap()
            .is_none());
    }

    #[test]
    fn corrupt_incompatible_and_oversized_files_are_misses() {
        let root = tempfile::tempdir().unwrap();
        let cache = cache(&root);
        let entry = known_entry();
        cache.put_validated(&entry).unwrap();
        let path = cache
            .entry_path(&entry.wasm_sha256, &entry.resolver_version)
            .unwrap();
        for (field, value) in [
            ("schemaVersion", json!(2)),
            ("wasmSha256", json!("a".repeat(64))),
            ("resolverVersion", json!("patterns-2")),
            ("liveCameraAddress", json!(123)),
        ] {
            let mut document = serde_json::to_value(&entry).unwrap();
            document[field] = value;
            fs::write(&path, document.to_string()).unwrap();
            assert!(
                cache
                    .get(&entry.wasm_sha256, &entry.resolver_version)
                    .unwrap()
                    .is_none(),
                "{field}"
            );
        }
        for bytes in [
            b"{ broken".to_vec(),
            vec![b' '; MAX_ENTRY_BYTES as usize + 1],
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(cache
                .get(&entry.wasm_sha256, &entry.resolver_version)
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn invalid_inputs_preserve_the_existing_entry() {
        let root = tempfile::tempdir().unwrap();
        let cache = cache(&root);
        let entry = known_entry();
        cache.put_validated(&entry).unwrap();
        for invalid in ["../outside", "a/b", "a\\b", "", "CON:", "x\n", "..", "a"] {
            assert!(cache.get(invalid, &entry.resolver_version).is_err());
            if invalid != "a" {
                assert!(cache.get(&entry.wasm_sha256, invalid).is_err());
            }
        }
        let mut invalid = entry.clone();
        invalid.layout.camera_offset = u32::MAX;
        assert!(cache.put_validated(&invalid).is_err());
        invalid = entry.clone();
        invalid.layout.map_y = invalid.layout.map_x;
        assert!(cache.put_validated(&invalid).is_err());
        invalid = entry.clone();
        invalid.layout.terrain.world_grid_spacing = f64::NAN;
        assert!(cache.put_validated(&invalid).is_err());
        assert_eq!(
            cache
                .get(&entry.wasm_sha256, &entry.resolver_version)
                .unwrap(),
            Some(entry)
        );
    }

    #[test]
    fn remove_and_clear_are_confined_to_recognized_cache_files() {
        let root = tempfile::tempdir().unwrap();
        let cache = cache(&root);
        let entry = known_entry();
        cache.put_validated(&entry).unwrap();
        let mut second = entry.clone();
        second.resolver_version = "patterns-2".into();
        cache.put_validated(&second).unwrap();
        for name in ["viewer-settings.json", "bridge-token", "reports/keep.txt"] {
            let path = root.path().join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "keep").unwrap();
        }
        fs::write(cache.directory().join("notes.json"), "keep").unwrap();
        fs::create_dir(cache.directory().join("unrelated-folder")).unwrap();
        assert!(cache
            .remove(&entry.wasm_sha256, &entry.resolver_version)
            .unwrap());
        assert!(!cache
            .remove(&entry.wasm_sha256, &entry.resolver_version)
            .unwrap());
        assert_eq!(cache.clear().unwrap(), 1);
        assert_eq!(cache.clear().unwrap(), 0);
        for name in [
            "viewer-settings.json",
            "bridge-token",
            "reports/keep.txt",
            "layout-cache/notes.json",
        ] {
            assert_eq!(fs::read_to_string(root.path().join(name)).unwrap(), "keep");
        }
        assert!(cache.directory().join("unrelated-folder").is_dir());
    }

    #[test]
    fn entry_limit_allows_replacement_but_rejects_growth() {
        let root = tempfile::tempdir().unwrap();
        let cache = cache(&root);
        let mut entry = known_entry();
        for index in 0..MAX_ENTRIES {
            entry.wasm_sha256 = format!("{index:064x}");
            cache.put_validated(&entry).unwrap();
        }
        entry.resolved_at_unix_ms += 1;
        cache.put_validated(&entry).unwrap();
        entry.wasm_sha256 = "f".repeat(64);
        assert!(cache.put_validated(&entry).is_err());
        assert_eq!(cache.clear().unwrap(), MAX_ENTRIES);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn linked_cache_entries_and_directories_are_refused() {
        let root = tempfile::tempdir().unwrap();
        let cache = cache(&root);
        let entry = known_entry();
        let outside = root.path().join("viewer-settings.json");
        fs::write(&outside, "keep").unwrap();
        fs::create_dir(cache.directory()).unwrap();
        let path = cache
            .entry_path(&entry.wasm_sha256, &entry.resolver_version)
            .unwrap();
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &path);
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &path);
        if let Err(error) = linked {
            // Windows may require Developer Mode or the create-symlink privilege.
            #[cfg(windows)]
            if error.raw_os_error() == Some(1314) {
                return;
            }
            panic!("Could not create test link: {error}");
        }
        assert!(cache
            .get(&entry.wasm_sha256, &entry.resolver_version)
            .is_err());
        assert!(cache.put_validated(&entry).is_err());
        assert!(cache
            .remove(&entry.wasm_sha256, &entry.resolver_version)
            .is_err());
        assert!(cache.clear().is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
        fs::remove_file(&path).unwrap();
        fs::remove_dir(cache.directory()).unwrap();
        let elsewhere = root.path().join("other-data");
        fs::create_dir(&elsewhere).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&elsewhere, cache.directory()).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&elsewhere, cache.directory()).unwrap();
        assert!(cache
            .get(&entry.wasm_sha256, &entry.resolver_version)
            .is_err());
        assert!(cache.put_validated(&entry).is_err());
        assert!(cache.clear().is_err());
        assert!(fs::read_dir(&elsewhere).unwrap().next().is_none());
    }
}
