import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LayoutCache, validCacheEntry } from '../src/layout-cache.mjs';
import { LayoutService, RESOLVER_VERSION, MAX_LAYOUT_BODY_BYTES } from '../src/layout-service.mjs';
import { startDevServer, MAX_BODY_BYTES } from '../src/server.mjs';

const source = JSON.parse(await readFile(new URL('../../../reports/current-game-layout.json', import.meta.url), 'utf8'));
function layout() {
  const result = {};
  for (const key of ['memoryExport','mapX','mapY','mapRadius','cameraPointer','cameraOffset','cameraVtable','scaleMode']) result[key] = source[key];
  for (const [key, field] of [['cameraX','x'],['cameraY','y'],['cameraScale','scale'],['viewWidth','width'],['viewHeight','height']]) result[key] = source.cameraFields[field];
  result.terrain = { ...source.terrain, paletteProfile: 'materials-v1' }; delete result.terrain.drawImageArguments;
  return result;
}
const bytes = Buffer.from([0,97,115,109,1,0,0,0]);
const hash = createHash('sha256').update(bytes).digest('hex');
const query = { clientId: 'one', wasmSha256: hash };
const upload = { ...query, wasmBase64: bytes.toString('base64') };
const entry = () => ({ schemaVersion: 1, wasmSha256: hash, resolverVersion: RESOLVER_VERSION, resolvedAtUnixMs: Date.now(), layout: layout() });
const validation = candidate => ({ ...query, resolverVersion: RESOLVER_VERSION, ticket: candidate.ticket, evidence: { samples: 3, tiles: 2 } });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function temporary(t) {
  const prefix = path.join(os.tmpdir(), 'digdig-layout-test-'), root = await mkdtemp(prefix);
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(prefix))); await rm(root, { recursive: true, force: true }); });
  return root;
}
async function candidate(service) {
  for (let i = 0; i < 100; i++) { const result = await service.resolve(query); if (result.status !== 'pending') return result; await pause(20); }
  throw Error('Resolver did not complete');
}

test('development cache shares the native schema, survives restart and leaves sibling data intact', async t => {
  const root = await temporary(t), directory = path.join(root, '.local/layout-cache'), cache = new LayoutCache(directory);
  const original = entry(); assert.equal(validCacheEntry(original), true);
  assert.equal(await cache.get(hash, RESOLVER_VERSION), null);
  await cache.putValidated(original);
  assert.deepEqual(await new LayoutCache(directory).get(hash, RESOLVER_VERSION), original);
  assert.equal(await cache.get(hash, 'wasm-patterns-2'), null);
  const filename = path.join(directory, `layout-v1-${RESOLVER_VERSION}--${hash}.json`);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), original);
  for (const invalid of [{ ...original, schemaVersion: 2 }, { ...original, liveCameraAddress: 123 }, { ...original, wasmSha256: 'a'.repeat(64) }]) {
    await writeFile(filename, JSON.stringify(invalid)); assert.equal(await cache.get(hash, RESOLVER_VERSION), null);
  }
  for (const content of ['{broken', ' '.repeat(65537)]) { await writeFile(filename, content); assert.equal(await cache.get(hash, RESOLVER_VERSION), null); }
  await cache.putValidated(original);
  const invalid = entry(); invalid.layout.cameraOffset = 0xffffffff;
  await assert.rejects(cache.putValidated(invalid)); assert.deepEqual(await cache.get(hash, RESOLVER_VERSION), original);
  await assert.rejects(cache.get('../file', RESOLVER_VERSION)); await assert.rejects(cache.get(hash, '../version'));
  await writeFile(path.join(root, '.local/viewer-settings.json'), 'keep settings');
  await writeFile(path.join(root, '.local/bridge-token'), 'keep pairing');
  await writeFile(path.join(directory, 'notes.json'), 'keep notes');
  assert.equal(await cache.clear(), 1);
  assert.equal(await readFile(path.join(root, '.local/viewer-settings.json'), 'utf8'), 'keep settings');
  assert.equal(await readFile(path.join(root, '.local/bridge-token'), 'utf8'), 'keep pairing');
  assert.equal(await readFile(path.join(directory, 'notes.json'), 'utf8'), 'keep notes');
});

