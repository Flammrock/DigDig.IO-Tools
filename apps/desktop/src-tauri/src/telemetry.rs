//! The packaged application's in-memory map store. Its wire format matches the
//! development bridge, so the same viewer and userscript work in both modes.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    time::{SystemTime, UNIX_EPOCH},
};

const GAME_MAP: &str = "game-shared";
const GAME_CLIENT: &str = "game-map";
const STALE_MS: u64 = 5_000;
const TTL_MS: u64 = 300_000;
const MAX_CLIENTS: usize = 8;
const MAX_FRAME_TILES: usize = 32;
const MAX_TOTAL_TILES: usize = 2048;
const MAX_MARKERS: usize = 512;

type Result<T> = std::result::Result<T, String>;

fn require(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| format!("{label} must be an object."))
}

fn valid_id(value: &str, maximum: usize, extra: &[u8]) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || extra.contains(&byte))
}

fn client_id(value: &Value) -> Result<String> {
    value
        .as_str()
        .filter(|id| valid_id(id, 80, b"_-"))
        .map(str::to_owned)
        .ok_or_else(|| "Invalid browser session.".to_string())
}

fn numeric(value: &Value, minimum: f64, maximum: f64, integer: bool) -> Result<Value> {
    let number = value
        .as_f64()
        .ok_or("Expected a finite map coordinate or dimension.")?;
    require(
        number.is_finite()
            && number >= minimum
            && number <= maximum
            && (!integer || number.fract() == 0.0),
        "Map coordinate or dimension is outside the supported range.",
    )?;
    Ok(value.clone())
}

fn field_number(value: &Value, key: &str, min: f64, max: f64, integer: bool) -> Result<Value> {
    numeric(&value[key], min, max, integer).map_err(|error| format!("{key}: {error}"))
}

fn coordinates(value: &Value, keys: &[&str]) -> Result<Map<String, Value>> {
    object(value, "Geometry")?;
    keys.iter()
        .map(|key| {
            Ok((
                (*key).to_owned(),
                field_number(value, key, -1e9, 1e9, false)?,
            ))
        })
        .collect()
}

fn world(value: &Value) -> Result<Value> {
    let mut fields = coordinates(value, &["centerX", "centerY"])?;
    fields.insert(
        "radius".to_owned(),
        field_number(value, "radius", f64::from_bits(1), 1e7, false)?,
    );
    Ok(fields.into())
}

fn valid_hash(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Null))
        || value.and_then(Value::as_str).is_some_and(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

fn valid_timestamp(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let bytes = text.as_bytes();
    if bytes.len() != 24
        || [
            (4, b'-'),
            (7, b'-'),
            (10, b'T'),
            (13, b':'),
            (16, b':'),
            (19, b'.'),
            (23, b'Z'),
        ]
        .iter()
        .any(|(index, byte)| bytes[*index] != *byte)
    {
        return false;
    }
    if bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| ![4, 7, 10, 13, 16, 19, 23].contains(&index) && !byte.is_ascii_digit())
    {
        return false;
    }
    let parse = |range: std::ops::Range<usize>| text[range].parse::<u32>().unwrap_or(u32::MAX);
    let year = parse(0..4);
    let month = parse(5..7);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    (1..=days).contains(&parse(8..10))
        && parse(11..13) <= 23
        && parse(14..16) <= 59
        && parse(17..19) <= 59
}

fn material(value: &Value) -> bool {
    value["terrainMode"] == "materials-v1"
}
fn game(value: &Value) -> bool {
    value["source"] == "game"
}
fn live(value: &Value) -> bool {
    value["status"] == "live"
}
fn mode_limit(value: &Value) -> usize {
    if material(value) {
        1024
    } else {
        256
    }
}

fn parse_tile(value: &Value, materials: bool) -> Result<Value> {
    object(value, "Tile")?;
    let key = value["key"]
        .as_str()
        .filter(|key| valid_id(key, 128, b"_.:,-"))
        .ok_or("Invalid tile key.")?;
    let mut fields = coordinates(value, &["x", "y"])?;
    fields.insert("key".into(), key.into());
    for key in ["width", "height"] {
        fields.insert(
            key.into(),
            field_number(value, key, f64::from_bits(1), 1e7, false)?,
        );
    }
    for key in ["pixelWidth", "pixelHeight"] {
        fields.insert(key.into(), field_number(value, key, 1.0, 64.0, true)?);
    }
    let expected = (fields["pixelWidth"].as_f64().unwrap()
        * fields["pixelHeight"].as_f64().unwrap()) as usize
        * 4;
    let rgba = value["rgba"]
        .as_str()
        .ok_or("Tile pixels must be base64.")?;
    require(
        rgba.len() == 4 * expected.div_ceil(3),
        "Tile pixels have an invalid size.",
    )?;
    let bytes = STANDARD
        .decode(rgba)
        .map_err(|_| "Tile pixels are not valid base64.")?;
    require(
        bytes.len() == expected && STANDARD.encode(&bytes) == rgba,
        "Tile pixels must use canonical RGBA base64.",
    )?;
    if materials {
        for pixel in bytes.chunks_exact(4) {
            require(
                pixel[3] == 255 || pixel == [0, 0, 0, 0],
                "Material pixels must be fully opaque or zero RGBA unknowns.",
            )?;
        }
        fields.insert(
            "observedPixels".into(),
            json!(bytes
                .chunks_exact(4)
                .filter(|pixel| pixel[3] == 255)
                .count()),
        );
    }
    fields.insert("rgba".into(), rgba.into());
    Ok(fields.into())
}

fn parse_tiles(value: &Value, materials: bool, maximum: usize) -> Result<Vec<Value>> {
    let values = value
        .as_array()
        .filter(|values| values.len() <= maximum)
        .ok_or("Too many tiles or invalid tile list.")?;
    let tiles: Vec<_> = values
        .iter()
        .map(|tile| parse_tile(tile, materials))
        .collect::<Result<_>>()?;
    let keys: HashSet<_> = tiles
        .iter()
        .map(|tile| tile["key"].as_str().unwrap())
        .collect();
    require(keys.len() == tiles.len(), "Tile keys must be unique.")?;
    Ok(tiles)
}

