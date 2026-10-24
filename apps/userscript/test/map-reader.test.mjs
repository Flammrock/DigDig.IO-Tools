import assert from 'node:assert/strict';
import test from 'node:test';
import { locateTerrainTile, readMapState } from '../src/map-reader.ts';

const layout = {
  mapX: 0, mapY: 4, mapRadius: 8, cameraPointer: 12, cameraOffset: 32,
  cameraX: 8, cameraY: 12, cameraScale: 16, viewWidth: 20, viewHeight: 24, scaleMode: 'divide-f32',
};

function writeState(memory, pointer = 256, x = 375) {
  const view = new DataView(memory.buffer);
  view.setFloat32(layout.mapX, 250, true);
  view.setFloat32(layout.mapY, -500, true);
  view.setFloat32(layout.mapRadius, 1000, true);
  view.setUint32(layout.cameraPointer, pointer, true);
  const base = pointer + layout.cameraOffset;
  view.setFloat32(base + layout.cameraX, x, true);
  view.setFloat32(base + layout.cameraY, -250, true);
  view.setFloat32(base + layout.cameraScale, 1.234567, true);
  view.setInt32(base + layout.viewWidth, 1440, true);
  view.setInt32(base + layout.viewHeight, 1081, true);
}

test('reads the dynamic camera pointer, matches f32 scale arithmetic, and never writes memory', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  writeState(memory);
  const before = new Uint8Array(memory.buffer).slice();
  const state = readMapState(memory, layout);
  assert.deepEqual(state.world, { centerX: 250, centerY: -500, radius: 1000 });
  assert.deepEqual(state.player, { x: 375, y: -250, normalizedX: 0.125, normalizedY: 0.25 });
  assert.equal(state.camera.scale, Math.fround(Math.fround(1.234567) * Math.max(Math.fround(1440 / 1920), Math.fround(1081 / 1080))));
  assert.deepEqual(new Uint8Array(memory.buffer), before);
  const oldBuffer = memory.buffer;
  memory.grow(1);
  writeState(memory, 70000, 500);
  assert.notEqual(memory.buffer, oldBuffer);
  assert.equal(readMapState(memory, layout).player.x, 500, 'a fresh view and pointer are required after growth');
});

test('rereads a growing and shrinking map radius while camera and tile coordinates stay fixed', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  writeState(memory);
  const view = new DataView(memory.buffer);
  const first = readMapState(memory, layout);
  for (const radius of [1600, 700, 1000]) {
    view.setFloat32(layout.mapRadius, radius, true); // Independently authored fixture data only.
    const before = new Uint8Array(memory.buffer).slice();
    const state = readMapState(memory, layout);
    assert.equal(state.world.radius, radius);
    assert.deepEqual(state.camera, first.camera);
    assert.equal(state.player.normalizedX, (375 - 250) / radius);
    assert.deepEqual(new Uint8Array(memory.buffer), before);
  }
  assert.equal(first.world.radius, 1000, 'earlier samples are independent snapshots');
});

test('rejects uninitialized, unaligned, and out-of-bounds camera data instead of guessing offsets', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  assert.throws(() => readMapState(memory, layout), /not initialized/);
  writeState(memory);
  const view = new DataView(memory.buffer);
  view.setUint32(layout.cameraPointer, 255, true);
  assert.throws(() => readMapState(memory, layout), /not initialized/);
  view.setUint32(layout.cameraPointer, 65532, true);
  assert.throws(() => readMapState(memory, layout), /outside/);
  assert.throws(() => readMapState(memory, { ...layout, cameraPointer: -1 }), /outside/);
  writeState(memory);
  view.setFloat32(layout.mapRadius, NaN, true);
  assert.throws(() => readMapState(memory, layout), /plausibility/);
  view.setFloat32(layout.mapRadius, 1e7 + 1, true);
  assert.throws(() => readMapState(memory, layout), /plausibility/, 'reader and bridge must agree on radius bounds');
});

test('inverts camera transforms with destination offsets and refuses rotated or invalid draws', () => {
  const state = {
    world: { centerX: 100, centerY: 200, radius: 9000 },
    player: { x: 350, y: 500, normalizedX: 0, normalizedY: 0 },
    camera: { x: 350, y: 500, scale: 2, width: 1920, height: 1080 },
  };
  const transform = { a: 2, b: 0, c: 0, d: 2, e: 960 + (1024 - 350) * 2, f: 540 + (2048 - 500) * 2 };
  const destination = { x: -1, y: -1, width: 1026, height: 1026 };
  const tile = locateTerrainTile(state, transform, destination);
  assert.deepEqual(tile, { key: '1023,2047,1026,1026', x: 1023, y: 2047, width: 1026, height: 1026 });
  for (const invalid of [{ ...transform, b: 1 }, { ...transform, c: 1 }, { ...transform, a: -2 }, { ...transform, e: NaN }]) {
    assert.equal(locateTerrainTile(state, invalid, destination), null);
  }
  assert.equal(locateTerrainTile(state, transform, { ...destination, width: 0 }), null);
});