test('new layouts are deduplicated, ticket-bound and only persisted after live confirmation', async t => {
  const root = await temporary(t); let calls = 0, release;
  const service = new LayoutService(root, { analyze: async data => { calls++; assert.deepEqual(data, bytes); await new Promise(resolve => { release = resolve; }); return { status: 'candidate', layout: layout(), evidence: { coordinateCandidates: 1 } }; } });
  t.after(() => service.close());
  assert.equal((await service.resolve(query)).status, 'needs-bytes');
  assert.equal((await service.resolve(upload)).status, 'pending');
  assert.equal((await service.resolve(upload)).status, 'pending'); assert.equal(calls, 1);
  release(); const resolved = await candidate(service); assert.equal(resolved.origin, 'resolved');
  await assert.rejects(readdir(path.join(root, '.local/layout-cache')), { code: 'ENOENT' });
  assert.equal((await service.resolve(query)).ticket, resolved.ticket);
  for (const field of ['clientId', 'wasmSha256', 'resolverVersion', 'ticket']) {
    const forged = validation(resolved); forged[field] = field === 'wasmSha256' ? 'a'.repeat(64) : 'other'; await assert.rejects(service.validate(forged));
  }
  await assert.rejects(service.validate({ ...validation(resolved), layout: layout() }));
  await assert.rejects(service.validate({ ...validation(resolved), evidence: { samples: 2, tiles: 2 } }));
  assert.deepEqual(await service.validate(validation(resolved)), { cached: true });
  const restarted = new LayoutService(root); t.after(() => restarted.close());
  const hit = await restarted.resolve(query); assert.equal(hit.origin, 'cache'); assert.deepEqual(hit.layout, layout());
  assert.notEqual(hit.ticket, resolved.ticket); assert.deepEqual(await restarted.validate(validation(hit)), { cached: true });
});

test('invalid uploads and ambiguous results never become cached candidates', async t => {
  const root = await temporary(t), service = new LayoutService(root, { analyze: async () => ({ status: 'unsupported', message: 'Ambiguous matches', evidence: { count: 2 } }) });
  t.after(() => service.close());
  for (const bad of [{ ...upload, wasmSha256: 'a'.repeat(64) }, { ...upload, wasmBase64: '@@@@' }, { ...upload, wasmBase64: Buffer.from('not wasm').toString('base64') }]) await assert.rejects(service.resolve(bad));
  await service.resolve(upload); const result = await candidate(service); assert.equal(result.status, 'unsupported');
  assert.equal(result.message, 'Ambiguous matches'); await assert.rejects(readdir(path.join(root, '.local/layout-cache')), { code: 'ENOENT' });
});

test('cache failure permits the validated in-memory layout and tickets expire on time', async t => {
  const root = await temporary(t); let now = 1000;
  await mkdir(path.join(root, '.local')); await writeFile(path.join(root, '.local/layout-cache'), 'blocked');
  const service = new LayoutService(root, { now: () => now, analyze: async () => ({ status: 'candidate', layout: layout() }) });
  t.after(() => service.close());
  await service.resolve(upload); const resolved = await candidate(service);
  assert.equal((await service.validate(validation(resolved))).cached, false);
  assert.equal((await service.resolve(query)).status, 'candidate');
  now += 600001; await assert.rejects(service.validate(validation(resolved)));
  assert.equal((await service.resolve(query)).status, 'needs-bytes');
});

test('real Worker decodes an independently authored empty module and rejects it without instantiation', async t => {
  const root = await temporary(t), service = new LayoutService(root); t.after(() => service.close());
  await service.resolve(upload); const result = await candidate(service); assert.equal(result.status, 'unsupported');
  assert.deepEqual(bytes, Buffer.from([0,97,115,109,1,0,0,0]));
});

test('HTTP layout routes retain authentication, independent size limits and cached validation', async t => {
  const root = await temporary(t), cache = new LayoutCache(path.join(root, '.local/layout-cache'));
  await cache.putValidated(entry());
  const token = 'layout-http-test-token-0123456789', bridge = await startDevServer({ rootDir: root, port: 0, token });
  t.after(() => bridge.close());
  const post = (route, body, credential = token) => fetch(bridge.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DigDig-Token': credential }, body: JSON.stringify(body) });
  assert.equal((await post('/layouts/resolve', query, 'wrong')).status, 401);
  assert.equal((await fetch(bridge.url + '/layouts/resolve', { method: 'OPTIONS' })).status, 403);
  const response = await post('/layouts/resolve', query); assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), null);
  const resolved = await response.json(); assert.equal(resolved.origin, 'cache');
  assert.equal((await post('/layouts/validate', validation(resolved))).status, 200);
  assert.equal((await post('/layouts/validate', { ...validation(resolved), ticket: 'forged' })).status, 400);
  for (const [route, size] of [['/reports', MAX_BODY_BYTES], ['/layouts/resolve', MAX_LAYOUT_BODY_BYTES]]) {
    const oversized = await fetch(bridge.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DigDig-Token': token }, body: ' '.repeat(size + 1) });
    assert.equal(oversized.status, 413);
  }
  // Independent synthetic module with a large custom section tests the larger
  // analysis upload limit without changing or running any game module.
  let length = MAX_BODY_BYTES + 1; const encodedLength = [];
  do { let byte = length & 127; length >>>= 7; if (length) byte |= 128; encodedLength.push(byte); } while (length);
  const module = Buffer.concat([bytes, Buffer.from([0, ...encodedLength, 0]), Buffer.alloc(MAX_BODY_BYTES)]);
  const large = await post('/layouts/resolve', { ...query, wasmSha256: createHash('sha256').update(module).digest('hex'), wasmBase64: module.toString('base64') });
  assert.equal(large.status, 200); assert.equal((await large.json()).status, 'pending');
});