fn parse_frame(value: &Value) -> Result<Value> {
    object(value, "Map frame")?;
    require(
        value["version"].as_f64() == Some(1.0),
        "Map frame version must be 1.",
    )?;
    require(
        value.get("appVersion").is_none()
            || value["appVersion"]
                .as_str()
                .is_some_and(|version| valid_id(version, 128, b".+-")),
        "appVersion must be a package version of at most 128 characters.",
    )?;
    require(
        matches!(value["source"].as_str(), Some("game" | "fixture")),
        "Unknown map source.",
    )?;
    require(
        matches!(
            value["status"].as_str(),
            Some("waiting" | "unsupported" | "live" | "error")
        ),
        "Unknown map status.",
    )?;
    require(
        value["message"]
            .as_str()
            .is_some_and(|text| text.encode_utf16().count() <= 512),
        "Invalid map status message.",
    )?;
    require(
        valid_hash(value.get("buildHash")),
        "Invalid game build hash.",
    )?;
    require(
        valid_timestamp(&value["capturedAt"]),
        "Map frame timestamp must be a UTC ISO timestamp.",
    )?;
    require(
        value.get("terrainMode").is_none() || material(value),
        "Unsupported terrain mode.",
    )?;
    let mut frame = Map::new();
    for key in [
        "version",
        "appVersion",
        "source",
        "status",
        "message",
        "buildHash",
        "capturedAt",
        "terrainMode",
    ] {
        if let Some(value) = value.get(key) {
            frame.insert(key.into(), value.clone());
        }
    }
    if let Some(bounds) = value.get("world") {
        frame.insert("world".into(), world(bounds)?);
    }
    if let Some(player) = value.get("player") {
        frame.insert(
            "player".into(),
            coordinates(player, &["x", "y", "normalizedX", "normalizedY"])?.into(),
        );
    }
    if let Some(camera) = value.get("camera") {
        let mut geometry = coordinates(camera, &["x", "y"])?;
        geometry.insert(
            "scale".into(),
            field_number(camera, "scale", f64::from_bits(1), 1e6, false)?,
        );
        for key in ["width", "height"] {
            geometry.insert(key.into(), field_number(camera, key, 1.0, 32768.0, true)?);
        }
        frame.insert("camera".into(), geometry.into());
    }
    let tiles = parse_tiles(&value["tiles"], material(value), MAX_FRAME_TILES)?;
    if live(value) {
        require(
            ["world", "player", "camera"]
                .iter()
                .all(|key| frame.contains_key(*key)),
            "Live frames require world, player, and camera data.",
        )?;
        require(
            !game(value) || !value["buildHash"].is_null(),
            "A live game frame needs its build hash.",
        )?;
    } else {
        require(tiles.is_empty(), "Only live frames may contain tiles.")?;
    }
    frame.insert("tiles".into(), tiles.into());
    Ok(frame.into())
}

fn parse_marker(value: &Value) -> Result<Value> {
    object(value, "Marker")?;
    let id = value["id"]
        .as_str()
        .filter(|id| valid_id(id, 128, b"_.:,-"))
        .ok_or("Invalid marker ID.")?;
    let label = value["label"]
        .as_str()
        .ok_or("Marker label must be text.")?
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    require(
        !label.is_empty()
            && label.encode_utf16().count() <= 240
            && !label.chars().any(|c| c <= '\u{001f}' || c == '\u{007f}'),
        "Marker label must contain 1–240 printable characters.",
    )?;
    let mut result = coordinates(value, &["x", "y"])?;
    result.insert("id".into(), id.into());
    result.insert("label".into(), label.into());
    Ok(result.into())
}

fn parse_document(value: &Value) -> Result<(Value, Vec<Value>, Vec<Value>)> {
    object(value, "Chunks file")?;
    require(
        value["format"] == "digdig-chunks" && value["version"].as_f64() == Some(1.0),
        "Unsupported .chunks format or version.",
    )?;
    require(
        valid_timestamp(&value["savedAt"]),
        "Invalid chunks timestamp.",
    )?;
    let source = &value["source"];
    object(source, "Chunks source")?;
    require(
        source["label"].as_str().is_some_and(|label| {
            !label.is_empty()
                && label.encode_utf16().count() <= 160
                && !label.chars().any(|c| c <= '\u{001f}')
        }),
        "Invalid chunks source label.",
    )?;
    require(
        valid_hash(source.get("buildHash")),
        "Invalid chunks build hash.",
    )?;
    require(
        source.get("terrainMode").is_none() || material(source),
        "Unsupported terrain mode.",
    )?;
    if let Some(bounds) = source.get("world") {
        world(bounds)?;
    }
    let tiles = parse_tiles(&value["tiles"], material(source), MAX_TOTAL_TILES)?;
    let markers = match value.get("markers") {
        None => vec![],
        Some(value) => value
            .as_array()
            .filter(|values| values.len() <= MAX_MARKERS)
            .ok_or("Too many markers or invalid marker list.")?
            .iter()
            .map(parse_marker)
            .collect::<Result<Vec<_>>>()?,
    };
    let ids: HashSet<_> = markers
        .iter()
        .map(|marker| marker["id"].as_str().unwrap())
        .collect();
    require(
        ids.len() == markers.len(),
        "Chunks file has duplicate markers.",
    )?;
    Ok((source.clone(), tiles, markers))
}

fn same_world(previous: Option<&Value>, next: Option<&Value>) -> bool {
    match (previous, next) {
        (None, None) => true,
        (Some(previous), Some(next)) => {
            let ratio =
                next["radius"].as_f64().unwrap_or(0.0) / previous["radius"].as_f64().unwrap_or(0.0);
            same_number(&previous["centerX"], &next["centerX"])
                && same_number(&previous["centerY"], &next["centerY"])
                && (0.5..=2.0).contains(&ratio)
        }
        _ => false,
    }
}

fn same_number(previous: &Value, next: &Value) -> bool {
    previous.as_f64() == next.as_f64()
}

fn same_geometry(previous: &Value, next: &Value) -> bool {
    if !same_number(&previous["pixelWidth"], &next["pixelWidth"])
        || !same_number(&previous["pixelHeight"], &next["pixelHeight"])
    {
        return false;
    }
    let tolerance = [
        previous["width"].as_f64().unwrap(),
        previous["height"].as_f64().unwrap(),
        next["width"].as_f64().unwrap(),
        next["height"].as_f64().unwrap(),
    ]
    .into_iter()
    .fold(f64::INFINITY, f64::min)
    .mul_add(1e-4, 0.0)
    .max(0.01);
    ["x", "y", "width", "height"].iter().all(|key| {
        (previous[*key].as_f64().unwrap() - next[*key].as_f64().unwrap()).abs() <= tolerance
    })
}

fn merge_tile(
    previous: Option<&Value>,
    next: &Value,
    materials: bool,
    importing: bool,
) -> Result<Option<Value>> {
    if materials && next["observedPixels"] == 0 {
        return Ok(if importing { previous.cloned() } else { None });
    }
    let Some(previous) = previous else {
        return Ok(Some(next.clone()));
    };
    if !same_geometry(previous, next) {
        require(
            !importing,
            "A saved chunk uses a different pixel grid or position. Use Preview for this file.",
        )?;
        return Ok(Some(next.clone()));
    }
    if !materials && !importing {
        return Ok(Some(next.clone()));
    }
    // Inputs have already passed full validation. Refreshes and fully observed
    // live replacements do not need to decode and re-encode both tile buffers.
    if previous["rgba"] == next["rgba"] {
        return Ok(Some(previous.clone()));
    }
    if materials
        && !importing
        && next["observedPixels"].as_u64().unwrap()
            == (next["pixelWidth"].as_f64().unwrap() * next["pixelHeight"].as_f64().unwrap()) as u64
    {
        return Ok(Some(next.clone()));
    }
    let mut pixels = STANDARD
        .decode(previous["rgba"].as_str().unwrap())
        .map_err(|_| "Stored tile is invalid.")?;
    let incoming = STANDARD
        .decode(next["rgba"].as_str().unwrap())
        .map_err(|_| "Incoming tile is invalid.")?;
    let mut changed = false;
    let mut observed = previous["observedPixels"].as_u64().unwrap_or(0);
    for (pixel, saved) in pixels.chunks_exact_mut(4).zip(incoming.chunks_exact(4)) {
        if ((importing && pixel[3] == 0 && saved[3] != 0) || (!importing && saved[3] == 255))
            && pixel != saved
        {
            if pixel[3] == 0 {
                observed += 1;
            }
            pixel.copy_from_slice(saved);
            changed = true;
        }
    }
    if !changed {
        return Ok(Some(previous.clone()));
    }
    let mut tile = if importing {
        previous.clone()
    } else {
        next.clone()
    };
    tile["rgba"] = STANDARD.encode(&pixels).into();
    if materials {
        tile["observedPixels"] = json!(observed);
    }
    Ok(Some(tile))
}

