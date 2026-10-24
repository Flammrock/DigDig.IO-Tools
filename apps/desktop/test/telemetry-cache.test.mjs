import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryCache } from '../src/telemetry-cache.ts';

const tile = (key, rgba = '/wAA/w==') => ({ key, x: 0, y: 0, width: 1, height: 1, pixelWidth: 1, pixelHeight: 1, rgba });
const frame = { source: 'game', status: 'live', tiles: [] };
const client = (tiles, tileKeys, extras = {}) => ({ clientId: 'one', lastSeen: 1, stale: false, frame, tiles, tileKeys, ...extras });
const response = (revision, clients, extras = {}) => ({ serverId: 'server', revision, clients, reset: false, ...extras });

test('incremental poses keep existing tile objects and missed polls merge changed tiles', () => {
  const cache = new TelemetryCache();
  const first = tile('first');
  cache.apply(response(1, [client([first], ['first'])], { reset: true }));
  const posed = cache.apply(response(3, [client([], ['first'], { lastSeen: 20 })]));
  assert.equal(posed.clients[0].tiles[0], first, 'unchanged pixels need no repeated decoding');
  const next = cache.apply(response(7, [client([tile('second')], ['first', 'second'])]));
  assert.deepEqual(next.clients[0].tiles.map(item => item.key), ['first', 'second']);
  assert.deepEqual(cache.cursor(), { since: 7, serverId: 'server' });
  assert.equal(cache.apply(response(4, [])), next, 'older responses cannot roll back the map');
});

test('authoritative tile keys, per-client resets, expiry, and server restarts remove stale coverage', () => {
  const cache = new TelemetryCache();
  cache.apply(response(1, [client([tile('a'), tile('b')], ['a', 'b'])], { reset: true }));
  assert.deepEqual(cache.apply(response(2, [client([], ['b'])])).clients[0].tiles.map(t => t.key), ['b']);
  assert.deepEqual(cache.apply(response(3, [client([], [], { resetTiles: true })])).clients[0].tiles, []);
  cache.apply(response(4, [client([tile('a')], ['a'])]));
  assert.deepEqual(cache.apply(response(5, [])).clients, []);
  cache.apply(response(6, [client([tile('b')], ['b'])]));
  assert.deepEqual(cache.apply(response(1, [client([tile('new')], ['new'])], { serverId: 'restarted', reset: true })).clients[0].tiles.map(t => t.key), ['new']);
});

test('clear requests a fresh snapshot and legacy full snapshots remain compatible', () => {
  const cache = new TelemetryCache();
  cache.apply(response(1, [client([tile('a')], ['a'])]));
  assert.equal(cache.clearTiles('one').clients[0].tiles.length, 0);
  assert.deepEqual(cache.cursor(), {});
  cache.apply({ serverId: 'server', clients: [client([tile('b')], undefined)] });
  const next = cache.apply({ serverId: 'server', clients: [client([tile('c')], undefined)] });
  assert.deepEqual(next.clients[0].tiles.map(t => t.key), ['c']);
});

test('map edits update selected items immediately and request an authoritative refresh without losing other data', () => {
  const cache = new TelemetryCache();
  const note = { id: 'note', x: 1, y: 2, label: 'Explore later' };
  cache.apply(response(1, [client([tile('a'), tile('b')], ['a', 'b'], { markers: [note] })]));
  const second = { id: 'second', x: 3, y: 4, label: 'Ore' };
  const marked = cache.upsertMarker('one', second);
  assert.deepEqual(marked.clients[0].markers, [note, second]);
  assert.deepEqual(cache.cursor(), {});
  const deleted = cache.deleteItems('one', ['a'], ['note']);
  assert.deepEqual(deleted.clients[0].tiles.map(item => item.key), ['b']);
  assert.deepEqual(deleted.clients[0].markers, [second]);
  assert.deepEqual(deleted.clients[0].frame, frame);
  const cleared = cache.clearTiles('one');
  assert.deepEqual(cleared.clients[0].markers, [second], 'Clear chunks keeps notes');
});

test('shared carriers hydrate all tabs, survive replacement, and propagate edits without duplicating coverage', () => {
  const cache = new TelemetryCache();
  const note = { id: 'note', x: 1, y: 2, label: 'Explore later' };
  const metadata = {buildHash: 'a'.repeat(64), terrainMode: 'materials-v1'};
  const carrier = (id, tiles, keys, extra = {}) => client(tiles, keys,
    {clientId: id, mapId: 'game-shared', mapData: true, markers: [note], mapFrame: metadata, ...extra});
  const reference = client([], undefined, {clientId: 'new', mapId: 'game-shared', mapData: false});
  const first = cache.apply(response(1, [reference, carrier('old', [tile('a')], ['a'])], {reset:true}));
  assert.equal(first.clients[0].tiles, first.clients[1].tiles);
  assert.deepEqual(first.clients[0].markers, [note]);
  assert.equal(first.clients[0].mapFrame, metadata);
  const next = cache.apply(response(2, [carrier('new', [tile('b')], ['a','b'])]));
  assert.deepEqual(next.clients[0].tiles.map(t => t.key), ['a','b']);
  cache.apply(response(3, [carrier('old', [], ['a','b']), reference]));
  const edited = cache.deleteItems('new', ['a'], ['note']);
  for (const session of edited.clients) {
    assert.deepEqual(session.tiles.map(t => t.key), ['b']);
    assert.deepEqual(session.markers, []);
  }
  const kept = cache.apply(response(4, [carrier('game-map', [], ['b'], {mapOnly:true, markers:[]})]));
  assert.deepEqual(kept.clients[0].tiles.map(t => t.key), ['b']);
});

test('large maps retain terrain and marker arrays across pose-only polls and replace only edited data', () => {
  const cache = new TelemetryCache();
  const tiles = Array.from({length: 1024}, (_, index) => tile(`tile-${index}`));
  const keys = tiles.map(item => item.key);
  const markers = [{id: 'ore', x: 4, y: 5, label: 'Respawn'}];
  const initial = cache.apply(response(1, [client(tiles, keys, {markers})])).clients[0];
  for (let revision = 2; revision <= 502; revision++) {
    const current = cache.apply(response(revision, [client([], [...keys], {markers: markers.map(marker => ({...marker})),
      frame: {...frame, player: {x: revision, y: 0}}})])).clients[0];
    assert.equal(current.tiles, initial.tiles, 'camera movement must not rescan or rematerialize 1024 chunks');
    assert.equal(current.tileKeys, initial.tileKeys);
    assert.equal(current.markers, initial.markers, 'equivalent wire markers do not invalidate rendering');
    assert.equal(current.frame.player.x, revision, 'pose remains live');
  }
  const replacement = tile(keys[512], 'AAAA/w==');
  const edited = cache.apply(response(503, [client([replacement], keys, {markers})])).clients[0];
  assert.notEqual(edited.tiles, initial.tiles);
  assert.equal(edited.tiles[512], replacement);
  assert.equal(initial.tiles[512], tiles[512], 'published previous snapshots remain immutable');
  assert.equal(edited.tiles[511], initial.tiles[511], 'other canvases can reuse their tile objects');
  const marked = cache.apply(response(504, [client([], keys, {markers: [{...markers[0], label: 'Ready'}]})])).clients[0];
  assert.equal(marked.tiles, edited.tiles, 'editing a note does not invalidate terrain');
  assert.notEqual(marked.markers, edited.markers);
  const deleted = cache.apply(response(505, [client([], keys.slice(1), {markers})])).clients[0];
  assert.equal(deleted.tiles.length, 1023);
  assert.equal(edited.tiles.length, 1024);
});
