import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CACHED_TILES, MAX_MATERIAL_CACHED_TILES, MAX_TOTAL_CACHED_TILES,
  MAX_FRAME_TILES, MAX_TELEMETRY_CLIENTS, TELEMETRY_STALE_MS, TELEMETRY_TTL_MS,
  MAX_CACHED_MARKERS,
  parseMapFrame, TelemetryStore,
} from '../src/telemetry.mjs';

function tile(key = '0,0', rgba = '/wAA/w==') {
  return { key, x: 0, y: 0, width: 64, height: 64, pixelWidth: 1, pixelHeight: 1, rgba };
}

function frame(overrides = {}) {
  return {
    version: 1, source: 'fixture', status: 'live', message: 'Read-only capture', buildHash: 'a'.repeat(64),
    capturedAt: '2026-10-24T00:00:00.000Z',
    world: { centerX: 0, centerY: 0, radius: 100 },
    player: { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
    camera: { x: 0, y: 0, scale: 1, width: 800, height: 600 },
    tiles: [tile()], ...overrides,
  };
}

test('retains optional userscript package versions while accepting older frames', () => {
  const store = new TelemetryStore();
  const versioned = frame({ appVersion: '9.8.7-beta.1+report-test' });
  store.update('one', versioned);
  assert.equal(store.snapshot('one')[0].frame.appVersion, versioned.appVersion);
  const previous = store.snapshot('one');
  for (const appVersion of [null, 2, {}, [], '', 'bad version', 'x'.repeat(129)]) {
    assert.throws(() => store.update('one', frame({ appVersion })), /appVersion/);
    assert.deepEqual(store.snapshot('one'), previous);
  }
  store.update('one', frame());
  assert.ok(!('appVersion' in store.snapshot('one')[0].frame), 'legacy frames retain their original shape');
  assert.equal(parseMapFrame(versioned).version, 1);
});

test('tile updates deduplicate, preserve untouched terrain, and evict the least recently updated tile', () => {
  const store = new TelemetryStore();
  store.update('one', frame({ tiles: [tile('first'), tile('second')] }));
  store.update('one', frame({ tiles: [tile('first', 'AP8A/w==')] }));
  let tiles = store.snapshot()[0].tiles;
  assert.deepEqual(tiles.map(({ key }) => key), ['second', 'first']);
  assert.equal(tiles[1].rgba, 'AP8A/w==');
  for (let index = 0; index < MAX_CACHED_TILES - 1; index++) {
    store.update('one', frame({ tiles: [tile(`later-${index}`)] }));
  }
  tiles = store.snapshot()[0].tiles;
  assert.equal(tiles.length, MAX_CACHED_TILES);
  assert.equal(tiles[0].key, 'first');
  assert.ok(!tiles.some(({ key }) => key === 'second'));
});

test('separates fixture clients and resets terrain for build changes, world discontinuities, or non-live status', () => {
  const store = new TelemetryStore();
  store.update('one', frame());
  store.update('two', frame());
  store.update('one', frame({ world: { centerX: 0, centerY: 0, radius: 101 }, tiles: [] }));
  assert.equal(store.snapshot('one')[0].tiles.length, 1, 'gradual map resizing preserves terrain');
  for (const changed of [
    { buildHash: 'b'.repeat(64) },
    { world: { centerX: 50, centerY: 0, radius: 100 } },
    { world: { centerX: 0, centerY: 0, radius: 1000 } },
    { source: 'fixture', buildHash: null },
    { status: 'waiting' },
  ]) {
    store.update('one', frame());
    store.update('one', frame({ ...changed, tiles: [] }));
    assert.equal(store.snapshot('one')[0].tiles.length, 0);
  }
  assert.equal(store.snapshot('two')[0].tiles.length, 1);
});

test('reports stale map data independently of client heartbeats, bounds clients, and expires old data', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  for (let index = 0; index < MAX_TELEMETRY_CLIENTS; index++) store.update(`client-${index}`, frame());
  assert.throws(() => store.update('overflow', frame()), (error) => error.status === 429);
  clock += TELEMETRY_STALE_MS + 1;
  assert.equal(store.snapshot()[0].stale, true);
  assert.equal(store.snapshot()[0].lastSeen, 1000);
  clock += TELEMETRY_TTL_MS;
  assert.deepEqual(store.snapshot(), []);
  store.update('fresh', frame());
  assert.equal(store.snapshot()[0].stale, false);
});