#[derive(Clone)]
struct CachedTile {
    value: Value,
    revision: u64,
    order: u64,
}

#[derive(Clone, Default)]
struct Terrain {
    tiles: BTreeMap<String, CachedTile>,
    markers: BTreeMap<String, Value>,
    marker_order: Vec<String>,
    reset_revision: u64,
    frame: Option<Value>,
    last_seen: u64,
}

#[derive(Clone)]
struct Client {
    id: String,
    map_id: String,
    first_seen: u64,
    last_seen: u64,
    frame: Value,
    map_only: bool,
}

pub struct TelemetryStore {
    clients: Vec<Client>,
    maps: BTreeMap<String, Terrain>,
    revision: u64,
    next_order: u64,
    #[cfg(test)]
    test_now: Option<u64>,
}

impl TelemetryStore {
    pub fn new() -> Self {
        let mut maps = BTreeMap::new();
        maps.insert(GAME_MAP.into(), Terrain::default());
        Self {
            clients: vec![],
            maps,
            revision: 0,
            next_order: 0,
            #[cfg(test)]
            test_now: None,
        }
    }

    fn now(&self) -> u64 {
        #[cfg(test)]
        if let Some(now) = self.test_now {
            return now;
        }
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64
    }

    fn drop_unused_maps(&mut self) {
        self.maps.retain(|id, _| {
            id == GAME_MAP || self.clients.iter().any(|client| &client.map_id == id)
        });
    }

    fn prune(&mut self, auto: bool) {
        let now = self.now();
        let fresh = auto
            && self.clients.iter().any(|client| {
                game(&client.frame)
                    && live(&client.frame)
                    && now.saturating_sub(client.last_seen) <= STALE_MS
            });
        let before = self.clients.len();
        self.clients.retain(|client| {
            let age = now.saturating_sub(client.last_seen);
            !(game(&client.frame) && fresh && age > STALE_MS
                || (!game(&client.frame) || auto) && age > TTL_MS)
        });
        if before != self.clients.len() {
            self.revision += 1;
            self.drop_unused_maps();
        }
    }

    fn cleanup(&mut self) -> Vec<String> {
        let now = self.now();
        let mut removed = vec![];
        self.clients.retain(|client| {
            let remove = game(&client.frame) && now.saturating_sub(client.last_seen) > STALE_MS;
            if remove {
                removed.push(client.id.clone());
            }
            !remove
        });
        if !removed.is_empty() {
            self.revision += 1;
            self.drop_unused_maps();
        }
        removed
    }

    fn update(&mut self, id: String, value: &Value, auto: bool) -> Result<()> {
        require(
            id != GAME_CLIENT,
            "This client ID is reserved for the shared game map.",
        )?;
        let mut frame = parse_frame(value)?;
        self.prune(auto);
        let existing = self.clients.iter().find(|client| client.id == id).cloned();
        if existing.is_none() {
            if game(&frame) && live(&frame) && auto {
                self.cleanup();
            }
            require(
                self.clients.len() < MAX_CLIENTS,
                "Too many live map clients. Remove inactive sessions in Settings.",
            )?;
        }
        self.revision += 1;
        let now = self.now();
        let map_id = if game(&frame) {
            GAME_MAP.to_owned()
        } else {
            format!("fixture:{id}")
        };
        let Value::Array(tiles) = std::mem::replace(&mut frame["tiles"], json!([])) else {
            unreachable!("parse_frame always produces a tile array")
        };
        let mut write_tiles = true;
        if game(&frame) {
            let map = self.maps.get_mut(GAME_MAP).unwrap();
            write_tiles = live(&frame);
            if write_tiles {
                if map.tiles.is_empty()
                    || map
                        .frame
                        .as_ref()
                        .is_none_or(|old| old.get("terrainMode") == frame.get("terrainMode"))
                {
                    map.frame = Some(frame.clone());
                    map.last_seen = now;
                } else {
                    write_tiles = false;
                    let message = format!("{} This session uses a different terrain mode; clear the shared map before capturing it.", frame["message"].as_str().unwrap());
                    frame["message"] = message.chars().take(512).collect::<String>().into();
                }
            }
        } else {
            let previous = existing.as_ref().map(|entry| &entry.frame);
            let same_source = previous.is_some_and(|old| {
                old["source"] == frame["source"]
                    && old["buildHash"] == frame["buildHash"]
                    && old.get("terrainMode") == frame.get("terrainMode")
            });
            let retain_materials = same_source
                && material(&frame)
                && frame["status"] != "unsupported"
                && previous.unwrap()["status"] != "unsupported";
            if retain_materials && frame.get("world").is_none() {
                if let Some(bounds) = previous.unwrap().get("world") {
                    frame["world"] = bounds.clone();
                }
            }
            let retain = same_source
                && same_world(
                    previous.and_then(|old| old.get("world")),
                    frame.get("world"),
                )
                && (retain_materials || live(&frame) && previous.is_some_and(live));
            if !retain {
                self.maps.insert(
                    map_id.clone(),
                    Terrain {
                        reset_revision: self.revision,
                        ..Terrain::default()
                    },
                );
            }
            let map = self.maps.get_mut(&map_id).unwrap();
            map.frame = Some(frame.clone());
            map.last_seen = now;
        }
        if write_tiles {
            self.write_tiles(&map_id, &frame, tiles)?;
        }
        let client = Client {
            id: id.clone(),
            map_id,
            first_seen: existing.as_ref().map_or(now, |entry| entry.first_seen),
            last_seen: now,
            frame,
            map_only: false,
        };
        if let Some(index) = self.clients.iter().position(|entry| entry.id == id) {
            self.clients[index] = client;
        } else {
            self.clients.push(client);
        }
        self.drop_unused_maps();
        self.enforce_total_limit();
        self.prune(auto);
        Ok(())
    }

    fn write_tiles(&mut self, map_id: &str, frame: &Value, tiles: Vec<Value>) -> Result<()> {
        let map = self.maps.get_mut(map_id).unwrap();
        for tile in tiles {
            let key = tile["key"].as_str().unwrap().to_owned();
            let previous = map.tiles.get(&key);
            let Some(updated) = merge_tile(
                previous.map(|tile| &tile.value),
                &tile,
                material(frame),
                false,
            )?
            else {
                continue;
            };
            let unchanged = previous.is_some_and(|old| {
                same_geometry(&old.value, &updated) && old.value["rgba"] == updated["rgba"]
            });
            let revision = if unchanged {
                previous.unwrap().revision
            } else {
                self.revision
            };
            let value = if unchanged {
                previous.unwrap().value.clone()
            } else {
                updated
            };
            self.next_order += 1;
            map.tiles.insert(
                key,
                CachedTile {
                    value,
                    revision,
                    order: self.next_order,
                },
            );
            while map.tiles.len() > mode_limit(frame) {
                let oldest = map
                    .tiles
                    .iter()
                    .min_by_key(|(_, tile)| tile.order)
                    .unwrap()
                    .0
                    .clone();
                map.tiles.remove(&oldest);
            }
        }
        Ok(())
    }

