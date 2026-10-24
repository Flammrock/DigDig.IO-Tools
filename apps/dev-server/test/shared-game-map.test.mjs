import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryStore, TELEMETRY_STALE_MS, TELEMETRY_TTL_MS,
  MAX_MATERIAL_CACHED_TILES, MAX_TELEMETRY_CLIENTS } from '../src/telemetry.mjs';

const dirt = [120, 68, 0, 255], quartz = [221, 221, 221, 255], unknown = [0, 0, 0, 0];
const tile = (key, pixels = [dirt, unknown]) => ({ key, x: 0, y: 0, width: 64, height: 64,
  pixelWidth: pixels.length, pixelHeight: 1, rgba: Buffer.from(pixels.flat()).toString('base64') });
const frame = (tiles = [], extra = {}) => ({ version: 1, source: 'game', status: 'live',
  message: 'Shared game test', buildHash: 'a'.repeat(64), capturedAt: '2026-10-24T00:00:00.000Z',
  terrainMode: 'materials-v1', world: { centerX: 0, centerY: 0, radius: 100 },
  player: { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
  camera: { x: 0, y: 0, scale: 1, width: 800, height: 600 }, tiles, ...extra });
const marker = { id: 'note', x: 20, y: 40, label: 'Return here' };
const saved = (tiles, markers = []) => ({ format: 'digdig-chunks', version: 1,
  savedAt: '2026-10-24T00:00:00.000Z', source: { label: 'Saved', buildHash: 'a'.repeat(64),
    terrainMode: 'materials-v1', world: { centerX: 0, centerY: 0, radius: 100 } }, tiles, markers });

test('game sessions share discoveries and markers while their positions and fixtures stay independent', () => {
  const store = new TelemetryStore();
  store.update('first', frame([tile('shared'), tile('first')]));
  store.saveMarker('first', marker);
  const before = store.read();
  store.update('second', frame([tile('shared', [unknown, quartz]), tile('second')], {
    player: { x: 50, y: 60, normalizedX: .5, normalizedY: .6 },
  }));
  store.update('fixture', frame([tile('fixture')], { source: 'fixture' }));
  const clients = store.snapshot();
  assert.equal(clients[0].mapId, clients[1].mapId);
  assert.notEqual(clients[0].mapId, clients[2].mapId);
  assert.deepEqual(clients[0].tiles, clients[1].tiles);
  assert.deepEqual(clients[0].markers, clients[1].markers);
  assert.deepEqual([...Buffer.from(clients[0].tiles.find(item => item.key === 'shared').rgba, 'base64')], [...dirt, ...quartz]);
  assert.equal(clients[0].frame.player.x, 0);
  assert.equal(clients[1].frame.player.x, 50);
  assert.deepEqual(clients[2].tiles.map(item => item.key), ['fixture']);
  assert.deepEqual(clients[2].markers, []);
  const delta = store.read({ since: before.revision });
  assert.equal(delta.clients[0].mapData, true);
  assert.equal(delta.clients[1].mapData, false);
  assert.deepEqual(delta.clients[1].tiles, []);
  assert.deepEqual(delta.clients[0].tiles.map(item => item.key), ['shared', 'second']);
  assert.deepEqual(delta.clients[0].mapFrame.world, frame().world);
  assert.equal(store.read({ clientId: 'second', since: before.revision }).clients[0].mapData, true,
    'a filtered session is always the carrier for its shared map');
});

test('shared clear, import, and selective deletion propagate to every game session without affecting fixtures', () => {
  const store = new TelemetryStore();
  store.update('first', frame([tile('one')]));
  store.update('second', frame([tile('two')]));
  store.update('fixture', frame([tile('fixture')], { source: 'fixture' }));
  store.merge('second', saved([tile('saved')], [marker]));
  assert.equal(store.snapshot('first')[0].tiles.length, 3);
  store.deleteItems('first', { tileKeys: ['one'], markerIds: [] });
  assert.deepEqual(store.snapshot('second')[0].tiles.map(item => item.key), ['two', 'saved']);
  const cursor = store.read().revision;
  store.clear('second');
  const cleared = store.read({ since: cursor });
  assert.equal(cleared.clients[0].resetTiles, true);
  assert.deepEqual(cleared.clients[0].tileKeys, []);
  assert.deepEqual(cleared.clients[0].markers, [marker]);
  assert.deepEqual(store.snapshot('fixture')[0].tiles.map(item => item.key), ['fixture']);
  store.saveMarker('second', { ...marker, label: 'Updated from another tab' });
  assert.equal(store.snapshot('first')[0].markers[0].label, 'Updated from another tab');
});

test('reload and temporary or unsupported captures never reset the shared map or invent a camera', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  store.update('old', frame([tile('old')]));
  store.saveMarker('old', marker);
  clock += TELEMETRY_STALE_MS + 1;
  store.update('new', frame([], { status: 'waiting', buildHash: null, terrainMode: undefined,
    world: undefined, player: undefined, camera: undefined }));
  let clients = store.snapshot();
  assert.equal(clients.length, 2, 'a fresh waiting tab does not discard the prior session yet');
  assert.equal(clients[1].frame.player, undefined);
  assert.equal(clients[1].frame.buildHash, null, 'raw session metadata stays truthful');
  assert.equal(clients[1].mapFrame.buildHash, 'a'.repeat(64));
  assert.equal(clients[1].tiles.length, 1);
  store.update('new', frame([tile('new')]));
  clients = store.snapshot();
  assert.deepEqual(clients.map(client => client.clientId), ['new']);
  assert.deepEqual(clients[0].tiles.map(item => item.key), ['old', 'new']);
  assert.deepEqual(clients[0].markers, [marker]);
  for (const status of ['waiting', 'error', 'unsupported']) {
    store.update('new', frame([], { status, buildHash: 'b'.repeat(64), world: undefined, player: undefined, camera: undefined }));
    const current = store.snapshot()[0];
    assert.equal(current.tiles.length, 2);
    assert.deepEqual(current.markers, [marker]);
    assert.equal(current.frame.player, undefined);
  }
  store.update('new', frame([tile('updated')], { buildHash: 'b'.repeat(64) }));
  assert.equal(store.snapshot()[0].tiles.length, 3, 'a supported new build keeps the single shared map');
});