test('rejects malformed coordinates, unsupported formats, duplicate tiles, and corrupt image bytes atomically', () => {
  const store = new TelemetryStore();
  store.update('one', frame());
  const previous = store.snapshot('one');
  const invalid = [
    null, [], 'wrong', frame({ version: 2 }), frame({ status: 'unknown' }), frame({ source: 'unknown' }),
    frame({ message: 'x'.repeat(513) }), frame({ capturedAt: 'not a date' }),
    frame({ capturedAt: '2026-02-30T00:00:00.000Z' }), frame({ source: 'game', buildHash: null }),
    frame({ player: undefined }), frame({ camera: { x: 0, y: 0, scale: 0, width: 800, height: 600 } }),
    frame({ world: { centerX: Infinity, centerY: 0, radius: 100 } }),
    frame({ world: { centerX: 0, centerY: 0, radius: -1 } }),
    frame({ tiles: [tile(), tile()] }), frame({ tiles: Array.from({ length: MAX_FRAME_TILES + 1 }, (_, i) => tile(`${i}`)) }),
    frame({ tiles: [{ ...tile(), pixelWidth: 65 }] }), frame({ tiles: [{ ...tile(), width: NaN }] }),
    frame({ tiles: [tile('0,0', 'AQID')] }), frame({ tiles: [tile('0,0', '/wAA/w= ')] }),
    frame({ status: 'unsupported' }),
  ];
  for (const candidate of invalid) {
    assert.throws(() => store.update('one', candidate), (error) => error.status === 400);
    assert.deepEqual(store.snapshot('one'), previous);
  }
  const fullTile = { ...tile(), pixelWidth: 64, pixelHeight: 64, rgba: Buffer.alloc(64 * 64 * 4).toString('base64') };
  assert.deepEqual(parseMapFrame(frame({ tiles: [fullTile] })).tiles, [fullTile]);
});

function materialTile(pixels, overrides = {}) {
  return { ...tile(), pixelWidth: pixels.length, pixelHeight: 1,
    rgba: Buffer.from(pixels.flat()).toString('base64'), ...overrides };
}

function materialFrame(tiles, overrides = {}) {
  return frame({ terrainMode: 'materials-v1', tiles, ...overrides });
}

const unknown = [0, 0, 0, 0];
const bedrock = [0, 0, 0, 255];
const quartz = [220, 220, 220, 255];
const diamond = [48, 163, 155, 255];
const dirt = [110, 80, 40, 255];

test('material scans merge observed pixels without fog erasing quartz, dirt, or opaque black bedrock', () => {
  const store = new TelemetryStore();
  const first = materialFrame([materialTile([quartz, unknown, bedrock, dirt])]);
  const original = structuredClone(first);
  store.update('scan', first);
  const initial = store.snapshot('scan')[0].tiles[0];
  assert.equal(initial.observedPixels, 3);
  store.update('scan', materialFrame([materialTile([unknown, diamond, unknown, quartz])]));
  const merged = store.snapshot('scan')[0].tiles[0];
  assert.deepEqual([...Buffer.from(merged.rgba, 'base64')], [quartz, diamond, bedrock, quartz].flat());
  assert.equal(merged.observedPixels, 4);
  assert.equal(store.snapshot('scan')[0].frame.terrainMode, 'materials-v1');
  assert.deepEqual(first, original, 'merging must not mutate caller data');
  assert.equal(initial.observedPixels, 3, 'previous snapshots remain stable');
});