    fn enforce_total_limit(&mut self) {
        let mut total: usize = self.maps.values().map(|map| map.tiles.len()).sum();
        while total > MAX_TOTAL_TILES {
            let oldest = self
                .maps
                .iter()
                .flat_map(|(id, map)| {
                    map.tiles
                        .iter()
                        .map(move |(key, tile)| (id.clone(), key.clone(), tile.order))
                })
                .min_by_key(|(_, _, order)| *order);
            let Some((map, key, _)) = oldest else {
                break;
            };
            self.maps.get_mut(&map).unwrap().tiles.remove(&key);
            total -= 1;
        }
    }

    fn virtual_game(&self) -> Option<Client> {
        let map = &self.maps[GAME_MAP];
        if map.frame.is_none() && map.tiles.is_empty() && map.markers.is_empty() {
            return None;
        }
        let mut frame = json!({"version":1,"source":"game","status":"waiting","message":"Shared game map. Waiting for a game session.","buildHash":null,"capturedAt":"1970-01-01T00:00:00.000Z","tiles":[]});
        if let Some(source) = &map.frame {
            for key in ["buildHash", "capturedAt", "terrainMode", "world"] {
                if let Some(value) = source.get(key) {
                    frame[key] = value.clone();
                }
            }
        }
        Some(Client {
            id: GAME_CLIENT.into(),
            map_id: GAME_MAP.into(),
            first_seen: map.last_seen,
            last_seen: map.last_seen,
            frame,
            map_only: true,
        })
    }

    fn map_id(&mut self, id: &str, auto: bool) -> Result<String> {
        self.prune(auto);
        if id == GAME_CLIENT && self.virtual_game().is_some() {
            return Ok(GAME_MAP.into());
        }
        self.clients
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.map_id.clone())
            .ok_or("Map client not found.".to_string())
    }

    fn read(&mut self, query: &[(String, String)], auto: bool) -> Result<Value> {
        self.prune(auto);
        let get = |key: &str| {
            query
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.as_str())
        };
        let id = get("clientId")
            .map(|id| client_id(&json!(id)))
            .transpose()?;
        let since = get("since")
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|since| *since <= self.revision);
        let mut entries: Vec<_> = self.clients.iter().collect();
        let virtual_game = self.virtual_game();
        if !entries.iter().any(|entry| game(&entry.frame)) {
            if let Some(entry) = &virtual_game {
                entries.push(entry);
            }
        }
        let mut emitted = HashSet::new();
        let now = self.now();
        let clients: Vec<_> = entries.into_iter().filter(|entry| id.as_ref().is_none_or(|id| entry.id == *id)).map(|entry| {
            let map = &self.maps[&entry.map_id];
            let map_data = emitted.insert(entry.map_id.clone());
            let mut client = json!({"clientId":entry.id,"mapId":entry.map_id,"firstSeen":entry.first_seen,"lastSeen":entry.last_seen,
                "stale":now.saturating_sub(entry.last_seen)>STALE_MS,"frame":entry.frame,"mapData":map_data,"tiles":[],"markers":[]});
            if entry.map_only { client["mapOnly"] = true.into(); }
            if map_data {
                let mut metadata = json!({"buildHash":null});
                if let Some(frame) = &map.frame { for key in ["buildHash", "terrainMode", "world"] { if let Some(value) = frame.get(key) { metadata[key] = value.clone(); } } }
                client["mapFrame"] = metadata;
                client["markers"] = map.marker_order.iter().filter_map(|id| map.markers.get(id).cloned()).collect::<Vec<_>>().into();
                let mut tiles: Vec<_> = map.tiles.values().collect(); tiles.sort_by_key(|tile| tile.order);
                client["tileKeys"] = tiles.iter().map(|tile| tile.value["key"].clone()).collect::<Vec<_>>().into();
                client["resetTiles"] = since.is_none_or(|since| map.reset_revision > since).into();
                client["tiles"] = tiles.into_iter().filter(|tile| since.is_none_or(|since| tile.revision > since)).map(|tile| tile.value.clone()).collect::<Vec<_>>().into();
            }
            client
        }).collect();
        Ok(json!({"revision":self.revision,"reset":since.is_none(),"clients":clients}))
    }

    fn merge(&mut self, map_id: &str, document: &Value) -> Result<Value> {
        let (source, tiles, markers) = parse_document(document)?;
        let map = &self.maps[map_id];
        let current = map.frame.as_ref().ok_or(
            "This session has no recognized map. Use Preview to view the file independently.",
        )?;
        require(
            current.get("world").is_some() && current["status"] != "unsupported",
            "This session has no recognized map. Use Preview to view the file independently.",
        )?;
        require(
            current.get("terrainMode") == source.get("terrainMode"),
            "The file uses a different terrain mode. Use Preview for this file.",
        )?;
        require(
            current["buildHash"].is_null()
                || source["buildHash"].is_null()
                || current["buildHash"] == source["buildHash"],
            "The file comes from a different game build. Use Preview for this file.",
        )?;
        require(
            source.get("world").is_none()
                || same_number(&current["world"]["centerX"], &source["world"]["centerX"])
                    && same_number(&current["world"]["centerY"], &source["world"]["centerY"]),
            "The file uses a different map center. Use Preview for this file.",
        )?;
        // Stage the complete merge before committing anything: a late invalid
        // chunk, geometry conflict, or cache limit cannot partially import.
        let mut next = map.clone();
        let mut changed = vec![];
        for tile in tiles {
            let key = tile["key"].as_str().unwrap().to_owned();
            let previous = next.tiles.get(&key);
            let merged = merge_tile(
                previous.map(|tile| &tile.value),
                &tile,
                material(current),
                true,
            )?;
            if let Some(value) = merged {
                if previous.is_none_or(|previous| previous.value != value) {
                    next.tiles.insert(
                        key.clone(),
                        CachedTile {
                            value,
                            revision: self.revision + 1,
                            order: 0,
                        },
                    );
                    changed.push(key);
                }
            }
        }
        for marker in markers {
            let id = marker["id"].as_str().unwrap().to_owned();
            if !next.markers.contains_key(&id) {
                next.marker_order.push(id.clone());
                next.markers.insert(id, marker);
            }
        }
        require(
            next.tiles.len() <= mode_limit(current),
            "Merging would exceed this map's chunk limit. Clear some chunks or use Preview.",
        )?;
        let total: usize = self
            .maps
            .iter()
            .map(|(id, map)| {
                if id == map_id {
                    next.tiles.len()
                } else {
                    map.tiles.len()
                }
            })
            .sum();
        require(
            total <= MAX_TOTAL_TILES,
            "Merging would exceed the live cache limit. Clear some chunks or use Preview.",
        )?;
        require(
            next.markers.len() <= MAX_MARKERS,
            "Merging would exceed the marker limit. Remove some markers or use Preview.",
        )?;
        let added_markers = next.markers.len() - map.markers.len();
        if !changed.is_empty() || added_markers > 0 {
            self.revision += 1;
            for key in &changed {
                self.next_order += 1;
                next.tiles.get_mut(key).unwrap().order = self.next_order;
            }
            self.maps.insert(map_id.to_owned(), next);
        }
        Ok(json!({"tiles":changed.len(),"markers":added_markers}))
    }

    pub fn dispatch(
        &mut self,
        route: &str,
        body: Option<&Value>,
        query: &[(String, String)],
        auto_reconnect: bool,
    ) -> Result<Value> {
        if route == "/telemetry" {
            return self.read(query, auto_reconnect);
        }
        let body = body.ok_or("Expected a JSON request body.")?;
        object(body, "Request")?;
        if route == "/telemetry/cleanup" {
            require(
                body.as_object().unwrap().is_empty(),
                "Session cleanup expects an empty object.",
            )?;
            return Ok(json!({"removed":self.cleanup()}));
        }
        let id = client_id(&body["clientId"])?;
        if route == "/reports" {
            require(
                body["kind"] == "map-frame",
                "Telemetry only accepts map-frame reports.",
            )?;
            self.update(id, &body["report"], auto_reconnect)?;
            return Ok(json!({"accepted":true,"filename":"live-telemetry"}));
        }
        let map_id = self.map_id(&id, auto_reconnect)?;
        match route {
            "/telemetry/clear" => {
                self.revision += 1;
                let map = self.maps.get_mut(&map_id).unwrap();
                map.tiles.clear();
                map.reset_revision = self.revision;
                Ok(json!({"cleared":true,"clientId":id}))
            }
            "/telemetry/merge" => {
                let mut result = self.merge(&map_id, &body["document"])?;
                result["merged"] = true.into();
                result["clientId"] = id.into();
                Ok(result)
            }
            "/telemetry/delete" => {
                let keys = selected_ids(&body["tileKeys"], MAX_TOTAL_TILES)?;
                let ids = selected_ids(&body["markerIds"], MAX_MARKERS)?;
                let map = self.maps.get_mut(&map_id).unwrap();
                let tiles = keys
                    .iter()
                    .filter(|key| map.tiles.remove(*key).is_some())
                    .count();
                let markers = ids
                    .iter()
                    .filter(|id| map.markers.remove(*id).is_some())
                    .count();
                map.marker_order.retain(|id| map.markers.contains_key(id));
                if tiles + markers > 0 {
                    self.revision += 1;
                }
                Ok(json!({"deleted":true,"clientId":id,"tiles":tiles,"markers":markers}))
            }
            "/telemetry/markers" => {
                let marker = parse_marker(&body["marker"])?;
                let marker_id = marker["id"].as_str().unwrap().to_owned();
                let map = self.maps.get_mut(&map_id).unwrap();
                require(
                    map.markers.contains_key(&marker_id) || map.markers.len() < MAX_MARKERS,
                    "A map may contain at most 512 markers.",
                )?;
                let changed = map.markers.get(&marker_id).is_none_or(|previous| {
                    !same_number(&previous["x"], &marker["x"])
                        || !same_number(&previous["y"], &marker["y"])
                        || previous["label"] != marker["label"]
                });
                if changed {
                    if !map.markers.contains_key(&marker_id) {
                        map.marker_order.push(marker_id.clone());
                    }
                    map.markers.insert(marker_id, marker.clone());
                    self.revision += 1;
                }
                Ok(json!({"saved":true,"clientId":id,"marker":marker}))
            }
            _ => Err("Unknown telemetry route.".to_string()),
        }
    }
}

