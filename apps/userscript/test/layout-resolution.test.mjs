import assert from 'node:assert/strict';
import test from 'node:test';
import { LayoutResolution, parseResolvedLayout } from '../src/layout-resolution.ts';
import { gameLayouts } from '../src/game-layouts.ts';
import { syntheticLayout, syntheticMemory, transform, tileRect } from './helpers/layout-fixture.mjs';

const flush = () => new Promise(setImmediate);
function harness(t, requestLayout, fixture = syntheticMemory()) {
  let clock = 1000;
  t.mock.method(Date, 'now', () => clock);
  const calls = [], reports = [];
  const api = { clientId: 'synthetic-layout-client', capture: { instances: [fixture.entry] },
    async requestLayout(route, body) { calls.push({ route, body }); return requestLayout(route, body, calls); },
    async report(kind, body) { reports.push({ kind, body }); } };
  const controller = new LayoutResolution(api);
  t.after(() => controller.dispose());
  return { ...fixture, api, calls, reports, controller, advance(ms = 1100) { clock += ms; },
    async read() { const result = controller.read(); await flush(); return result; },
    async observe(frame, index = frame % 2, matrix = transform) {
      const current = controller.read(), rect = tileRect(index);
      const accepted = controller.observe(current, frame, matrix, rect, rect, `${index},0`);
      await flush(); return accepted;
    } };
}
const candidate = (layout, origin = 'resolved', ticket = 'synthetic-ticket') => ({ status: 'candidate', resolverVersion: 'wasm-patterns-1', origin, ticket, layout });

test('unknown build looks up cache first, uploads unchanged bytes, validates rendering, then commits', async t => {
  const layout = syntheticLayout();
  const h = harness(t, (route, body) => route === '/layouts/validate' ? { cached: true }
    : body.wasmBase64 ? candidate(layout) : { status: 'needs-bytes', resolverVersion: 'wasm-patterns-1' });
  const bytes = h.entry.bytes.slice(), memory = new Uint8Array(h.memory.buffer).slice();
  assert.equal((await h.read()).status, 'waiting');
  assert.equal(h.calls[0].body.wasmBase64, undefined);
  await h.read();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(Buffer.from(h.calls[1].body.wasmBase64, 'base64'), Buffer.from(bytes));
  assert.equal(h.controller.read().status, 'waiting');
  h.advance();
  assert.equal(await h.observe(1, 0), false);
  assert.equal(await h.observe(1, 1), false, 'multiple draws in one frame are not multiple samples');
  assert.equal(h.calls.length, 2);
  h.advance(100); await h.observe(2, 0);
  h.advance(100); await h.observe(3, 1);
  assert.equal(h.calls.at(-1).route, '/layouts/validate');
  assert.deepEqual(h.calls.at(-1).body.evidence, { samples: 3, tiles: 2 });
  assert.equal(h.controller.read().status, 'live');
  assert.equal(await h.observe(4, 0), true);
  assert.deepEqual(h.entry.bytes, bytes);
  assert.deepEqual(new Uint8Array(h.memory.buffer), memory);
  assert.equal(h.reports.at(-1).body.stage, 'validated');
});

test('cached recipes require new per-instance samples and live pointer reads', async t => {
  const layout = syntheticLayout();
  const h = harness(t, route => route === '/layouts/validate' ? { cached: true } : candidate(layout, 'cache'));
  await h.read();
  h.advance();
  assert.equal(h.controller.read().status, 'waiting');
  for (let frame = 1; frame <= 3; frame++) { await h.observe(frame); h.advance(100); }
  assert.equal(h.controller.read().status, 'live');
  assert.ok(h.calls.every(call => call.body.wasmBase64 === undefined));
  const nextCamera = h.camera + 4096;
  new Uint8Array(h.memory.buffer, nextCamera, 28).set(new Uint8Array(h.memory.buffer, h.camera, 28));
  h.view.setUint32(layout.cameraPointer, nextCamera - layout.cameraOffset, true);
  h.view.setFloat32(nextCamera + layout.cameraX, 50, true);
  assert.equal(h.controller.read().data.camera.x, 50, 'the cached slot is read instead of caching a heap address');
  const fresh = new LayoutResolution(h.api);
  t.after(() => fresh.dispose());
  assert.equal(fresh.read().status, 'waiting'); await flush();
  assert.equal(fresh.read().status, 'waiting', 'a new stream does not inherit runtime validation');
});