test('fully unknown material tiles neither allocate cache entries nor erase previous discoveries', () => {
  const store = new TelemetryStore();
  store.update('scan', materialFrame([materialTile([unknown, unknown])]));
  assert.deepEqual(store.snapshot('scan')[0].tiles, []);
  store.update('scan', materialFrame([materialTile([dirt, unknown])]));
  const previous = store.snapshot('scan')[0].tiles;
  store.update('scan', materialFrame([materialTile([unknown, unknown])]));
  assert.deepEqual(store.snapshot('scan')[0].tiles, previous);
});

test('64 by 64 material refreshes and partial subsets do not retransmit, while new colors and coverage still do', () => {
  const store = new TelemetryStore();
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(dirt, offset);
  const full = { ...tile(), pixelWidth: 64, pixelHeight: 64, rgba: pixels.toString('base64') };
  store.update('scan', materialFrame([full]));
  const before = store.read();
  store.update('scan', materialFrame([{ ...full, x: 0.005 }]));
  assert.deepEqual(store.read({ since: before.revision }).clients[0].tiles, []);

  const partial = Buffer.from(pixels);
  for (let offset = 0; offset < partial.length; offset += 8) partial.fill(0, offset, offset + 4);
  store.update('scan', materialFrame([{ ...full, rgba: partial.toString('base64') }]));
  assert.deepEqual(store.read({ since: before.revision }).clients[0].tiles, []);
  assert.equal(store.snapshot('scan')[0].tiles[0].rgba, full.rgba);

  partial.set(quartz, 4);
  store.update('scan', materialFrame([{ ...full, rgba: partial.toString('base64') }]));
  const changed = store.read({ since: before.revision }).clients[0].tiles[0];
  assert.equal(changed.observedPixels, 4096);
  assert.deepEqual([...Buffer.from(changed.rgba, 'base64').subarray(0, 8)], [...dirt, ...quartz]);

  const original = { ...full };
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(diamond, offset);
  const replacement = { ...full, rgba: pixels.toString('base64'), observedPixels: 0 };
  store.update('scan', materialFrame([replacement]));
  assert.equal(store.snapshot('scan')[0].tiles[0].rgba, replacement.rgba);
  assert.equal(store.snapshot('scan')[0].tiles[0].observedPixels, 4096, 'never trust supplied observed counts');
  assert.deepEqual(full, original, 'fast paths do not mutate the input tile');
});

test('changing between raw imagery and material scans clears previous coverage even without new tiles', () => {
  const store = new TelemetryStore();
  store.update('scan', frame({ tiles: [tile('fog')] }));
  store.update('scan', materialFrame([]));
  assert.deepEqual(store.snapshot('scan')[0].tiles, []);
  store.update('scan', materialFrame([materialTile([quartz])]));
  store.update('scan', frame({ tiles: [] }));
  assert.deepEqual(store.snapshot('scan')[0].tiles, []);
});

test('material merging tolerates camera float jitter but never combines different pixel grids or rectangles', () => {
  const store = new TelemetryStore();
  store.update('scan', materialFrame([materialTile([quartz, unknown])]));
  store.update('scan', materialFrame([materialTile([unknown, diamond], { x: 0.005, width: 64.001 })]));
  assert.deepEqual([...Buffer.from(store.snapshot('scan')[0].tiles[0].rgba, 'base64')], [quartz, diamond].flat());
  store.update('scan', materialFrame([materialTile([unknown, bedrock], { x: 10 })]));
  assert.deepEqual([...Buffer.from(store.snapshot('scan')[0].tiles[0].rgba, 'base64')], [unknown, bedrock].flat());
  store.update('scan', materialFrame([materialTile([dirt], { x: 10 })]));
  assert.equal(store.snapshot('scan')[0].tiles[0].pixelWidth, 1);
  assert.deepEqual([...Buffer.from(store.snapshot('scan')[0].tiles[0].rgba, 'base64')], dirt);
});

