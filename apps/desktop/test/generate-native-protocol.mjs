// Regenerate with: node apps/desktop/test/generate-native-protocol.mjs
// Rust replays the same operations against the Node bridge's recorded results.
import { mkdir, writeFile } from 'node:fs/promises';
import { TelemetryStore } from '../../dev-server/src/telemetry.mjs';

let at = 1000, auto = true;
const store = new TelemetryStore({ now: () => at, autoReconnect: () => auto });
const steps = [];
function step(route, body, query = []) {
  const entry = { at, auto, route, ...(body === undefined ? {} : { body }), query };
  const id = body?.clientId;
  try {
    switch (route) {
      case '/reports': store.update(id, body.report); break;
      case '/telemetry': entry.expected = store.read(Object.fromEntries(query.map(([key, value]) => [key, key === 'since' ? Number(value) : value]))); break;
      case '/telemetry/clear': store.clear(id); entry.expected = { cleared: true, clientId: id }; break;
      case '/telemetry/cleanup': entry.expected = { removed: store.cleanupInactiveGames() }; break;
      case '/telemetry/markers': entry.expected = { saved: true, clientId: id, marker: store.saveMarker(id, body.marker) }; break;
      case '/telemetry/merge': entry.expected = { merged: true, clientId: id, ...store.merge(id, body.document) }; break;
      case '/telemetry/delete': entry.expected = { deleted: true, clientId: id, ...store.deleteItems(id, body) }; break;
      default: throw Error(route);
    }
  } catch { entry.error = true; }
  steps.push(entry);
}
const hash = 'a'.repeat(64);
const world = { centerX: 0, centerY: 0, radius: 500 };
const tile = (key, pixels) => ({ key, x: key === 'b' ? 64 : 0, y: 0, width: 64, height: 64,
  pixelWidth: 2, pixelHeight: 1, rgba: Buffer.from(pixels).toString('base64') });
const dirt = [120, 68, 0, 255], quartz = [221, 221, 221, 255], unknown = [0, 0, 0, 0];
const frame = (tiles = [], patch = {}) => ({ version: 1, source: 'game', status: 'live', message: 'Protocol fixture',
  buildHash: hash, capturedAt: '2026-10-24T12:00:00.000Z', terrainMode: 'materials-v1', world,
  player: { x: 10, y: 20, normalizedX: 0.02, normalizedY: 0.04 },
  camera: { x: 10, y: 20, scale: 1, width: 800, height: 600 }, tiles, ...patch });
const report = (id, tiles = [], patch = {}) => step('/reports', { clientId: id, kind: 'map-frame', report: frame(tiles, patch) });
const read = since => step('/telemetry', undefined, since === undefined ? [] : [['since', String(since)]]);
const document = (tiles, markers = []) => ({ format: 'digdig-chunks', version: 1, savedAt: '2026-10-24T12:00:00.000Z',
  source: { label: 'Protocol fixture', buildHash: hash, terrainMode: 'materials-v1', world },
  tiles: tiles.map(t => ({ ...t, observedPixels: [...Buffer.from(t.rgba, 'base64')].filter((v, i) => i % 4 === 3 && v === 255).length })), markers });

read();
report('a-game', [tile('a', [...dirt, ...unknown])]); read();
at += 50; report('b-game', [tile('b', [...quartz, ...unknown])]); read(1);
at += 50; report('c-fixture', [tile('a', [...quartz, ...quartz])], { source: 'fixture', buildHash: null, terrainMode: undefined }); read();
step('/telemetry/markers', { clientId: 'a-game', marker: { id: 'mine', x: 3, y: 4, label: 'Return here' } }); read(3);
at += 50; report('b-game', [tile('a', [...unknown, ...quartz])]); read();
const revision = store.read().revision;
at += 50; report('a-game', [tile('a', [...unknown, ...unknown])]); read(revision);
step('/telemetry/merge', { clientId: 'b-game', document: document([tile('a', [...quartz, ...dirt]), tile('b', [...dirt, ...dirt])],
  [{ id: 'mine', x: 9, y: 9, label: 'Older note' }, { id: 'other', x: 2, y: 3, label: 'Saved note' }]) }); read();
step('/telemetry/merge', { clientId: 'a-game', document: document([{ ...tile('new', [...dirt, ...dirt]), x: 200 },
  { ...tile('a', [...dirt, ...dirt]), x: 500 }]) }); read();
step('/telemetry/delete', { clientId: 'b-game', tileKeys: ['b'], markerIds: ['other'] }); read(revision);
step('/telemetry/clear', { clientId: 'a-game' }); read(revision);
report('a-game', [tile('a', [...dirt, ...unknown])]);
auto = false; at += 6000; read();
step('/telemetry/cleanup', {}); read();
step('/telemetry/markers', { clientId: 'game-map', marker: { id: 'retained', x: 0, y: 0, label: 'No sessions needed' } });
at += 100; report('d-game', [tile('b', [...dirt, ...unknown])]); read();
auto = true; at += 6000; report('e-game', []); read();
at += 301000; read();
step('/telemetry/clear', { clientId: 'game-map' }); read();
report('invalid', [], { capturedAt: '2026-02-30T12:00:00.000Z' });
report('invalid', [tile('a', [1, 2, 3, 0, ...dirt])]); read();
await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('./fixtures/native-protocol.json', import.meta.url), JSON.stringify(steps, null, 2) + '\n');
console.log(`Recorded ${steps.length} native protocol steps from the Node bridge.`);