fn selected_ids(value: &Value, maximum: usize) -> Result<Vec<String>> {
    let items = value
        .as_array()
        .filter(|items| items.len() <= maximum)
        .ok_or("Invalid map selection.")?;
    let ids: Vec<String> = items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|id| valid_id(id, 128, b"_.:,-"))
                .map(str::to_owned)
                .ok_or("Invalid selected identifier.".to_string())
        })
        .collect::<Result<_>>()?;
    require(
        ids.iter().collect::<HashSet<_>>().len() == ids.len(),
        "Selection identifiers must be unique.",
    )?;
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIRT: [u8; 4] = [120, 68, 0, 255];
    const QUARTZ: [u8; 4] = [221, 221, 221, 255];
    const BLACK: [u8; 4] = [0, 0, 0, 255];
    const UNKNOWN: [u8; 4] = [0, 0, 0, 0];

    fn store() -> TelemetryStore {
        let mut store = TelemetryStore::new();
        store.test_now = Some(1000);
        store
    }
    fn tile(key: &str, pixels: &[[u8; 4]]) -> Value {
        json!({"key":key,"x":0,"y":0,"width":64,"height":64,"pixelWidth":pixels.len(),"pixelHeight":1,
            "rgba":STANDARD.encode(pixels.concat())})
    }
    fn frame(tiles: Vec<Value>) -> Value {
        json!({"version":1,"source":"game","status":"live","message":"Native map test","buildHash":"a".repeat(64),
            "capturedAt":"2026-10-24T00:00:00.000Z","terrainMode":"materials-v1","world":{"centerX":0,"centerY":0,"radius":100},
            "player":{"x":0,"y":0,"normalizedX":0,"normalizedY":0},"camera":{"x":0,"y":0,"scale":1,"width":800,"height":600},"tiles":tiles})
    }
    fn marker(id: &str, label: &str) -> Value {
        json!({"id":id,"label":label,"x":20,"y":30})
    }
    fn saved(tiles: Vec<Value>, markers: Vec<Value>) -> Value {
        json!({"format":"digdig-chunks","version":1,"savedAt":"2026-10-24T00:00:00.000Z",
            "source":{"label":"Saved","buildHash":"a".repeat(64),"terrainMode":"materials-v1","world":{"centerX":0,"centerY":0,"radius":100}},"tiles":tiles,"markers":markers})
    }
    fn send(store: &mut TelemetryStore, id: &str, value: Value) {
        store
            .dispatch(
                "/reports",
                Some(&json!({"clientId":id,"kind":"map-frame","report":value})),
                &[],
                true,
            )
            .unwrap();
    }
    fn read(store: &mut TelemetryStore) -> Value {
        store.dispatch("/telemetry", None, &[], true).unwrap()
    }
    fn read_since(store: &mut TelemetryStore, revision: &Value) -> Value {
        store
            .dispatch(
                "/telemetry",
                None,
                &[("since".into(), revision.to_string())],
                true,
            )
            .unwrap()
    }
    fn pixels(tile: &Value) -> Vec<u8> {
        STANDARD.decode(tile["rgba"].as_str().unwrap()).unwrap()
    }
    fn command(store: &mut TelemetryStore, route: &str, body: Value) -> Value {
        store.dispatch(route, Some(&body), &[], true).unwrap()
    }

    #[test]
    fn full_size_material_refreshes_skip_deltas_but_preserve_partial_and_full_updates() {
        let mut store = store();
        let mut full = tile("large", &[DIRT]);
        full["pixelWidth"] = json!(64.0);
        full["pixelHeight"] = json!(64.0);
        full["rgba"] = STANDARD.encode(DIRT.repeat(4096)).into();
        send(&mut store, "one", frame(vec![full.clone()]));
        let before = read(&mut store);
        let mut jitter = full.clone();
        jitter["x"] = 0.005.into();
        send(&mut store, "one", frame(vec![jitter]));
        assert_eq!(
            read_since(&mut store, &before["revision"])["clients"][0]["tiles"],
            json!([])
        );

        let mut subset = DIRT.repeat(4096);
        for offset in (0..subset.len()).step_by(8) {
            subset[offset..offset + 4].fill(0);
        }
        let mut partial = full.clone();
        partial["rgba"] = STANDARD.encode(&subset).into();
        send(&mut store, "one", frame(vec![partial.clone()]));
        assert_eq!(
            read_since(&mut store, &before["revision"])["clients"][0]["tiles"],
            json!([])
        );
        assert_eq!(
            read(&mut store)["clients"][0]["tiles"][0]["rgba"],
            full["rgba"]
        );

        subset[4..8].copy_from_slice(&QUARTZ);
        partial["rgba"] = STANDARD.encode(&subset).into();
        send(&mut store, "one", frame(vec![partial]));
        let delta = read_since(&mut store, &before["revision"]);
        let changed = &delta["clients"][0]["tiles"][0];
        assert_eq!(changed["observedPixels"], 4096);
        assert_eq!(&pixels(changed)[..8], [DIRT, QUARTZ].concat());

        let mut replacement = full.clone();
        replacement["rgba"] = STANDARD.encode(QUARTZ.repeat(4096)).into();
        replacement["observedPixels"] = json!(0);
        send(&mut store, "one", frame(vec![replacement.clone()]));
        let current = read(&mut store);
        assert_eq!(
            current["clients"][0]["tiles"][0]["rgba"],
            replacement["rgba"]
        );
        assert_eq!(current["clients"][0]["tiles"][0]["observedPixels"], 4096);
    }

    #[test]
    fn retains_optional_app_versions_and_accepts_legacy_frames() {
        let mut store = store();
        let mut versioned = frame(vec![]);
        versioned["appVersion"] = "9.8.7-beta.1+report-test".into();
        send(&mut store, "one", versioned);
        let previous = read(&mut store);
        assert_eq!(
            previous["clients"][0]["frame"]["appVersion"],
            "9.8.7-beta.1+report-test"
        );
        assert_eq!(previous["clients"][0]["frame"]["version"], 1);
        for app_version in [
            json!(null),
            json!(2),
            json!({}),
            json!([]),
            json!(""),
            json!("bad version"),
            json!("x".repeat(129)),
        ] {
            let mut invalid = frame(vec![]);
            invalid["appVersion"] = app_version;
            assert!(store
                .dispatch(
                    "/reports",
                    Some(&json!({"clientId":"one","kind":"map-frame","report":invalid})),
                    &[],
                    true
                )
                .is_err());
            assert_eq!(read(&mut store), previous);
        }
        send(&mut store, "one", frame(vec![]));
        assert!(read(&mut store)["clients"][0]["frame"]
            .get("appVersion")
            .is_none());
    }

    #[test]
    fn game_sessions_share_tiles_and_markers_but_keep_distinct_poses_and_fixture_maps() {
        let mut store = store();
        send(
            &mut store,
            "one",
            frame(vec![
                tile("shared", &[DIRT, UNKNOWN]),
                tile("one", &[BLACK]),
            ]),
        );
        command(
            &mut store,
            "/telemetry/markers",
            json!({"clientId":"one","marker":marker("note","Return here")}),
        );
        let before = read(&mut store);
        let mut second = frame(vec![
            tile("shared", &[UNKNOWN, QUARTZ]),
            tile("two", &[DIRT]),
        ]);
        second["player"]["x"] = 50.into();
        send(&mut store, "two", second);
        let mut fixture = frame(vec![tile("fixture", &[DIRT])]);
        fixture["source"] = "fixture".into();
        send(&mut store, "fixture", fixture);
        let full = read(&mut store);
        let clients = full["clients"].as_array().unwrap();
        assert_eq!(clients[0]["mapId"], clients[1]["mapId"]);
        assert_ne!(clients[0]["mapId"], clients[2]["mapId"]);
        assert_eq!(clients[0]["frame"]["player"]["x"], 0);
        assert_eq!(clients[1]["frame"]["player"]["x"], 50);
        assert_eq!(clients[0]["markers"][0]["label"], "Return here");
        assert_eq!(clients[1]["mapData"], false);
        assert_eq!(clients[1]["tiles"], json!([]));
        assert_eq!(clients[2]["tileKeys"], json!(["fixture"]));
        let shared = clients[0]["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tile| tile["key"] == "shared")
            .unwrap();
        assert_eq!(pixels(shared), [DIRT, QUARTZ].concat());
        let delta = read_since(&mut store, &before["revision"]);
        assert_eq!(
            delta["clients"][0]["tiles"]
                .as_array()
                .unwrap()
                .iter()
                .map(|tile| tile["key"].clone())
                .collect::<Vec<_>>(),
            vec![json!("shared"), json!("two")]
        );
        let filtered = store
            .dispatch(
                "/telemetry",
                None,
                &[("clientId".into(), "two".into())],
                true,
            )
            .unwrap();
        assert_eq!(filtered["clients"][0]["mapData"], true);
        assert_eq!(filtered["clients"][0]["tiles"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn incremental_reads_skip_unchanged_fog_and_jitter_but_deliver_updates_and_clear_resets() {
        let mut store = store();
        send(
            &mut store,
            "one",
            frame(vec![
                tile("known", &[BLACK, UNKNOWN]),
                tile("second", &[DIRT]),
            ]),
        );
        let before = read(&mut store);
        let mut repeated = tile("known", &[BLACK, UNKNOWN]);
        repeated["x"] = 0.001.into();
        send(
            &mut store,
            "one",
            frame(vec![repeated, tile("unseen", &[UNKNOWN])]),
        );
        let unchanged = read_since(&mut store, &before["revision"]);
        assert_eq!(unchanged["clients"][0]["tiles"], json!([]));
        assert_eq!(
            unchanged["clients"][0]["tileKeys"],
            json!(["second", "known"])
        );
        assert_eq!(unchanged["clients"][0]["resetTiles"], false);
        send(
            &mut store,
            "one",
            frame(vec![tile("known", &[UNKNOWN, QUARTZ])]),
        );
        let delta = read_since(&mut store, &before["revision"]);
        assert_eq!(delta["clients"][0]["tiles"].as_array().unwrap().len(), 1);
        assert_eq!(
            pixels(&delta["clients"][0]["tiles"][0]),
            [BLACK, QUARTZ].concat()
        );
        command(
            &mut store,
            "/telemetry/markers",
            json!({"clientId":"one","marker":marker("note","Keep me")}),
        );
        command(&mut store, "/telemetry/clear", json!({"clientId":"one"}));
        let cleared = read_since(&mut store, &before["revision"]);
        assert_eq!(cleared["clients"][0]["tileKeys"], json!([]));
        assert_eq!(cleared["clients"][0]["resetTiles"], true);
        assert_eq!(
            cleared["clients"][0]["markers"].as_array().unwrap().len(),
            1
        );
        assert_eq!(cleared["clients"][0]["lastSeen"], 1000);
        send(&mut store, "one", frame(vec![tile("rescanned", &[DIRT])]));
        assert_eq!(
            read_since(&mut store, &before["revision"])["clients"][0]["tiles"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn saved_materials_fill_unknowns_and_keep_live_pixels_position_and_marker_conflicts() {
        let mut store = store();
        send(
            &mut store,
            "one",
            frame(vec![tile("shared", &[QUARTZ, UNKNOWN, BLACK])]),
        );
        command(
            &mut store,
            "/telemetry/markers",
            json!({"clientId":"one","marker":marker("z-first","Current note")}),
        );
        let before = read(&mut store);
        let document = saved(
            vec![
                tile("shared", &[DIRT, DIRT, UNKNOWN]),
                tile("new", &[QUARTZ]),
                tile("empty", &[UNKNOWN]),
            ],
            vec![
                marker("z-first", "Old note"),
                marker("a-second", "New note"),
            ],
        );
        store.test_now = Some(2000);
        let result = command(
            &mut store,
            "/telemetry/merge",
            json!({"clientId":"one","document":document}),
        );
        assert_eq!(result["tiles"], 2);
        assert_eq!(result["markers"], 1);
        let merged = read_since(&mut store, &before["revision"]);
        let client = &merged["clients"][0];
        assert_eq!(pixels(&client["tiles"][0]), [QUARTZ, DIRT, BLACK].concat());
        assert_eq!(client["tiles"][0]["observedPixels"], 3);
        assert_eq!(client["markers"][0]["id"], "z-first");
        assert_eq!(client["markers"][0]["label"], "Current note");
        assert_eq!(client["markers"][1]["id"], "a-second");
        assert_eq!(client["lastSeen"], 1000);
        assert_eq!(client["frame"], before["clients"][0]["frame"]);
        let again = command(
            &mut store,
            "/telemetry/merge",
            json!({"clientId":"one","document":document}),
        );
        assert_eq!(again["tiles"], 0);
        assert_eq!(again["markers"], 0);
        assert_eq!(read(&mut store)["revision"], merged["revision"]);
    }

    #[test]
    fn raw_imports_preserve_newer_partial_alpha_pixels_and_fill_only_transparent_holes() {
        let mut store = store();
        let partial = [11, 22, 33, 127];
        let mut raw = frame(vec![tile("raw", &[partial, UNKNOWN])]);
        raw.as_object_mut().unwrap().remove("terrainMode");
        raw["source"] = "fixture".into();
        raw["buildHash"] = Value::Null;
        send(&mut store, "fixture", raw);
        let mut document = saved(vec![tile("raw", &[DIRT, QUARTZ])], vec![]);
        document["source"]
            .as_object_mut()
            .unwrap()
            .remove("terrainMode");
        document["source"]["buildHash"] = Value::Null;
        command(
            &mut store,
            "/telemetry/merge",
            json!({"clientId":"fixture","document":document}),
        );
        let merged = read(&mut store);
        assert_eq!(
            pixels(&merged["clients"][0]["tiles"][0]),
            [partial, QUARTZ].concat()
        );
        assert!(merged["clients"][0]["tiles"][0]
            .get("observedPixels")
            .is_none());
    }

    #[test]
    fn incompatible_or_malformed_imports_leave_map_and_revision_completely_unchanged() {
        let mut store = store();
        send(
            &mut store,
            "one",
            frame(vec![tile("shared", &[QUARTZ, UNKNOWN])]),
        );
        let before = read(&mut store);
        let base = saved(vec![tile("shared", &[DIRT, BLACK])], vec![]);
        let mut candidates = vec![];
        let mut bad = base.clone();
        bad["tiles"] = json!([tile("new", &[DIRT]), tile("shared", &[BLACK])]);
        candidates.push(bad);
        let mut bad = base.clone();
        bad["tiles"] = json!([tile("new", &[DIRT]), tile("shared", &[BLACK, DIRT])]);
        bad["tiles"][1]["x"] = 10.into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["source"]["buildHash"] = "b".repeat(64).into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["source"]["world"]["centerX"] = 4.into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["source"].as_object_mut().unwrap().remove("terrainMode");
        candidates.push(bad);
        let mut bad = base.clone();
        bad["tiles"][0]["rgba"] = "invalid".into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["tiles"][0]["rgba"] = STANDARD.encode([DIRT, [12, 0, 0, 0]].concat()).into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["markers"] = json!([marker("duplicate", "one"), marker("duplicate", "two")]);
        candidates.push(bad);
        let mut bad = base.clone();
        bad["markers"] = json!([marker("bad", " ")]);
        candidates.push(bad);
        let mut bad = base.clone();
        bad["savedAt"] = "2026-02-30T00:00:00.000Z".into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["tiles"] = (0..1024)
            .map(|i| tile(&format!("new-{i}"), &[DIRT]))
            .collect::<Vec<_>>()
            .into();
        candidates.push(bad);
        for candidate in candidates {
            assert!(store
                .dispatch(
                    "/telemetry/merge",
                    Some(&json!({"clientId":"one","document":candidate})),
                    &[],
                    true
                )
                .is_err());
            assert_eq!(read(&mut store), before);
        }
    }

    #[test]
    fn rejected_frames_and_selections_do_not_mutate_live_data() {
        let mut store = store();
        send(&mut store, "one", frame(vec![tile("known", &[DIRT])]));
        let before = read(&mut store);
        let base = frame(vec![]);
        let mut candidates = vec![];
        let mut bad = base.clone();
        bad["camera"]["width"] = 1.5.into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["world"]["radius"] = 0.into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["buildHash"] = Value::Null;
        candidates.push(bad);
        let mut bad = base.clone();
        bad["capturedAt"] = "2026-10-24T25:00:00.000Z".into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["message"] = "x".repeat(513).into();
        candidates.push(bad);
        let mut bad = base.clone();
        bad["tiles"] = json!([tile("same", &[DIRT]), tile("same", &[QUARTZ])]);
        candidates.push(bad);
        let mut bad = base.clone();
        bad["tiles"] = json!([tile("tinted", &[[1, 0, 0, 0]])]);
        candidates.push(bad);
        let mut bad = base.clone();
        bad["status"] = "waiting".into();
        bad["tiles"] = json!([tile("bad", &[DIRT])]);
        candidates.push(bad);
        let mut bad = base.clone();
        bad.as_object_mut().unwrap().remove("player");
        candidates.push(bad);
        for candidate in candidates {
            assert!(store
                .dispatch(
                    "/reports",
                    Some(&json!({"clientId":"one","kind":"map-frame","report":candidate})),
                    &[],
                    true
                )
                .is_err());
            assert_eq!(read(&mut store), before);
        }
        for (keys, markers) in [
            (json!(["known", "known"]), json!([])),
            (json!(["known"]), json!(["invalid/path"])),
            (json!("known"), json!([])),
        ] {
            assert!(store
                .dispatch(
                    "/telemetry/delete",
                    Some(&json!({"clientId":"one","tileKeys":keys,"markerIds":markers})),
                    &[],
                    true
                )
                .is_err());
            assert_eq!(read(&mut store), before);
        }
    }

    #[test]
    fn reload_cleanup_and_waiting_or_unsupported_frames_keep_shared_discoveries_without_pose() {
        let mut store = store();
        send(&mut store, "old", frame(vec![tile("old", &[DIRT])]));
        command(
            &mut store,
            "/telemetry/markers",
            json!({"clientId":"old","marker":marker("note","Keep")}),
        );
        store.test_now = Some(6001);
        let mut waiting = frame(vec![]);
        waiting["status"] = "waiting".into();
        waiting["buildHash"] = Value::Null;
        for key in ["world", "player", "camera", "terrainMode"] {
            waiting.as_object_mut().unwrap().remove(key);
        }
        send(&mut store, "new", waiting.clone());
        let state = read(&mut store);
        assert_eq!(state["clients"].as_array().unwrap().len(), 2);
        assert!(state["clients"][1]["frame"].get("player").is_none());
        send(&mut store, "new", frame(vec![tile("new", &[QUARTZ])]));
        let state = read(&mut store);
        assert_eq!(state["clients"].as_array().unwrap().len(), 1);
        assert_eq!(state["clients"][0]["tileKeys"], json!(["old", "new"]));
        waiting["status"] = "unsupported".into();
        send(&mut store, "new", waiting);
        let state = read(&mut store);
        assert_eq!(state["clients"][0]["tileKeys"], json!(["old", "new"]));
        assert!(state["clients"][0]["frame"].get("camera").is_none());
        store.test_now = Some(12002);
        assert_eq!(
            command(&mut store, "/telemetry/cleanup", json!({}))["removed"],
            json!(["new"])
        );
        let state = read(&mut store);
        assert_eq!(state["clients"][0]["clientId"], GAME_CLIENT);
        assert_eq!(state["clients"][0]["mapOnly"], true);
        assert!(state["clients"][0]["frame"].get("player").is_none());
        command(
            &mut store,
            "/telemetry/merge",
            json!({"clientId":GAME_CLIENT,"document":saved(vec![tile("imported", &[BLACK])],vec![])}),
        );
        assert_eq!(
            read(&mut store)["clients"][0]["tiles"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }

    #[test]
    fn optional_auto_reconnect_preserves_inactive_games_and_manual_cleanup_excludes_fixtures() {
        let mut store = store();
        store.dispatch("/reports",Some(&json!({"clientId":"old","kind":"map-frame","report":frame(vec![tile("old", &[DIRT])])})),&[],false).unwrap();
        let mut fixture = frame(vec![tile("fixture", &[QUARTZ])]);
        fixture["source"] = "fixture".into();
        send(&mut store, "fixture", fixture);
        store.test_now = Some(7000);
        assert_eq!(
            store.dispatch("/telemetry", None, &[], false).unwrap()["clients"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            store
                .dispatch("/telemetry/cleanup", Some(&json!({})), &[], false)
                .unwrap()["removed"],
            json!(["old"])
        );
        let state = read(&mut store);
        assert_eq!(state["clients"][0]["clientId"], "fixture");
        assert_eq!(state["clients"][1]["clientId"], GAME_CLIENT);
        assert_eq!(state["clients"][0]["tileKeys"], json!(["fixture"]));
    }

    #[test]
    fn terrain_mode_switch_requires_clear_and_fixture_world_discontinuity_resets_its_map() {
        let mut store = store();
        send(&mut store, "one", frame(vec![tile("materials", &[DIRT])]));
        let mut raw = frame(vec![tile("raw", &[QUARTZ])]);
        raw.as_object_mut().unwrap().remove("terrainMode");
        send(&mut store, "two", raw.clone());
        assert_eq!(
            read(&mut store)["clients"][0]["tileKeys"],
            json!(["materials"])
        );
        command(&mut store, "/telemetry/clear", json!({"clientId":"two"}));
        send(&mut store, "two", raw);
        assert_eq!(read(&mut store)["clients"][0]["tileKeys"], json!(["raw"]));
        let mut fixture = frame(vec![tile("fixture", &[DIRT])]);
        fixture["source"] = "fixture".into();
        send(&mut store, "fixture", fixture.clone());
        let before = read(&mut store);
        fixture["world"]["centerX"] = 50.into();
        fixture["tiles"] = json!([]);
        send(&mut store, "fixture", fixture);
        let after = read_since(&mut store, &before["revision"]);
        assert_eq!(after["clients"][2]["resetTiles"], true);
        assert_eq!(after["clients"][2]["tileKeys"], json!([]));
    }

    #[test]
    fn bounded_live_cache_evicts_oldest_observation_and_eight_shared_sessions_count_once() {
        let mut store = store();
        for index in 0..1025 {
            send(
                &mut store,
                "one",
                frame(vec![tile(&format!("tile-{index}"), &[DIRT])]),
            );
        }
        for index in 1..8 {
            send(&mut store, &format!("tab-{index}"), frame(vec![]));
        }
        let full = read(&mut store);
        let clients = full["clients"].as_array().unwrap();
        assert_eq!(
            clients
                .iter()
                .map(|client| client["tiles"].as_array().unwrap().len())
                .sum::<usize>(),
            1024
        );
        assert_eq!(
            clients[0]["tileKeys"].as_array().unwrap().first().unwrap(),
            "tile-1"
        );
        assert!(store
            .dispatch(
                "/reports",
                Some(&json!({"clientId":"overflow","kind":"map-frame","report":frame(vec![])})),
                &[],
                true
            )
            .is_err());
        store.test_now = Some(6001);
        send(&mut store, "replacement", frame(vec![]));
        let after = read(&mut store);
        assert_eq!(after["clients"].as_array().unwrap().len(), 1);
        assert_eq!(after["clients"][0]["tiles"].as_array().unwrap().len(), 1024);
    }

    #[test]
    fn timestamp_validation_checks_calendar_dates_and_canonical_utc_precision() {
        for valid in [
            "2000-02-29T23:59:59.999Z",
            "2026-10-24T00:00:00.000Z",
            "0000-01-01T00:00:00.000Z",
        ] {
            assert!(valid_timestamp(&json!(valid)));
        }
        for invalid in [
            "1900-02-29T00:00:00.000Z",
            "2026-04-31T00:00:00.000Z",
            "2026-13-01T00:00:00.000Z",
            "2026-10-24T00:00:00Z",
            "2026-10-24T00:00:00.000+00:00",
            "2026-10-24T00:00:60.000Z",
        ] {
            assert!(!valid_timestamp(&json!(invalid)));
        }
    }

    #[test]
    fn native_store_replays_the_development_bridges_recorded_protocol() {
        let steps: Vec<Value> =
            serde_json::from_str(include_str!("../../test/fixtures/native-protocol.json")).unwrap();
        let mut store = store();
        for (index, step) in steps.iter().enumerate() {
            store.test_now = step["at"].as_u64();
            let query: Vec<(String, String)> =
                serde_json::from_value(step["query"].clone()).unwrap();
            let result = store.dispatch(
                step["route"].as_str().unwrap(),
                step.get("body"),
                &query,
                step["auto"].as_bool().unwrap(),
            );
            if step["error"] == true {
                assert!(
                    result.is_err(),
                    "Step {index} should reject invalid input: {step}"
                );
            } else {
                let result = result.unwrap_or_else(|error| panic!("Step {index} failed: {error}"));
                if let Some(expected) = step.get("expected") {
                    assert_eq!(
                        &result, expected,
                        "Protocol mismatch at step {index}: {}",
                        step["route"]
                    );
                }
            }
        }
    }
}