test('manual cleanup removes stale games only and leaves an editable map-only source after the final game', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock, autoReconnect: false });
  store.update('old', frame([tile('old')]));
  store.update('fixture', frame([tile('fixture')], { source: 'fixture' }));
  store.saveMarker('old', marker);
  clock += TELEMETRY_STALE_MS + 1;
  assert.deepEqual(store.cleanupInactiveGames(), ['old']);
  let clients = store.snapshot();
  assert.deepEqual(clients.map(client => client.clientId), ['fixture', 'game-map']);
  assert.equal(clients[1].mapOnly, true);
  assert.equal(clients[1].frame.player, undefined);
  assert.equal(clients[1].frame.camera, undefined);
  assert.deepEqual(clients[1].tiles.map(item => item.key), ['old']);
  store.merge('game-map', saved([tile('saved')]));
  store.saveMarker('game-map', { ...marker, id: 'new-note' });
  store.update('reconnected', frame([tile('fresh')]));
  clients = store.snapshot();
  assert.ok(!clients.some(client => client.mapOnly));
  assert.equal(clients.find(client => client.clientId === 'reconnected').tiles.length, 3);
  assert.equal(clients.find(client => client.clientId === 'reconnected').markers.length, 2);
  assert.throws(() => store.update('game-map', frame()), /reserved/);
});

test('automatic cleanup is optional, retains fresh waiting sessions, and never expires shared discoveries', () => {
  let clock = 1000, auto = false;
  const store = new TelemetryStore({ now: () => clock, autoReconnect: () => auto });
  store.update('old', frame([tile('old')]));
  clock += TELEMETRY_TTL_MS + 1;
  store.update('new', frame([tile('new')]));
  store.update('waiting', frame([], { status: 'waiting', player: undefined, camera: undefined }));
  assert.deepEqual(store.snapshot().map(item => item.clientId), ['old', 'new', 'waiting']);
  auto = true;
  assert.deepEqual(store.snapshot().map(item => item.clientId), ['new', 'waiting']);
  clock += TELEMETRY_TTL_MS + 1;
  const map = store.snapshot()[0];
  assert.equal(map.clientId, 'game-map');
  assert.deepEqual(map.tiles.map(item => item.key), ['old', 'new']);
  assert.deepEqual(store.cleanupInactiveGames(), []);
});

test('shared map limits count physical terrain once and network snapshots carry it only once', () => {
  let clock = 1000;
  const store = new TelemetryStore({ now: () => clock });
  for (let index = 0; index < MAX_MATERIAL_CACHED_TILES; index++) store.update('one', frame([tile(`cell-${index}`)]));
  for (let index = 1; index < MAX_TELEMETRY_CLIENTS; index++) store.update(`tab-${index}`, frame());
  const full = store.read();
  assert.equal(full.clients.length, MAX_TELEMETRY_CLIENTS);
  assert.equal(full.clients.filter(client => client.mapData).length, 1);
  assert.equal(full.clients.reduce((sum, client) => sum + client.tiles.length, 0), MAX_MATERIAL_CACHED_TILES);
  assert.equal(store.snapshot('one')[0].tiles.length, MAX_MATERIAL_CACHED_TILES);
  clock += TELEMETRY_STALE_MS + 1;
  store.update('replacement', frame());
  assert.equal(store.snapshot().length, 1, 'a reload can replace stale sessions even at the client limit');
  assert.equal(store.snapshot()[0].tiles.length, MAX_MATERIAL_CACHED_TILES);
});

test('a mismatched terrain mode cannot overwrite discoveries until the shared map is explicitly cleared', () => {
  const store = new TelemetryStore();
  store.update('materials', frame([tile('material')]));
  store.update('raw', frame([tile('raw')], { terrainMode: undefined }));
  assert.deepEqual(store.snapshot('raw')[0].tiles.map(item => item.key), ['material']);
  assert.match(store.snapshot('raw')[0].frame.message, /different terrain mode/);
  store.clear('raw');
  store.update('raw', frame([tile('raw')], { terrainMode: undefined }));
  assert.deepEqual(store.snapshot('materials')[0].tiles.map(item => item.key), ['raw']);
  assert.equal(store.snapshot('raw')[0].mapFrame.terrainMode, undefined);
});
