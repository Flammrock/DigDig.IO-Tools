import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startDevServer } from '../../dev-server/src/server.mjs';
import { buildResolverFixture } from '../../../packages/layout-resolver/test/fixtures.mjs';
import { LayoutResolution } from '../src/layout-resolution.ts';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function until(check, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(40); }
  throw Error(`Timed out: ${message}`);
}

test('real bridge Worker resolves an authored module, caches only after render checks, and revalidates after restart', { timeout: 30000 }, async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'digdig-layout-integration-'));
  const token = 'isolated-layout-integration-token';
  const fixture = await buildResolverFixture({ origin: 9000, owner: 14000, fieldShift: 16, memoryExport: 'changed_memory_name' });
  const sourceHash = hash(fixture.bytes), sourceCopy = fixture.bytes.slice();
  // Only this independently authored toy module is instantiated by this test.
  const source = await WebAssembly.instantiate(fixture.bytes);
  const memory = source.instance.exports[fixture.layout.memoryExport];
  const memoryBefore = new Uint8Array(memory.buffer).slice();
  const entry = { id: 1, sha256: sourceHash, instance: source.instance, module: source.module,
    bytes: fixture.bytes.slice(), memories: [{ name: fixture.layout.memoryExport, origin: 'export', memory }] };
  let server, controller;
  const requests = [];
  async function connect(clientId) {
    server = await startDevServer({ rootDir, token, port: 0 });
    const request = async (route, body) => {
      const response = await fetch(server.url + route, { method: 'POST',
        headers: { 'X-DigDig-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    controller = new LayoutResolution({ clientId, capture: { instances: [entry] },
      requestLayout: async (route, body) => { const value = await request(route, body); requests.push({ route, body, response: value }); return value; },
      report: (kind, report) => request('/reports', { clientId, kind, report }) });
  }
  const cacheDir = path.join(rootDir, '.local', 'layout-cache');
  const files = () => readdir(cacheDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const camera = fixture.mapState.camera;
  const transform = { a: camera.scale, b: 0, c: 0, d: camera.scale,
    e: camera.width / 2 - camera.x * camera.scale, f: camera.height / 2 - camera.y * camera.scale };
  function draw(frame, index) {
    const current = controller.read();
    const rect = { x: index * 1024 - 1, y: -1, width: 1026, height: 1026 };
    return controller.observe(current, frame, transform, rect, rect, `${index},0`);
  }
  async function validate() {
    let frame = 0;
    await until(async () => {
      draw(++frame, 0); draw(frame, 1);
      await pause(110);
      return controller.read().status === 'live';
    }, 'runtime render validation');
  }
  try {
    await connect('first-layout-client');
    const candidate = await until(() => { const result = controller.read(); return result.layout ? result : null; }, 'Worker candidate');
    assert.equal(candidate.status, 'waiting');
    assert.deepEqual(candidate.data, fixture.mapState);
    assert.equal(requests[0].body.wasmBase64, undefined, 'cache lookup precedes byte upload');
    const uploads = requests.filter(request => request.body.wasmBase64);
    assert.equal(uploads.length, 1);
    assert.equal(hash(Buffer.from(uploads[0].body.wasmBase64, 'base64')), sourceHash);
    assert.equal(requests.at(-1).response.origin, 'resolved');
    assert.deepEqual(await files(), [], 'static resolution alone cannot populate persistent cache');
    assert.equal(draw(1, 0), false); assert.equal(draw(1, 1), false);
    assert.equal(controller.read().status, 'waiting', 'two draws within one frame are not sufficient');
    await validate();
    const cachedFiles = await files(); assert.equal(cachedFiles.length, 1);
    const cached = JSON.parse(await readFile(path.join(cacheDir, cachedFiles[0]), 'utf8'));
    assert.equal(cached.wasmSha256, sourceHash); assert.equal(cached.resolverVersion, 'wasm-patterns-1');
    assert.deepEqual(cached.layout, fixture.layout);
    controller.dispose(); await server.close();
    requests.length = 0;
    await connect('second-layout-client');
    const restored = await until(() => { const result = controller.read(); return result.layout ? result : null; }, 'cached layout after bridge restart');
    assert.equal(restored.status, 'waiting', 'disk cache does not inherit runtime readiness');
    assert.equal(requests.at(-1).response.origin, 'cache');
    assert.ok(requests.every(request => request.body.wasmBase64 === undefined));
    await validate();
    assert.equal(controller.read().status, 'live');
    assert.equal(requests.filter(request => request.route === '/layouts/validate').length, 1);
    assert.equal(hash(fixture.bytes), sourceHash); assert.deepEqual(fixture.bytes, sourceCopy);
    assert.deepEqual(new Uint8Array(memory.buffer), memoryBefore);
  } finally {
    controller?.dispose(); await server?.close();
    assert.ok(path.resolve(rootDir).startsWith(path.join(path.resolve(os.tmpdir()), 'digdig-layout-integration-')));
    await rm(rootDir, { recursive: true, force: true });
  }
});