test('invalid candidate profiles become unsupported once, and ambiguous instances never activate', async t => {
  const invalid = syntheticLayout({ terrain: { ...syntheticLayout().terrain, paletteProfile: 'unknown' } });
  const h = harness(t, () => candidate(invalid));
  await h.read(); h.advance(); await h.read(); h.advance(); await h.read();
  assert.equal(h.controller.read().status, 'unsupported');
  assert.equal(h.calls.length, 1, 'a rejected schema is not repeatedly uploaded');
  const badHash = 'd'.repeat(64);
  assert.throws(() => parseResolvedLayout(syntheticLayout({ mapY: 128 }), badHash), /Overlapping/);
  assert.throws(() => parseResolvedLayout(syntheticLayout({ cameraPointer: -1 }), badHash), /Invalid/);
  h.api.capture.instances = [syntheticMemory().entry, syntheticMemory(syntheticLayout(), badHash).entry];
  h.api.requestLayout = async () => candidate(syntheticLayout());
  const ambiguous = new LayoutResolution(h.api); t.after(() => ambiguous.dispose());
  ambiguous.read(); await flush(); ambiguous.read(); await flush();
  assert.equal(ambiguous.read().status, 'unsupported');
});

test('bridge disconnects back off; stale validation tickets restart lookup', async t => {
  let offline = true, validations = 0;
  const h = harness(t, route => {
    if (offline) throw Error('bridge offline');
    if (route === '/layouts/validate') { validations++; throw Error('HTTP 400 expired ticket'); }
    return candidate(syntheticLayout());
  });
  await h.read(); await h.read();
  assert.equal(h.calls.length, 1);
  h.advance(3100); offline = false; await h.read();
  h.advance();
  for (let frame = 1; frame <= 3; frame++) { await h.observe(frame); h.advance(100); }
  assert.equal(validations, 1);
  assert.equal(h.controller.read().status, 'waiting');
  h.advance(); await h.read();
  assert.equal(h.calls.at(-1).route, '/layouts/resolve', 'expired tickets are replaced by a fresh lookup');
});

test('a late validation ACK cannot enable capture after incompatible render or memory evidence', async t => {
  let acknowledge;
  const h = harness(t, route => route === '/layouts/validate'
    ? new Promise(resolve => { acknowledge = resolve; }) : candidate(syntheticLayout()));
  await h.read(); h.advance();
  for (let frame = 1; frame <= 3; frame++) { await h.observe(frame); h.advance(100); }
  assert.equal(typeof acknowledge, 'function');
  await h.observe(4, 0, { ...transform, e: transform.e + 100 });
  acknowledge({ cached: true }); await flush();
  assert.equal(h.controller.read().status, 'waiting');
  for (let frame = 5; frame <= 7; frame++) { await h.observe(frame); h.advance(100); }
  h.view.setFloat32(h.camera + h.layout.cameraScale, 0, true);
  assert.equal(h.controller.read().status, 'waiting');
  acknowledge({ cached: true }); await flush();
  h.view.setFloat32(h.camera + h.layout.cameraScale, 1, true);
  assert.equal(h.controller.read().status, 'waiting');
});

test('known exact hashes do not call discovery; disposal ignores pending results', async t => {
  const known = syntheticMemory(gameLayouts[0], gameLayouts[0].sha256);
  const h = harness(t, () => { throw Error('must not call discovery'); }, known);
  assert.equal(h.controller.read().status, 'live'); assert.equal(h.calls.length, 0);
  let complete;
  h.api.capture.instances = [syntheticMemory().entry];
  h.api.requestLayout = () => new Promise(resolve => { complete = resolve; });
  const pending = new LayoutResolution(h.api);
  pending.read(); pending.dispose(); complete(candidate(syntheticLayout())); await flush();
  assert.equal(h.reports.length, 0);
});