test('rejects ambiguous material coverage atomically and computes observed counts independently', () => {
  const store = new TelemetryStore();
  store.update('scan', materialFrame([materialTile([quartz])]));
  const previous = store.snapshot('scan');
  for (const invalid of [
    materialFrame([], { terrainMode: 'future-format' }),
    materialFrame([materialTile([[0, 0, 0, 127]])]),
    materialFrame([materialTile([[255, 0, 0, 0]])]),
    materialFrame([materialTile([diamond], { key: 'valid' }), materialTile([[0, 0, 0, 1]], { key: 'invalid' })]),
  ]) {
    assert.throws(() => store.update('scan', invalid), (error) => error.status === 400);
    assert.deepEqual(store.snapshot('scan'), previous);
  }
  store.update('scan', materialFrame([materialTile([bedrock], { observedPixels: 0 })]));
  assert.equal(store.snapshot('scan')[0].tiles[0].observedPixels, 1);
});

test('material cache remains bounded and returned snapshots cannot change stored discoveries', () => {
  const store = new TelemetryStore();
  for (let index = 0; index <= MAX_MATERIAL_CACHED_TILES; index++) {
    store.update('scan', materialFrame([materialTile([dirt], { key: `cell-${index}` })]));
  }
  const snapshot = store.snapshot('scan');
  assert.equal(snapshot[0].tiles.length, MAX_MATERIAL_CACHED_TILES);
  assert.ok(snapshot[0].tiles.length > MAX_CACHED_TILES, 'material scans retain more terrain than raw imagery');
  assert.equal(snapshot[0].tiles[0].key, 'cell-1');
  const previous = structuredClone(snapshot);
  snapshot[0].frame.world.centerX = 999;
  snapshot[0].tiles[0].rgba = Buffer.from(unknown).toString('base64');
  snapshot[0].tiles[0].observedPixels = 0;
  assert.deepEqual(store.snapshot('scan'), previous);
});

test('global cache budget evicts the oldest tile across sources and respects refreshed observations', () => {
  const store = new TelemetryStore();
  for (const client of ['first', 'second']) {
    for (let index = 0; index < MAX_MATERIAL_CACHED_TILES; index++) {
      store.update(client, materialFrame([materialTile([dirt], { key: `cell-${index}` })]));
    }
  }
  const total = () => store.snapshot().reduce((count, client) => count + client.tiles.length, 0);
  assert.equal(total(), MAX_TOTAL_CACHED_TILES);
  store.update('raw-fixture', frame({ source: 'fixture', buildHash: null, tiles: [tile('raw-first')] }));
  assert.equal(total(), MAX_TOTAL_CACHED_TILES);
  assert.equal(store.snapshot('first')[0].tiles[0].key, 'cell-1');
  assert.equal(store.snapshot('second')[0].tiles.length, MAX_MATERIAL_CACHED_TILES);
  // Refreshing known material moves it behind later observations globally.
  store.update('first', materialFrame([materialTile([quartz], { key: 'cell-1' })]));
  store.update('raw-fixture', frame({ source: 'fixture', buildHash: null, tiles: [tile('raw-second')] }));
  assert.equal(total(), MAX_TOTAL_CACHED_TILES);
  assert.equal(store.snapshot('first')[0].tiles[0].key, 'cell-3');
  assert.ok(store.snapshot('first')[0].tiles.some(({ key }) => key === 'cell-1'));
  assert.equal(store.snapshot('raw-fixture')[0].tiles.length, 2);
  assert.ok(store.snapshot().every((client) => client.tiles.every((value) => !('updateOrder' in value))));
});

test('world resets and expired clients release global capacity without evicting other discoveries', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  for (const client of ['first', 'second']) {
    for (let index = 0; index < MAX_MATERIAL_CACHED_TILES; index++) {
      store.update(client, materialFrame([materialTile([dirt], { key: `cell-${index}` })]));
    }
  }
  store.update('first', materialFrame([], { buildHash: 'b'.repeat(64) }));
  store.update('third', materialFrame([materialTile([bedrock])]));
  assert.equal(store.snapshot('second')[0].tiles.length, MAX_MATERIAL_CACHED_TILES);
  assert.equal(store.snapshot().reduce((count, client) => count + client.tiles.length, 0), MAX_MATERIAL_CACHED_TILES + 1);
  clock += TELEMETRY_TTL_MS;
  store.update('second', materialFrame([]));
  clock++;
  store.update('fourth', materialFrame([materialTile([diamond])]));
  assert.deepEqual(store.snapshot().map(({ clientId }) => clientId), ['second', 'fourth']);
  assert.equal(store.snapshot('second')[0].tiles.length, MAX_MATERIAL_CACHED_TILES);
});

