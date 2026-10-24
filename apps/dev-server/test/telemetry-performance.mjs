// Run explicitly with: node apps/dev-server/test/telemetry-performance.mjs
// Synthetic pixels only. No browser, live game, or WASM is involved.
import { performance } from 'node:perf_hooks';
import { TelemetryStore } from '../src/telemetry.mjs';

const count = 24;
const rounds = 250;
const frame = {
  version: 1, source: 'game', status: 'live', message: 'Synthetic performance sample',
  buildHash: 'a'.repeat(64), capturedAt: '2026-10-24T00:00:00.000Z', terrainMode: 'materials-v1',
  world: { centerX: 0, centerY: 0, radius: 10000 },
  player: { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
  camera: { x: 0, y: 0, scale: 1, width: 800, height: 600 },
};
function tiles(color, partial = false) {
  const bytes = Buffer.alloc(64 * 64 * 4);
  for (let offset = 0; offset < bytes.length; offset += partial ? 8 : 4) {
    bytes.set(color, offset);
  }
  return Array.from({ length: count }, (_, index) => ({
    key: String(index), x: index * 1024, y: 0, width: 1026, height: 1026,
    pixelWidth: 64, pixelHeight: 64, rgba: bytes.toString('base64'),
  }));
}
const dirt = tiles([120, 68, 0, 255]);
const quartz = tiles([221, 221, 221, 255]);
const subset = tiles([120, 68, 0, 255], true);

for (const [scenario, samples] of [
  ['identical', [dirt]], ['full replacement', [dirt, quartz]], ['unchanged subset', [subset]],
]) {
  const store = new TelemetryStore({ now: () => 1000 });
  store.update('synthetic', { ...frame, tiles: dirt });
  for (let round = 0; round < 50; round++) store.update('synthetic', { ...frame, tiles: samples[round % samples.length] });
  const started = performance.now();
  for (let round = 0; round < rounds; round++) store.update('synthetic', { ...frame, tiles: samples[round % samples.length] });
  const elapsed = performance.now() - started;
  console.log(JSON.stringify({ scenario, tilesPerFrame: count, pixelsPerTile: 4096, rounds,
    msPerFrame: Number((elapsed / rounds).toFixed(3)) }));
}
