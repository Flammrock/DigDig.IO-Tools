import assert from 'node:assert/strict';
import test from 'node:test';
import { TileScheduler } from '../src/tile-scheduler.ts';

test('camera jumps retire old reservations and newly visible tiles enter the fair rotation', () => {
  const scheduler = new TileScheduler(2);
  scheduler.beginFrame();
  assert.equal(scheduler.includes('old-a'), true); assert.equal(scheduler.includes('old-b'), true);
  scheduler.beginFrame();
  assert.equal(scheduler.includes('new-a'), false); assert.equal(scheduler.includes('new-b'), false);
  scheduler.beginFrame();
  assert.equal(scheduler.includes('new-a'), true); assert.equal(scheduler.includes('new-b'), true);
  scheduler.clear(); scheduler.beginFrame();
  assert.equal(scheduler.includes('first-after-reset'), true);
});

test('fog-only tiles participate in rotation without excluding late positive tiles', () => {
  const scheduler = new TileScheduler(2), samples = new Set();
  const tiles = ['fog-a', 'fog-b', 'fog-c', 'ore-a', 'ore-b'];
  for (let frame = 0; frame < 3; frame++) {
    scheduler.beginFrame();
    for (const tile of tiles) if (scheduler.includes(tile)) samples.add(tile);
  }
  assert.deepEqual(samples, new Set(tiles));
});