test('material discoveries survive temporary camera loss without inventing a live position', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  store.update('scan', materialFrame([materialTile([quartz, unknown])]));
  const before = store.snapshot('scan')[0];
  for (const status of ['waiting', 'error']) {
    clock += 2000;
    store.update('scan', materialFrame([], { status, world: undefined, player: undefined, camera: undefined }));
    const retained = store.snapshot('scan')[0];
    assert.equal(retained.frame.status, status);
    assert.deepEqual(retained.frame.world, before.frame.world);
    assert.deepEqual(retained.tiles, before.tiles);
    assert.equal('player' in retained.frame, false, 'old player coordinates must not be presented as current');
    assert.equal('camera' in retained.frame, false, 'old camera coordinates must not be presented as current');
    assert.equal(retained.lastSeen, clock, 'the observation heartbeat remains current');
    assert.equal(retained.stale, false);
  }
  store.update('scan', materialFrame([materialTile([unknown, diamond])], {
    world: { centerX: 0, centerY: 0, radius: 101 }, player: { x: 5, y: 6, normalizedX: 0.05, normalizedY: 0.06 },
  }));
  const resumed = store.snapshot('scan')[0];
  assert.equal(resumed.frame.status, 'live');
  assert.equal(resumed.frame.player.x, 5);
  assert.deepEqual([...Buffer.from(resumed.tiles[0].rgba, 'base64')], [quartz, diamond].flat());
  clock += TELEMETRY_TTL_MS + 1;
  assert.deepEqual(store.snapshot('scan'), [], 'inactive sessions still expire');
});

test('paused material scans still reset on unknown builds, mode changes, and world discontinuities', () => {
  for (const changed of [
    { status: 'unsupported' },
    { buildHash: null },
    { buildHash: 'b'.repeat(64) },
    { source: 'game' },
    { terrainMode: undefined },
    { world: { centerX: 1, centerY: 0, radius: 100 } },
    { world: { centerX: 0, centerY: 0, radius: 1000 } },
  ]) {
    const store = new TelemetryStore();
    store.update('scan', materialFrame([materialTile([bedrock])]));
    store.update('scan', materialFrame([], { status: 'waiting', world: undefined, player: undefined, camera: undefined }));
    store.update('scan', materialFrame([], {
      status: 'error', world: undefined, player: undefined, camera: undefined, ...changed,
    }));
    const reset = store.snapshot('scan')[0];
    assert.deepEqual(reset.tiles, [], JSON.stringify(changed));
    if (changed.world === undefined) assert.equal(reset.frame.world, undefined, 'different context cannot inherit map bounds');
    store.update('scan', materialFrame([]));
    assert.deepEqual(store.snapshot('scan')[0].tiles, [], 'resumption cannot resurrect discarded discoveries');
  }
});

