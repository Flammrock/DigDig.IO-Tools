import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSession, withMapMetadata } from '../src/session-selection.ts';
import { TelemetryCache } from '../src/telemetry-cache.ts';
import { TelemetryStore } from '../../dev-server/src/telemetry.mjs';

const game = (clientId, extras = {}) => ({clientId, lastSeen: 100, stale: false,
  frame: {source: 'game', status: 'live'}, ...extras});
test('automatic reconnect replaces an inactive game connection without switching healthy tabs or fixtures', () => {
  const old = game('old', {stale: true}), fresh = game('new', {lastSeen: 200});
  assert.equal(chooseSession([old, fresh], 'old', true), 'new');
  assert.equal(chooseSession([old, fresh], 'old', false), 'old');
  assert.equal(chooseSession([old, game('older-tab', {firstSeen: 10, lastSeen: 500}),
    game('reload', {firstSeen: 20, lastSeen: 490})], 'old', true), 'reload');
  assert.equal(chooseSession([game('old'), fresh], 'old', true), 'old');
  const fixture = game('fixture', {stale: true, frame: {source: 'fixture', status: 'live'}});
  assert.equal(chooseSession([fixture, fresh], 'fixture', true), 'fixture');
  const retained = game('game-map', {mapOnly: true, stale: true, frame: {source: 'game', status: 'waiting'}});
  assert.equal(chooseSession([retained, fresh], 'game-map', true), 'new');
  assert.equal(chooseSession([retained], 'removed', true), 'game-map');
  assert.equal(chooseSession([game('fixture', {frame: {source: 'fixture', status:'live'}}), retained], 'removed', true), 'game-map');
});
test('shared map metadata does not invent current pose or mutate a waiting session', () => {
  const raw = game('new', {frame: {source: 'game', status: 'waiting', buildHash: null},
    mapFrame: {buildHash: 'a'.repeat(64), terrainMode: 'materials-v1', world: {centerX: 0, centerY: 0, radius: 100}}});
  const view = withMapMetadata(raw);
  assert.equal(view.frame.status, 'waiting');
  assert.equal(view.frame.player, undefined);
  assert.equal(view.frame.buildHash, raw.mapFrame.buildHash);
  assert.equal(raw.frame.buildHash, null);
});

test('selected live bounds survive shared-map updates from another tab and pose-only resizing', () => {
  const store = new TelemetryStore({ now: () => 1000, autoReconnect: false });
  const cache = new TelemetryCache();
  const tile = { key: 'edge', x: 95, y: 0, width: 1, height: 1, pixelWidth: 1, pixelHeight: 1, rgba: 'eEQA/w==' };
  const frame = (radius, tiles = []) => ({ version: 1, source: 'game', status: 'live',
    message: 'Synthetic boundary update', buildHash: 'a'.repeat(64), capturedAt: '2026-10-24T00:00:00.000Z',
    terrainMode: 'materials-v1', world: { centerX: 0, centerY: 0, radius },
    player: { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
    camera: { x: 0, y: 0, scale: 1, width: 800, height: 600 }, tiles });
  const read = () => cache.apply({ serverId: 'boundary-test', ...store.read(cache.cursor()) });
  store.update('selected', frame(100, [tile]));
  read();
  for (const radius of [120, 80, 150]) {
    store.update('selected', frame(radius));
    const selected = read().clients.find(client => client.clientId === 'selected');
    assert.equal(withMapMetadata(selected).frame.world.radius, radius);
    assert.equal(selected.tiles.length, 1, 'resizing keeps accumulated terrain');
  }
  store.update('other', frame(70));
  const snapshot = read();
  const selected = snapshot.clients.find(client => client.clientId === 'selected');
  const other = snapshot.clients.find(client => client.clientId === 'other');
  assert.equal(selected.mapFrame.world.radius, 70, 'shared metadata belongs to the most recent sender');
  assert.equal(withMapMetadata(selected).frame.world.radius, 150, 'selected session keeps its own radius');
  assert.equal(withMapMetadata(other).frame.world.radius, 70);
  assert.equal(selected.tiles, other.tiles, 'sessions still share one terrain cache');
  assert.equal(selected.tiles[0].x, 95, 'historical pixels outside a smaller radius are preserved');
  assert.equal(selected.frame.world.radius, 150);
});

test('inactive and map-only sessions use retained map bounds instead of stale session bounds', () => {
  const client = game('selected', { frame: { source: 'game', status: 'live',
    buildHash: 'a'.repeat(64), world: { centerX: 0, centerY: 0, radius: 150 } },
    mapFrame: { buildHash: 'a'.repeat(64), terrainMode: 'materials-v1', world: { centerX: 0, centerY: 0, radius: 70 } } });
  assert.equal(withMapMetadata(client).frame.world.radius, 150);
  assert.equal(withMapMetadata({ ...client, stale: true }).frame.world.radius, 70);
  assert.equal(withMapMetadata({ ...client, mapOnly: true }).frame.world.radius, 70);
  assert.equal(withMapMetadata({ ...client, frame: { ...client.frame, status: 'waiting' } }).frame.world.radius, 70);
  assert.equal(client.frame.world.radius, 150);
});
