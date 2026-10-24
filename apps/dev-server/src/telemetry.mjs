import { validateChunksDocument, validateMapMarker, MAX_MAP_MARKERS } from '../../../packages/terrain/src/chunks.ts';

// Live frames are transient. Diagnostic reports continue to be written to disk.
export const MAX_FRAME_TILES = 32;
export const MAX_CACHED_TILES = 256;
export const MAX_MATERIAL_CACHED_TILES = 1024;
export const MAX_TOTAL_CACHED_TILES = 2048;
export const MAX_TELEMETRY_CLIENTS = 8;
export const TELEMETRY_STALE_MS = 5_000;
export const TELEMETRY_TTL_MS = 5 * 60_000;
export const MAX_CACHED_MARKERS = MAX_MAP_MARKERS;

export class TelemetryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function expect(condition, message) {
  if (!condition) throw new TelemetryError(message);
}

function record(value, name) {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object.`);
  return value;
}

function number(value, name, { min = -1e9, max = 1e9, integer = false } = {}) {
  expect(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value)), `${name} must be a finite ${integer ? 'integer' : 'number'} between ${min} and ${max}.`);
  return value;
}

function geometry(value, name, fields) {
  record(value, name);
  return Object.fromEntries(Object.entries(fields).map(([key, limits]) => [key, number(value[key], `${name}.${key}`, limits)]));
}

function parseTile(value, materialsOnly) {
  record(value, 'tile');
  expect(typeof value.key === 'string' && /^[A-Za-z0-9_.:,\-]{1,128}$/.test(value.key), 'tile.key must contain 1–128 letters, digits, dots, colons, commas, underscores, or hyphens.');
  const result = {
    key: value.key,
    ...geometry(value, 'tile', {
      x: {}, y: {}, width: { min: Number.MIN_VALUE, max: 1e7 }, height: { min: Number.MIN_VALUE, max: 1e7 },
      pixelWidth: { min: 1, max: 64, integer: true }, pixelHeight: { min: 1, max: 64, integer: true },
    }),
  };
  const expectedBytes = result.pixelWidth * result.pixelHeight * 4;
  expect(typeof value.rgba === 'string' && value.rgba.length === 4 * Math.ceil(expectedBytes / 3)
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value.rgba), 'tile.rgba must be base64 for exactly pixelWidth × pixelHeight × 4 bytes.');
  const decoded = Buffer.from(value.rgba, 'base64');
  expect(decoded.length === expectedBytes && decoded.toString('base64') === value.rgba, 'tile.rgba must contain canonical RGBA base64.');
  if (materialsOnly) {
    let observedPixels = 0;
    for (let offset = 0; offset < decoded.length; offset += 4) {
      const alpha = decoded[offset + 3];
      expect(alpha === 0 || alpha === 255, 'Material pixels must be fully opaque observations or transparent unknowns.');
      expect(alpha === 255 || (decoded[offset] === 0 && decoded[offset + 1] === 0 && decoded[offset + 2] === 0),
        'Unknown material pixels must use zero RGBA bytes.');
      if (alpha === 255) observedPixels++;
    }
    result.observedPixels = observedPixels;
  }
  return { ...result, rgba: value.rgba };
}

export function parseMapFrame(value) {
  record(value, 'map frame');
  expect(value.version === 1, 'map frame version must be 1.');
  expect(value.appVersion === undefined || (typeof value.appVersion === 'string'
    && /^[A-Za-z0-9.+-]{1,128}$/.test(value.appVersion)), 'appVersion must be a package version of at most 128 characters.');
  expect(['game', 'fixture'].includes(value.source), 'map frame source must be game or fixture.');
  expect(['waiting', 'unsupported', 'live', 'error'].includes(value.status), 'Unknown map frame status.');
  expect(typeof value.message === 'string' && value.message.length <= 512, 'map frame message must contain at most 512 characters.');
  expect(value.buildHash === null || (typeof value.buildHash === 'string' && /^[a-f0-9]{64}$/.test(value.buildHash)), 'buildHash must be a SHA-256 hex string or null.');
  expect(typeof value.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt)
    && Number.isFinite(Date.parse(value.capturedAt)) && new Date(value.capturedAt).toISOString() === value.capturedAt,
  'capturedAt must be a UTC ISO timestamp.');
  expect(Array.isArray(value.tiles) && value.tiles.length <= MAX_FRAME_TILES, `A map frame may contain at most ${MAX_FRAME_TILES} tiles.`);
  expect(value.terrainMode === undefined || value.terrainMode === 'materials-v1', 'Unknown terrain observation mode.');
  const result = {
    version: 1, source: value.source, status: value.status, message: value.message,
    buildHash: value.buildHash, capturedAt: value.capturedAt,
  };
  if (value.terrainMode !== undefined) result.terrainMode = value.terrainMode;
  if (value.appVersion !== undefined) result.appVersion = value.appVersion;
  if (value.world !== undefined) result.world = geometry(value.world, 'world', {
    centerX: {}, centerY: {}, radius: { min: Number.MIN_VALUE, max: 1e7 },
  });
  if (value.player !== undefined) result.player = geometry(value.player, 'player', {
    x: {}, y: {}, normalizedX: {}, normalizedY: {},
  });
  if (value.camera !== undefined) result.camera = geometry(value.camera, 'camera', {
    x: {}, y: {}, scale: { min: Number.MIN_VALUE, max: 1e6 },
    width: { min: 1, max: 32768, integer: true }, height: { min: 1, max: 32768, integer: true },
  });
  if (value.status === 'live') {
    expect(result.world && result.player && result.camera, 'A live map frame requires world, player, and camera data.');
    expect(value.source !== 'game' || value.buildHash !== null, 'A live game frame requires its build hash.');
  } else {
    expect(value.tiles.length === 0, 'Only live map frames may contain terrain tiles.');
  }
  result.tiles = value.tiles.map((tile) => parseTile(tile, value.terrainMode === 'materials-v1'));
  expect(new Set(result.tiles.map(({ key }) => key)).size === result.tiles.length, 'Tile keys must be unique within a frame.');
  return result;
}

function sameWorld(previous, next) {
  if (!previous || !next) return previous === next;
  // Map radius varies with player count; retain terrain during gradual resizing.
  const ratio = next.radius / previous.radius;
  return previous.centerX === next.centerX && previous.centerY === next.centerY && ratio >= 0.5 && ratio <= 2;
}

function sameTileGeometry(previous, next) {
  if (previous.pixelWidth !== next.pixelWidth || previous.pixelHeight !== next.pixelHeight) return false;
  // Camera inversion introduces tiny f32 jitter. A key reused for a genuinely
  // different rectangle must not inherit discoveries from the old rectangle.
  const tolerance = Math.max(0.01, Math.min(previous.width, previous.height, next.width, next.height) * 1e-4);
  return ['x', 'y', 'width', 'height'].every((field) => Math.abs(previous[field] - next[field]) <= tolerance);
}

function mergeMaterialTile(previous, next) {
  // A fog-only observation is absence of knowledge, not an instruction to erase.
  // In particular, opaque black is a known material and must not be discarded.
  if (next.observedPixels === 0) return null;
  if (!previous || !sameTileGeometry(previous, next)) return next;
  // Counts and canonical bytes have already been validated by parseTile. A
  // refresh or fully observed replacement needs no decode/merge/encode pass.
  if (previous.rgba === next.rgba) return previous;
  if (next.observedPixels === next.pixelWidth * next.pixelHeight) return next;
  const pixels = Buffer.from(previous.rgba, 'base64');
  const incoming = Buffer.from(next.rgba, 'base64');
  let observedPixels = previous.observedPixels;
  let changed = false;
  for (let offset = 0; offset < incoming.length; offset += 4) {
    if (incoming[offset + 3] !== 255) continue;
    if (pixels[offset] === incoming[offset] && pixels[offset + 1] === incoming[offset + 1]
      && pixels[offset + 2] === incoming[offset + 2] && pixels[offset + 3] === 255) continue;
    if (pixels[offset + 3] !== 255) observedPixels++;
    pixels[offset] = incoming[offset]; pixels[offset + 1] = incoming[offset + 1];
    pixels[offset + 2] = incoming[offset + 2]; pixels[offset + 3] = 255;
    changed = true;
  }
  return changed ? { ...next, rgba: pixels.toString('base64'), observedPixels } : previous;
}

function validated(validator, value) {
  try { return validator(value); }
  catch (error) { throw new TelemetryError(error.message); }
}

function selectedIds(value, name, maximum, pattern) {
  expect(Array.isArray(value) && value.length <= maximum, `${name} must be an array containing at most ${maximum} identifiers.`);
  expect(value.every((id) => typeof id === 'string' && pattern.test(id)), `${name} contains an invalid identifier.`);
  expect(new Set(value).size === value.length, `${name} must not contain duplicate identifiers.`);
  return value;
}

// A saved map is older evidence: it fills holes without replacing newer live
// observations. The subsequent live stream can still update imported pixels.
function importTile(previous, incoming, materialsOnly) {
  if (materialsOnly && incoming.observedPixels === 0) return previous;
  if (!previous) return incoming;
  expect(sameTileGeometry(previous, incoming), `Chunk ${incoming.key} uses a different pixel grid or position. Use Preview for this file.`);
  const pixels = Buffer.from(previous.rgba, 'base64');
  const saved = Buffer.from(incoming.rgba, 'base64');
  let changed = false;
  let observedPixels = previous.observedPixels;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] !== 0 || saved[offset + 3] === 0) continue;
    saved.copy(pixels, offset, offset, offset + 4);
    if (materialsOnly) observedPixels++;
    changed = true;
  }
  return changed ? { ...previous, rgba: pixels.toString('base64'), ...(materialsOnly ? { observedPixels } : {}) } : previous;
}

export const SHARED_GAME_MAP_ID = 'game-shared';
export const SHARED_GAME_CLIENT_ID = 'game-map';

function emptyMap(mapId, revision = 0) {
  return { mapId, tiles: new Map(), markers: new Map(), resetRevision: revision, frame: null, lastSeen: 0 };
}

export class TelemetryStore {
  #clients = new Map();
  #game = emptyMap(SHARED_GAME_MAP_ID);
  #now;
  #autoReconnect;
  #tileUpdateOrder = new WeakMap();
  #tileRevision = new WeakMap();
  #nextTileUpdate = 0;
  #revision = 0;

  constructor({ now = Date.now, autoReconnect = true } = {}) {
    this.#now = now;
    this.#autoReconnect = typeof autoReconnect === 'function' ? autoReconnect : () => autoReconnect;
  }

  #prune() {
    const now = this.#now(), auto = this.#autoReconnect();
    const freshGame = auto && [...this.#clients.values()].some(entry => entry.frame.source === 'game'
      && entry.frame.status === 'live' && now - entry.lastSeen <= TELEMETRY_STALE_MS);
    let changed = false;
    for (const [id, entry] of this.#clients) {
      const game = entry.frame.source === 'game';
      if ((game && auto && freshGame && now - entry.lastSeen > TELEMETRY_STALE_MS)
        || ((!game || auto) && now - entry.lastSeen > TELEMETRY_TTL_MS)) {
        this.#clients.delete(id);
        changed = true;
      }
    }
    if (changed) this.#revision++;
  }

  cleanupInactiveGames() {
    const now = this.#now(), removed = [];
    for (const [id, entry] of this.#clients) if (entry.frame.source === 'game' && now - entry.lastSeen > TELEMETRY_STALE_MS) {
      this.#clients.delete(id); removed.push(id);
    }
    if (removed.length) this.#revision++;
    return removed;
  }

  #maps() { return [...new Set([this.#game, ...[...this.#clients.values()].map(entry => entry.map)])]; }

  #enforceTotalTileLimit() {
    const maps = this.#maps();
    let total = maps.reduce((count, map) => count + map.tiles.size, 0);
    while (total > MAX_TOTAL_CACHED_TILES) {
      let oldest;
      for (const map of maps) {
        const first = map.tiles.entries().next().value;
        if (!first) continue;
        const [key, tile] = first, order = this.#tileUpdateOrder.get(tile);
        if (!oldest || order < oldest.order) oldest = { map, key, order };
      }
      if (!oldest) break;
      oldest.map.tiles.delete(oldest.key); total--;
    }
  }

  update(clientId, value) {
    expect(clientId !== SHARED_GAME_CLIENT_ID, 'This client ID is reserved for the shared game map.');
    const frame = parseMapFrame(value);
    this.#prune();
    let entry = this.#clients.get(clientId);
    if (!entry) {
      // A reload should still reconnect when stale tabs have filled the limit.
      if (frame.source === 'game' && frame.status === 'live' && this.#autoReconnect()) this.cleanupInactiveGames();
      if (this.#clients.size >= MAX_TELEMETRY_CLIENTS) throw new TelemetryError('Too many live map clients. Remove inactive sessions in Settings.', 429);
      entry = { clientId, firstSeen: this.#now(), lastSeen: 0, frame: null, map: null };
      this.#clients.set(clientId, entry);
    }
    const revision = ++this.#revision;
    const previous = entry.frame;
    if (frame.source === 'game') {
      entry.map = this.#game;
      // Sessions own their pose, never their discovered terrain. Waiting,
      // unsupported, new hashes, and tab replacement cannot erase this map.
      if (frame.status === 'live') {
        const compatibleMode = !this.#game.frame || this.#game.tiles.size === 0
          || this.#game.frame.terrainMode === frame.terrainMode;
        if (compatibleMode) {
          this.#game.frame = { ...frame, tiles: [] };
          this.#game.lastSeen = this.#now();
          this.#writeTiles(this.#game, frame, revision);
        } else {
          frame.message = `${frame.message} This session uses a different terrain mode; clear the shared map before capturing it.`.slice(0, 512);
        }
      }
    } else {
      const sameSource = previous && previous.source === frame.source && previous.buildHash === frame.buildHash
        && previous.terrainMode === frame.terrainMode;
      const retainMaterials = sameSource && frame.terrainMode === 'materials-v1'
        && frame.status !== 'unsupported' && previous.status !== 'unsupported';
      if (retainMaterials && frame.world === undefined && previous.world !== undefined) frame.world = { ...previous.world };
      const retain = sameSource && sameWorld(previous.world, frame.world)
        && (retainMaterials || (frame.status === 'live' && previous.status === 'live'));
      if (!retain) entry.map = emptyMap(`fixture:${clientId}`, revision);
      entry.map.frame = { ...frame, tiles: [] };
      entry.map.lastSeen = this.#now();
      this.#writeTiles(entry.map, frame, revision);
    }
    this.#enforceTotalTileLimit();
    entry.lastSeen = this.#now();
    entry.frame = { ...frame, tiles: [] };
    this.#prune();
  }

  #writeTiles(map, frame, revision) {
    for (const tile of frame.tiles) {
      const previousTile = map.tiles.get(tile.key);
      let updated = frame.terrainMode === 'materials-v1' ? mergeMaterialTile(previousTile, tile) : tile;
      if (!updated) continue;
      if (previousTile && sameTileGeometry(previousTile, updated) && previousTile.rgba === updated.rgba) updated = previousTile;
      else this.#tileRevision.set(updated, revision);
      map.tiles.delete(tile.key); map.tiles.set(tile.key, updated);
      this.#tileUpdateOrder.set(updated, ++this.#nextTileUpdate);
      const limit = frame.terrainMode === 'materials-v1' ? MAX_MATERIAL_CACHED_TILES : MAX_CACHED_TILES;
      if (map.tiles.size > limit) map.tiles.delete(map.tiles.keys().next().value);
    }
  }

  #virtualGame() {
    if (!this.#game.frame && !this.#game.markers.size && !this.#game.tiles.size) return null;
    const source = this.#game.frame;
    return { clientId: SHARED_GAME_CLIENT_ID, mapOnly: true, firstSeen: this.#game.lastSeen,
      lastSeen: this.#game.lastSeen, map: this.#game,
      frame: { version: 1, source: 'game', status: 'waiting',
        message: 'Shared game map. Waiting for a game session.', buildHash: source?.buildHash ?? null,
        capturedAt: source?.capturedAt ?? new Date(this.#game.lastSeen).toISOString(),
        ...(source?.terrainMode ? { terrainMode: source.terrainMode } : {}),
        ...(source?.world ? { world: { ...source.world } } : {}), tiles: [] } };
  }

  #entries(clientId) {
    const entries = [...this.#clients.values()];
    if (!entries.some(entry => entry.frame.source === 'game')) {
      const virtual = this.#virtualGame(); if (virtual) entries.push(virtual);
    }
    return entries.filter(entry => clientId === undefined || entry.clientId === clientId);
  }

  #mapFrame(map) {
    return { buildHash: map.frame?.buildHash ?? null,
      ...(map.frame?.terrainMode ? { terrainMode: map.frame.terrainMode } : {}),
      ...(map.frame?.world ? { world: { ...map.frame.world } } : {}) };
  }

  #metadata(entry) {
    return { clientId: entry.clientId, mapId: entry.map.mapId,
      ...(entry.mapOnly ? { mapOnly: true } : {}), firstSeen: entry.firstSeen, lastSeen: entry.lastSeen,
      stale: this.#now() - entry.lastSeen > TELEMETRY_STALE_MS, frame: structuredClone(entry.frame) };
  }

  snapshot(clientId) {
    this.#prune();
    return this.#entries(clientId).map(entry => ({ ...this.#metadata(entry), mapData: true,
      mapFrame: this.#mapFrame(entry.map), tiles: [...entry.map.tiles.values()].map(tile => ({ ...tile })),
      markers: [...entry.map.markers.values()].map(marker => ({ ...marker })) }));
  }

  #entry(clientId) {
    this.#prune();
    const entry = this.#clients.get(clientId) ?? (clientId === SHARED_GAME_CLIENT_ID ? this.#virtualGame() : null);
    if (!entry) throw new TelemetryError('Map client not found.', 404);
    return entry;
  }

  clear(clientId) {
    const { map } = this.#entry(clientId);
    map.tiles.clear(); map.resetRevision = ++this.#revision;
  }

  merge(clientId, value) {
    const document = validated(validateChunksDocument, value);
    const entry = this.#entry(clientId), map = entry.map;
    const current = map.frame ?? entry.frame;
    expect(current.world && current.status !== 'unsupported', 'This session has no recognized map yet. Use Preview to view the file independently.');
    expect(current.terrainMode === document.source.terrainMode, 'The file uses a different terrain mode. Use Preview for this file.');
    expect(!current.buildHash || !document.source.buildHash || current.buildHash === document.source.buildHash,
      'The file comes from a different game build. Use Preview for this file.');
    expect(!document.source.world || (current.world.centerX === document.source.world.centerX
      && current.world.centerY === document.source.world.centerY), 'The file uses a different map center. Use Preview for this file.');
    const nextTiles = new Map(map.tiles), nextMarkers = new Map(map.markers), changedTiles = [];
    for (const tile of document.tiles) {
      const previous = nextTiles.get(tile.key), merged = importTile(previous, tile, current.terrainMode === 'materials-v1');
      if (!merged || merged === previous) continue;
      nextTiles.set(tile.key, merged); changedTiles.push(merged);
    }
    for (const marker of document.markers ?? []) if (!nextMarkers.has(marker.id)) nextMarkers.set(marker.id, marker);
    const tileLimit = current.terrainMode === 'materials-v1' ? MAX_MATERIAL_CACHED_TILES : MAX_CACHED_TILES;
    expect(nextTiles.size <= tileLimit, `Merging would exceed this map's ${tileLimit}-chunk limit. Clear some chunks or use Preview.`);
    const total = this.#maps().reduce((sum, item) => sum + (item === map ? nextTiles.size : item.tiles.size), 0);
    expect(total <= MAX_TOTAL_CACHED_TILES, `Merging would exceed the ${MAX_TOTAL_CACHED_TILES}-chunk live cache limit. Clear some chunks or use Preview.`);
    expect(nextMarkers.size <= MAX_CACHED_MARKERS, `Merging would exceed the ${MAX_CACHED_MARKERS}-marker limit. Remove some markers or use Preview.`);
    const addedMarkers = nextMarkers.size - map.markers.size;
    if (changedTiles.length || addedMarkers) {
      const revision = ++this.#revision;
      for (const tile of changedTiles) {
        nextTiles.delete(tile.key); nextTiles.set(tile.key, tile);
        this.#tileRevision.set(tile, revision); this.#tileUpdateOrder.set(tile, ++this.#nextTileUpdate);
      }
      map.tiles = nextTiles; map.markers = nextMarkers;
    }
    return { tiles: changedTiles.length, markers: addedMarkers };
  }

  deleteItems(clientId, value) {
    record(value, 'selection');
    const tileKeys = selectedIds(value.tileKeys, 'tileKeys', MAX_TOTAL_CACHED_TILES, /^[A-Za-z0-9_.:,\-]{1,128}$/);
    const markerIds = selectedIds(value.markerIds, 'markerIds', MAX_CACHED_MARKERS, /^[A-Za-z0-9_.:,\-]{1,128}$/);
    const { map } = this.#entry(clientId);
    let tiles = 0, markers = 0;
    for (const key of tileKeys) if (map.tiles.delete(key)) tiles++;
    for (const id of markerIds) if (map.markers.delete(id)) markers++;
    if (tiles || markers) this.#revision++;
    return { tiles, markers };
  }

  saveMarker(clientId, value) {
    const marker = validated(validateMapMarker, value), { map } = this.#entry(clientId);
    expect(map.markers.has(marker.id) || map.markers.size < MAX_CACHED_MARKERS,
      `A map may contain at most ${MAX_CACHED_MARKERS} markers.`);
    const previous = map.markers.get(marker.id);
    if (!previous || previous.x !== marker.x || previous.y !== marker.y || previous.label !== marker.label) {
      map.markers.set(marker.id, marker); this.#revision++;
    }
    return { ...marker };
  }

  read({ clientId, since } = {}) {
    this.#prune();
    const reset = !Number.isSafeInteger(since) || since < 0 || since > this.#revision;
    const emitted = new Set();
    return { revision: this.#revision, reset,
      clients: this.#entries(clientId).map(entry => {
        const map = entry.map, mapData = !emitted.has(map);
        emitted.add(map);
        return { ...this.#metadata(entry), mapData,
          ...(mapData ? { mapFrame: this.#mapFrame(map),
            markers: [...map.markers.values()].map(marker => ({ ...marker })),
            tileKeys: [...map.tiles.keys()], resetTiles: reset || map.resetRevision > since,
            tiles: [...map.tiles.values()].filter(tile => reset || this.#tileRevision.get(tile) > since)
              .map(tile => ({ ...tile })) } : { tiles: [], markers: [] }) };
      }) };
  }
}