test('incremental snapshots send changed tiles only while keeping complete positions and tile keys', () => {
  const store = new TelemetryStore();
  store.update('scan', materialFrame([materialTile([dirt], { key: 'first' }), materialTile([quartz], { key: 'second' })]));
  const initial = store.read();
  assert.equal(initial.reset, true);
  assert.equal(initial.clients[0].resetTiles, true);
  assert.equal(initial.clients[0].tiles.length, 2);
  assert.deepEqual(store.read({ since: initial.revision }).clients[0].tiles, []);
  // A repeated material observation and tiny transform jitter must not resend image bytes.
  store.update('scan', materialFrame([materialTile([dirt], { key: 'first', x: 0.001 })], {
    player: { x: 12, y: 20, normalizedX: 0.12, normalizedY: 0.2 },
  }));
  const poseOnly = store.read({ since: initial.revision });
  assert.equal(poseOnly.reset, false);
  assert.equal(poseOnly.clients[0].resetTiles, false);
  assert.deepEqual(poseOnly.clients[0].tiles, []);
  assert.deepEqual(new Set(poseOnly.clients[0].tileKeys), new Set(['first', 'second']));
  assert.equal(poseOnly.clients[0].frame.player.x, 12);
  assert.ok(poseOnly.revision > initial.revision);
  store.update('scan', materialFrame([materialTile([diamond], { key: 'second' })]));
  store.update('scan', materialFrame([materialTile([bedrock], { key: 'third' })]));
  const missedPoll = store.read({ since: initial.revision });
  assert.deepEqual(missedPoll.clients[0].tiles.map(({ key }) => key), ['second', 'third']);
  assert.equal(missedPoll.clients[0].tileKeys.length, 3);
  assert.equal(store.read({ since: missedPoll.revision + 1 }).reset, true);
  assert.equal(store.read({ since: NaN }).reset, true);
  assert.deepEqual(store.read({ clientId: 'missing' }).clients, []);
});

test('clear and world changes reset delta tile caches without inventing new browser activity', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  store.update('first', materialFrame([materialTile([dirt])]));
  store.update('second', materialFrame([materialTile([quartz])]));
  const before = store.read();
  clock += 1000;
  store.clear('first');
  const cleared = store.read({ since: before.revision });
  assert.deepEqual(cleared.clients[0].tiles, []);
  assert.deepEqual(cleared.clients[0].tileKeys, []);
  assert.equal(cleared.clients[0].resetTiles, true);
  assert.equal(cleared.clients[0].lastSeen, 1000);
  assert.deepEqual(cleared.clients[0].frame, before.clients[0].frame);
  assert.equal(cleared.clients[1].resetTiles, false);
  assert.equal(cleared.clients[1].tileKeys.length, 1);
  assert.throws(() => store.clear('missing'), (error) => error.status === 404);
  store.update('first', materialFrame([materialTile([diamond])]));
  assert.equal(store.read({ since: before.revision }).clients[0].tiles.length, 1, 'clear followed by recapture is not lost');
  const cursor = store.read().revision;
  store.update('first', materialFrame([], { world: { centerX: 50, centerY: 0, radius: 100 } }));
  assert.equal(store.read({ since: cursor }).clients[0].resetTiles, true);
});

test('incremental authoritative keys account for evictions and expired clients', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  for (let index = 0; index < MAX_CACHED_TILES; index++) store.update('raw', frame({ tiles: [tile(`cell-${index}`)] }));
  const cursor = store.read().revision;
  store.update('raw', frame({ tiles: [tile('new')] }));
  const next = store.read({ since: cursor });
  assert.deepEqual(next.clients[0].tiles.map(({ key }) => key), ['new']);
  assert.ok(!next.clients[0].tileKeys.includes('cell-0'));
  assert.equal(next.clients[0].tileKeys.length, MAX_CACHED_TILES);
  clock += TELEMETRY_TTL_MS + 1;
  const expired = store.read({ since: next.revision });
  assert.deepEqual(expired.clients, []);
  assert.ok(expired.revision > next.revision);
});

function savedMap(tiles, markers = [], overrides = {}) {
  return {
    format: 'digdig-chunks', version: 1, savedAt: '2026-10-24T00:00:00.000Z',
    source: { label: 'Saved exploration', buildHash: 'a'.repeat(64), terrainMode: 'materials-v1',
      world: { centerX: 0, centerY: 0, radius: 100 } },
    tiles, markers, ...overrides,
  };
}
const marker = { id: 'quartz-note', x: 25, y: -30, label: 'Explore when quartz respawns' };

