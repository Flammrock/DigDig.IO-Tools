import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveClient, compatiblePreview, previewWithLivePosition } from '../src/archive-source.ts';

test('loaded maps keep world positions without inventing live coordinates or sharing tile objects', () => {
  const document = {
    format: 'digdig-chunks', version: 1, savedAt: '2026-10-24T00:00:00.000Z',
    source: { label: 'Saved game', buildHash: 'a'.repeat(64), terrainMode: 'materials-v1', world: { centerX: 20, centerY: 30, radius: 100 } },
    tiles: [{ key: 'one', x: -1, y: -1, width: 1026, height: 1026, pixelWidth: 1, pixelHeight: 1, rgba: 'eEQA/w==' }],
  };
  const client = archiveClient(document, 'archive-one');
  assert.equal(client.clientId, 'archive-one');
  assert.equal(client.frame.status, 'waiting');
  assert.equal(client.frame.player, undefined);
  assert.equal(client.frame.camera, undefined);
  assert.deepEqual(client.frame.world, document.source.world);
  assert.deepEqual(client.tiles, document.tiles);
  client.tiles[0].x = 999;
  assert.equal(document.tiles[0].x, -1);
  client.frame.world.radius = 50;
  assert.equal(document.source.world.radius, 100);
});

test('preview overlays matching live position and changing bounds while retaining saved terrain and markers', () => {
  const document = { format: 'digdig-chunks', version: 1, savedAt: '2026-10-24T00:00:00.000Z',
    source: { label: 'Saved', buildHash: 'a'.repeat(64), terrainMode: 'materials-v1', world: { centerX: 20, centerY: 30, radius: 100 } },
    tiles: [{ key: 'saved', x: 1, y: 2 }], markers: [{ id: 'note', x: 5, y: 6, label: 'Return here' }] };
  const preview = archiveClient(document, 'archive');
  const live = { clientId: 'live', stale: false, lastSeen: 123, tiles: [{ key: 'live' }], markers: [],
    frame: { status: 'live', buildHash: 'a'.repeat(64), terrainMode: 'materials-v1', capturedAt: 'now',
      world: { centerX: 20, centerY: 30, radius: 120 }, player: { x: 55, y: 66 }, camera: { x: 55, y: 66, scale: 1 } } };
  const first = previewWithLivePosition(preview, document, live, 124);
  assert.equal(first.tiles, preview.tiles);
  assert.equal(first.markers, preview.markers);
  assert.equal(first.frame.world.radius, 120);
  assert.deepEqual(first.frame.player, live.frame.player);
  assert.equal(first.lastSeen, 123);
  live.frame.player.x = 90;
  live.frame.world.radius = 150;
  assert.equal(first.frame.player.x, 55);
  assert.equal(first.frame.world.radius, 120);
  assert.equal(previewWithLivePosition(preview, document, live, 124).frame.player.x, 90);
  for (const radius of [150, 60, 200]) {
    live.frame.world.radius = radius;
    const updated = previewWithLivePosition(preview, document, live, 124);
    assert.equal(updated.frame.world.radius, radius);
    assert.equal(updated.tiles, preview.tiles);
    assert.equal(updated.markers, preview.markers);
    assert.equal(preview.frame.world.radius, 100);
    assert.equal(document.source.world.radius, 100);
  }
  assert.equal(preview.frame.player, undefined);
  assert.equal(previewWithLivePosition(preview, document, { ...live, stale: true }), preview);
  assert.equal(previewWithLivePosition(preview, document, live, 6000), preview);
  assert.equal(previewWithLivePosition(preview, document, undefined, 124), preview);
  assert.equal(previewWithLivePosition(preview, document, { ...live, frame: { ...live.frame, status: 'waiting' } }, 124), preview);
  assert.equal(compatiblePreview(document, { ...live, frame: { ...live.frame, buildHash: 'b'.repeat(64) } }), false);
  assert.equal(compatiblePreview(document, { ...live, frame: { ...live.frame, world: { ...live.frame.world, centerX: 99 } } }), false);
});