test('saved terrain fills unknown pixels while live discoveries, position, and existing markers win', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  store.update('scan', materialFrame([materialTile([quartz, unknown, bedrock])]));
  store.saveMarker('scan', marker);
  const before = store.read();
  const document = savedMap([
    materialTile([dirt, diamond, unknown]), materialTile([dirt], { key: 'saved-only', x: 64 }),
    materialTile([unknown], { key: 'empty' }),
  ], [{ ...marker, label: 'Older text' }, { ...marker, id: 'second-note' }]);
  const original = structuredClone(document);
  clock += 2000;
  assert.deepEqual(store.merge('scan', document), { tiles: 2, markers: 1 });
  const merged = store.read({ since: before.revision });
  const client = merged.clients[0];
  assert.deepEqual([...Buffer.from(client.tiles.find(tile => tile.key === '0,0').rgba, 'base64')], [quartz, diamond, bedrock].flat());
  assert.deepEqual(client.tileKeys, ['0,0', 'saved-only']);
  assert.equal(client.tiles[0].observedPixels, 3);
  assert.deepEqual(client.frame, before.clients[0].frame);
  assert.equal(client.lastSeen, 1000, 'importing is not a browser heartbeat');
  assert.equal(client.markers.find(item => item.id === marker.id).label, marker.label);
  assert.deepEqual(document, original, 'imports do not mutate parsed files');
  assert.deepEqual(store.merge('scan', document), { tiles: 0, markers: 0 });
  assert.equal(store.read().revision, merged.revision, 'identical imports leave the cursor stable');
  store.update('scan', materialFrame([materialTile([unknown, dirt, unknown])]));
  assert.deepEqual([...Buffer.from(store.snapshot('scan')[0].tiles.find(tile => tile.key === '0,0').rgba, 'base64')], [quartz, dirt, bedrock].flat());
});

test('imports reject incompatible geometry, maps, corruption, and capacity before changing any live data', () => {
  const store = new TelemetryStore();
  store.update('scan', materialFrame([materialTile([quartz, unknown])]));
  store.saveMarker('scan', marker);
  const before = store.read();
  const base = savedMap([materialTile([diamond, dirt])]);
  for (const candidate of [
    { ...base, tiles: [materialTile([quartz], { key: 'would-add' }), materialTile([diamond])] },
    { ...base, tiles: [materialTile([quartz], { key: 'would-add' }), materialTile([diamond, dirt], { x: 10 })] },
    { ...base, source: { ...base.source, terrainMode: undefined } },
    { ...base, source: { ...base.source, buildHash: 'b'.repeat(64) } },
    { ...base, source: { ...base.source, world: { centerX: 10, centerY: 0, radius: 100 } } },
    { ...base, tiles: [{ ...base.tiles[0], rgba: 'invalid' }] },
    { ...base, markers: [marker, marker] },
    { ...base, markers: [{ ...marker, label: ' ' }] },
    { ...base, tiles: Array.from({ length: MAX_MATERIAL_CACHED_TILES }, (_, i) => materialTile([dirt], { key: `new-${i}` })) },
  ]) {
    assert.throws(() => store.merge('scan', candidate), (error) => error.status === 400);
    assert.deepEqual(store.read(), before, 'failed imports are atomic including revision');
  }
  assert.throws(() => store.merge('missing', base), (error) => error.status === 404);
  const noBounds = frame({ status: 'waiting', world: undefined, player: undefined, camera: undefined, tiles: [] });
  store.update('waiting', noBounds);
  assert.throws(() => store.merge('waiting', base), /Preview/);
});

test('raw saved maps also fill transparent pixels without overwriting newer live imagery', () => {
  const store = new TelemetryStore();
  store.update('fixture', frame({ source: 'fixture', buildHash: null, tiles: [materialTile([quartz, unknown])] }));
  const document = savedMap([materialTile([dirt, diamond])], [], {
    source: { label: 'Fixture', buildHash: null, world: { centerX: 0, centerY: 0, radius: 100 } },
  });
  store.merge('fixture', document);
  assert.deepEqual([...Buffer.from(store.snapshot('fixture')[0].tiles[0].rgba, 'base64')], [quartz, diamond].flat());
  assert.equal(store.snapshot('fixture')[0].tiles[0].observedPixels, undefined);
});

test('selected deletion removes chunks and markers independently, and later capture may rediscover deleted chunks', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  store.update('scan', materialFrame([materialTile([quartz]), materialTile([dirt], { key: 'keep' })]));
  store.update('other', materialFrame([materialTile([dirt])]));
  store.saveMarker('scan', marker);
  store.saveMarker('scan', { ...marker, id: 'keep-marker' });
  const before = store.read();
  clock += 2000;
  for (const invalid of [
    { tileKeys: ['0,0'], markerIds: ['bad/identifier'] },
    { tileKeys: ['0,0', '0,0'], markerIds: [marker.id] },
    { tileKeys: '0,0', markerIds: [marker.id] },
  ]) {
    assert.throws(() => store.deleteItems('scan', invalid), (error) => error.status === 400);
    assert.deepEqual(store.read(), before);
  }
  assert.deepEqual(store.deleteItems('scan', { tileKeys: ['0,0', 'absent'], markerIds: [marker.id] }), { tiles: 1, markers: 1 });
  const after = store.read({ since: before.revision });
  assert.deepEqual(after.clients[0].tileKeys, ['keep']);
  assert.deepEqual(after.clients[0].tiles, [], 'remaining chunks do not need retransmission');
  assert.equal(after.clients[0].resetTiles, false);
  assert.deepEqual(after.clients[0].markers.map(item => item.id), ['keep-marker']);
  assert.equal(after.clients[0].lastSeen, 1000);
  assert.deepEqual(after.clients[1].tileKeys, ['0,0']);
  store.update('scan', materialFrame([materialTile([diamond])]));
  assert.ok(store.snapshot('scan')[0].tiles.some(tile => tile.key === '0,0'));
  store.clear('scan');
  assert.equal(store.snapshot('scan')[0].markers.length, 1, 'Clear chunks preserves annotations');
  assert.throws(() => store.deleteItems('missing', { tileKeys: [], markerIds: [] }), (error) => error.status === 404);
});

test('markers are validated, isolated, bounded, preserved across paused capture and reset with the map', () => {
  const store = new TelemetryStore();
  store.update('scan', materialFrame([]));
  const saved = store.saveMarker('scan', marker);
  saved.label = 'mutated caller copy';
  store.saveMarker('scan', { ...marker, label: 'New label', x: 40 });
  assert.equal(store.snapshot('scan')[0].markers[0].label, 'New label');
  assert.equal(store.snapshot('scan')[0].markers[0].x, 40);
  const cursor = store.read().revision;
  for (const invalid of [{ ...marker, x: Infinity }, { ...marker, label: '' }, { ...marker, label: 'x'.repeat(241) }]) {
    assert.throws(() => store.saveMarker('scan', invalid), (error) => error.status === 400);
    assert.equal(store.read().revision, cursor);
  }
  store.update('scan', materialFrame([], { status: 'waiting', world: undefined, player: undefined, camera: undefined }));
  assert.equal(store.snapshot('scan')[0].markers.length, 1);
  for (let index = 1; index < MAX_CACHED_MARKERS; index++) store.saveMarker('scan', { ...marker, id: `note-${index}` });
  assert.throws(() => store.saveMarker('scan', { ...marker, id: 'overflow' }), /512/);
  store.saveMarker('scan', { ...marker, label: 'Existing marker still editable' });
  assert.equal(store.snapshot('scan')[0].markers.length, MAX_CACHED_MARKERS);
  const prior = store.read();
  assert.throws(() => store.merge('scan', savedMap([materialTile([quartz])], [{ ...marker, id: 'overflow' }])), /512/);
  assert.deepEqual(store.read(), prior, 'marker overflow cannot partially import terrain');
  store.update('scan', materialFrame([], { buildHash: 'b'.repeat(64) }));
  assert.deepEqual(store.snapshot('scan')[0].markers, []);
});
