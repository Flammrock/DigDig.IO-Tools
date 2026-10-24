import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAX_BODY_BYTES, MAX_MERGE_BODY_BYTES, startDevServer } from '../src/server.mjs';
import { DEFAULT_VIEWER_SETTINGS } from '../src/settings.mjs';

const TOKEN = 'development-test-token-0123456789';

async function fixture(t, options = {}) {
  const prefix = path.join(os.tmpdir(), 'digdig-server-test-');
  const rootDir = await mkdtemp(prefix);
  const distDir = path.join(rootDir, 'dist/userscript');
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'dev.user.js'), '// ==UserScript==\n// install fixture\n');
  await writeFile(path.join(distDir, 'runtime.js'), 'console.log("first");');
  const bridge = await startDevServer({ rootDir, port: 0, token: TOKEN, ...options });
  t.after(async () => {
    await bridge.close();
    assert.ok(path.resolve(rootDir).startsWith(path.resolve(prefix)));
    await rm(rootDir, { recursive: true, force: true });
  });
  const request = (pathname, options = {}) => fetch(`${bridge.url}${pathname}`, {
    ...options,
    headers: { 'X-DigDig-Token': TOKEN, ...options.headers },
  });
  const post = (pathname, value) => request(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  return { rootDir, distDir, bridge, request, post };
}

test('serves local installation and health while requiring the token for API routes', async (t) => {
  const { bridge, request } = await fixture(t);
  const health = await fetch(`${bridge.url}/health`);
  assert.equal(health.status, 200);
  const status = await health.json();
  assert.equal(status.ok, true);
  assert.equal(typeof status.serverId, 'string');
  assert.ok(!JSON.stringify(status).includes(TOKEN));

  const installed = await fetch(`${bridge.url}/install.user.js`);
  assert.equal(installed.status, 200);
  assert.match(await installed.text(), /==UserScript==/);
  assert.equal(installed.headers.get('cache-control'), 'no-store');
  assert.equal(installed.headers.get('access-control-allow-origin'), null);

  for (const pathname of ['/bundle', '/events?clientId=test', '/clients', '/telemetry', '/settings']) {
    const unauthorized = await fetch(`${bridge.url}${pathname}`);
    assert.equal(unauthorized.status, 401, pathname);
    await unauthorized.text();
  }
  const wrongToken = await request('/clients', { headers: { 'X-DigDig-Token': 'incorrect' } });
  assert.equal(wrongToken.status, 401);
  await wrongToken.text();
  const clients = await request('/clients');
  assert.equal(clients.status, 200);
  assert.deepEqual((await clients.json()).clients, []);
});

test('blocks rebinding hosts and cross-origin userscript installation without enabling CORS', async (t) => {
  const { bridge, request } = await fixture(t);
  for (const headers of [
    { Origin: 'https://example.com' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
  ]) {
    for (const pathname of ['/install.user.js', '/fixture']) {
      const response = await request(pathname, { headers });
      assert.equal(response.status, 403);
      await response.text();
    }
  }
  const spoofedStatus = await new Promise((resolve, reject) => {
    const spoofed = httpRequest(`${bridge.url}/health`, {
      headers: { Host: `evil.example:${bridge.address.port}` },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    spoofed.on('error', reject);
    spoofed.end();
  });
  assert.equal(spoofedStatus, 403);
  const options = await request('/reports', { method: 'OPTIONS', headers: { Origin: 'https://digdig.io' } });
  assert.equal(options.status, 403);
  assert.equal(options.headers.get('access-control-allow-origin'), null);
  await options.text();
});

test('serves a nonce-authorized local smoke test with a valid, growable WASM memory', async (t) => {
  const { bridge } = await fixture(t);
  const response = await fetch(`${bridge.url}/fixture`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  const html = await response.text();
  const nonce = html.match(/<script nonce="([a-f0-9]+)">/)[1];
  assert.match(response.headers.get('content-security-policy'), new RegExp(`'nonce-${nonce}'`));
  assert.match(response.headers.get('content-security-policy'), /'wasm-unsafe-eval'/);
  assert.ok(!html.includes(TOKEN));
  assert.ok(html.indexOf('WebAssembly.instantiate') < html.indexOf('<body>'));
  const bytes = JSON.parse(html.match(/new Uint8Array\((\[[\d,]+\])\)/)[1]);
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes));
  assert.deepEqual(Object.keys(instance.exports), ['memory']);
  assert.equal(instance.exports.memory.buffer.byteLength, 65536);
  instance.exports.memory.grow(1);
  assert.equal(instance.exports.memory.buffer.byteLength, 131072);
  assert.match(html, /id="grow"/);
});

test('bundle revisions change with code and unavailable builds return a retryable status', async (t) => {
  const { request, distDir } = await fixture(t);
  const first = await (await request('/bundle')).json();
  assert.match(first.revision, /^[a-f0-9]{64}$/);
  assert.match(first.code, /^var __DIGDIG_RUNTIME_SETTINGS__ = \{"updateIntervalMs":100,"captureEpoch":\d+\};\nconsole\.log\("first"\);$/);
  assert.deepEqual(await (await request('/bundle')).json(), first);
  await writeFile(path.join(distDir, 'runtime.js'), 'console.log("second");');
  const second = await (await request('/bundle')).json();
  assert.notEqual(second.revision, first.revision);
  assert.ok(second.code.endsWith('console.log("second");'));
  await rm(path.join(distDir, 'runtime.js'));
  const unavailable = await request('/bundle');
  assert.equal(unavailable.status, 503);
  await unavailable.text();
});

test('delivers targeted and broadcast commands with a stable polling cursor', async (t) => {
  const { request, post } = await fixture(t);
  const initial = await (await request('/events?clientId=tab-a&after=0')).json();
  assert.deepEqual(initial.commands, []);
  await (await request('/events?clientId=tab-b&after=0')).json();
  const targetedResponse = await post('/command', { clientId: 'tab-a', type: 'report' });
  assert.equal(targetedResponse.status, 202);
  const targeted = await targetedResponse.json();
  assert.equal(targeted.recipients, 1);
  const broadcast = await (await post('/command', { type: 'ping' })).json();
  assert.equal(broadcast.recipients, 2);

  const a = await (await request('/events?clientId=tab-a&after=0')).json();
  const b = await (await request('/events?clientId=tab-b&after=0')).json();
  assert.equal(a.serverId, initial.serverId);
  assert.deepEqual(a.commands.map((command) => command.type), ['report', 'ping']);
  assert.deepEqual(b.commands.map((command) => command.type), ['ping']);
  assert.deepEqual((await (await request(`/events?clientId=tab-a&after=${a.latestId}`)).json()).commands, []);
  const clients = await (await request('/clients')).json();
  assert.deepEqual(clients.clients.map((client) => client.clientId), ['tab-a', 'tab-b']);

  const invalid = await post('/command', { type: 'execute-arbitrary-code' });
  assert.equal(invalid.status, 400);
  await invalid.text();
  const invalidCursor = await request('/events?clientId=tab-a&after=NaN');
  assert.equal(invalidCursor.status, 400);
  await invalidCursor.text();
});

test('writes reports to generated text filenames and rejects client-controlled paths', async (t) => {
  const { rootDir, post } = await fixture(t);
  const content = { memoryBytes: 65536, exports: ['memory'], values: { x: 12.5 } };
  const response = await post('/reports', { clientId: 'tab-a', kind: 'wasm-inspection', report: content });
  assert.equal(response.status, 201);
  const { filename } = await response.json();
  assert.match(filename, /^reports\/live\/[A-Za-z0-9-]+\.txt$/);
  const saved = JSON.parse(await readFile(path.join(rootDir, filename), 'utf8'));
  assert.equal(saved.clientId, 'tab-a');
  assert.equal(saved.kind, 'wasm-inspection');
  assert.deepEqual(saved.report, content);
  assert.ok(!JSON.stringify(saved).includes(TOKEN));

  for (const payload of [
    { clientId: '../../outside', kind: 'report', report: 'bad' },
    { clientId: 'tab-a', kind: '../outside', report: 'bad' },
    { clientId: 'tab-a', kind: 'report', report: null },
    { clientId: 'tab-a', kind: 'report', report: 42 },
  ]) {
    const rejected = await post('/reports', payload);
    assert.equal(rejected.status, 400);
    await rejected.text();
  }
  assert.equal((await readdir(path.join(rootDir, 'reports/live'))).length, 1);
});

test('rejects malformed and oversized JSON, including chunked requests', async (t) => {
  const { bridge, request, post } = await fixture(t);
  const malformed = await request('/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  await malformed.text();
  const wrongType = await request('/reports', { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  await wrongType.text();
  const oversized = await post('/reports', { clientId: 'tab-a', kind: 'test', report: 'x'.repeat(MAX_BODY_BYTES) });
  assert.equal(oversized.status, 413);
  await oversized.text();

  for (const pathname of ['/reports', '/command']) {
    const chunkedStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${bridge.url}${pathname}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DigDig-Token': TOKEN },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.write('{"report":"');
      request.write('x'.repeat(MAX_BODY_BYTES));
      request.end('"}');
    });
    assert.equal(chunkedStatus, 413, pathname);
  }
});

test('server restart changes the server identity and shutdown is idempotent', async (t) => {
  const { rootDir, bridge, request } = await fixture(t);
  const previous = await (await request('/events?clientId=tab-a')).json();
  await bridge.close();
  await bridge.close();
  const restarted = await startDevServer({ rootDir, port: 0, token: TOKEN });
  t.after(() => restarted.close());
  const response = await fetch(`${restarted.url}/health`);
  assert.notEqual((await response.json()).serverId, previous.serverId);
  const clients = await fetch(`${restarted.url}/clients`, { headers: { 'X-DigDig-Token': TOKEN } });
  assert.deepEqual((await clients.json()).clients, []);
});

test('refuses public binding and missing authentication configuration', async () => {
  const rootDir = path.resolve('.');
  await assert.rejects(startDevServer({ rootDir, host: '0.0.0.0', token: TOKEN }), /loopback/);
  await assert.rejects(startDevServer({ rootDir, token: 'short' }), /token/);
});

test('keeps live map telemetry in memory and preserves ordinary diagnostic reporting', async (t) => {
  const { rootDir, request, post } = await fixture(t);
  const frame = {
    version: 1, source: 'fixture', status: 'live', message: 'Synthetic test', buildHash: null,
    capturedAt: new Date().toISOString(), world: { centerX: 0, centerY: 0, radius: 100 },
    player: { x: 10, y: 20, normalizedX: 0.1, normalizedY: 0.2 },
    camera: { x: 10, y: 20, scale: 1, width: 800, height: 600 },
    tiles: [{ key: '0,0', x: 0, y: 0, width: 64, height: 64, pixelWidth: 1, pixelHeight: 1, rgba: '/wAA/w==' }],
  };
  const send = (report) => post('/reports', { clientId: 'map-tab', kind: 'map-frame', report });
  const accepted = await send(frame);
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).filename, 'live map telemetry');
  await assert.rejects(readdir(path.join(rootDir, 'reports/live')), { code: 'ENOENT' });
  await (await send({ ...frame, player: { ...frame.player, x: 11 }, tiles: [] })).json();
  const state = await (await request('/telemetry')).json();
  assert.equal(typeof state.serverId, 'string');
  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].clientId, 'map-tab');
  assert.equal(state.clients[0].stale, false);
  assert.equal(state.clients[0].frame.player.x, 11);
  assert.deepEqual(state.clients[0].frame.tiles, []);
  assert.deepEqual(state.clients[0].tiles, frame.tiles);
  assert.deepEqual((await (await request('/telemetry?clientId=missing')).json()).clients, []);
  assert.equal((await request('/telemetry?clientId=../bad')).status, 400);
  const rejected = await send({ ...frame, tiles: [{ ...frame.tiles[0], rgba: 'bad' }] });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /rgba/);
  const diagnostic = await post('/reports', { clientId: 'map-tab', kind: 'diagnostic', report: { ok: true } });
  assert.equal(diagnostic.status, 201);
  await diagnostic.json();
  assert.equal((await readdir(path.join(rootDir, 'reports/live'))).length, 1);
});

test('viewer settings validate, persist atomically, and change the runtime without changing its source file', async (t) => {
  const { bridge, rootDir, distDir, request, post } = await fixture(t);
  const initial = await (await request('/bundle')).json();
  assert.deepEqual(await (await request('/settings')).json(), DEFAULT_VIEWER_SETTINGS);
  const original = await readFile(path.join(distDir, 'runtime.js'), 'utf8');
  const invalid = [{}, { updateIntervalMs: 50 }, { updateIntervalMs: '100' }, { updateIntervalMs: 100, other: true }];
  for (const value of invalid) {
    const response = await post('/settings', value);
    assert.equal(response.status, 400);
    await response.json();
  }
  const changed = await post('/settings', { updateIntervalMs: 250 });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 250 });
  const updatedBundle = await (await request('/bundle')).json();
  assert.notEqual(updatedBundle.revision, initial.revision);
  assert.match(updatedBundle.code, /"updateIntervalMs":250/);
  assert.equal(await readFile(path.join(distDir, 'runtime.js'), 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, '.local/viewer-settings.json'), 'utf8')), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 250 });
  assert.deepEqual(await readdir(path.join(rootDir, '.local')), ['viewer-settings.json']);
  const unchanged = await post('/settings', { updateIntervalMs: 250 });
  await unchanged.json();
  assert.equal((await (await request('/bundle')).json()).revision, updatedBundle.revision);
  const unauthorized = await fetch(`${bridge.url}/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"updateIntervalMs":100}',
  });
  assert.equal(unauthorized.status, 401);
  await unauthorized.json();
  await bridge.close();
  const restarted = await startDevServer({ rootDir, port: 0, token: TOKEN });
  try {
    const persisted = await fetch(`${restarted.url}/settings`, { headers: { 'X-DigDig-Token': TOKEN } });
    assert.deepEqual(await persisted.json(), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 250 });
  } finally { await restarted.close(); }
});

test('incremental HTTP snapshots recover invalid cursors and clear only the selected fixture session', async (t) => {
  const { request, post, bridge } = await fixture(t);
  const frame = {
    version: 1, source: 'fixture', status: 'live', message: 'Live test', buildHash: 'a'.repeat(64),
    capturedAt: '2026-10-24T00:00:00.000Z', terrainMode: 'materials-v1',
    world: { centerX: 0, centerY: 0, radius: 100 },
    player: { x: 10, y: 20, normalizedX: 0.1, normalizedY: 0.2 },
    camera: { x: 10, y: 20, scale: 1, width: 800, height: 600 },
    tiles: [{ key: '0,0', x: 0, y: 0, width: 64, height: 64, pixelWidth: 1, pixelHeight: 1, rgba: '/wAA/w==' }],
  };
  for (const clientId of ['first', 'second']) await (await post('/reports', { clientId, kind: 'map-frame', report: frame })).json();
  const full = await (await request('/telemetry')).json();
  assert.equal(full.reset, true);
  assert.equal(full.clients.length, 2);
  const query = `since=${full.revision}&serverId=${full.serverId}`;
  const delta = await (await request(`/telemetry?${query}`)).json();
  assert.equal(delta.reset, false);
  assert.ok(delta.clients.every((client) => client.tiles.length === 0 && client.tileKeys.length === 1));
  for (const suffix of ['since=bad', 'since=-1', `since=${full.revision + 10}&serverId=${full.serverId}`, `since=${full.revision}&serverId=old`]) {
    const reset = await (await request(`/telemetry?${suffix}`)).json();
    assert.equal(reset.reset, true);
    assert.equal(reset.clients[0].tiles.length, 1);
  }
  const oldBundle = await (await request('/bundle')).json();
  const unauthorized = await fetch(`${bridge.url}/telemetry/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"clientId":"first"}' });
  assert.equal(unauthorized.status, 401);
  await unauthorized.json();
  assert.deepEqual(await (await post('/telemetry/clear', { clientId: 'first' })).json(), { cleared: true, clientId: 'first' });
  const cleared = await (await request(`/telemetry?${query}`)).json();
  assert.equal(cleared.clients[0].resetTiles, true);
  assert.deepEqual(cleared.clients[0].tileKeys, []);
  assert.equal(cleared.clients[0].frame.player.x, 10);
  assert.equal(cleared.clients[1].resetTiles, false);
  assert.equal(cleared.clients[1].tileKeys.length, 1);
  assert.notEqual((await (await request('/bundle')).json()).revision, oldBundle.revision, 'clear triggers a runtime recapture');
  assert.equal((await post('/telemetry/clear', { clientId: 'missing' })).status, 404);
});

test('protected map editing merges bounded files, publishes markers and deletions without recapturing or logging terrain', async (t) => {
  const { request, post, bridge, rootDir } = await fixture(t);
  const tile = { key: '0,0', x: 0, y: 0, width: 64, height: 64, pixelWidth: 1, pixelHeight: 1, rgba: '/wAA/w==' };
  const frame = {
    version: 1, source: 'game', status: 'live', message: 'Live test', buildHash: 'a'.repeat(64),
    capturedAt: '2026-10-24T00:00:00.000Z', terrainMode: 'materials-v1',
    world: { centerX: 0, centerY: 0, radius: 100 },
    player: { x: 10, y: 20, normalizedX: 0.1, normalizedY: 0.2 },
    camera: { x: 10, y: 20, scale: 1, width: 800, height: 600 }, tiles: [tile],
  };
  await (await post('/reports', { clientId: 'scan', kind: 'map-frame', report: frame })).json();
  const original = await (await request('/telemetry')).json();
  const bundle = await (await request('/bundle')).json();
  const marker = { id: 'note-1', x: 10, y: 20, label: 'Return after respawn' };
  const document = {
    format: 'digdig-chunks', version: 1, savedAt: frame.capturedAt,
    source: { label: 'Saved map', buildHash: frame.buildHash, terrainMode: frame.terrainMode, world: frame.world },
    tiles: [{ ...tile, key: 'saved', x: 64 }], markers: [marker],
  };
  for (const route of ['/telemetry/merge', '/telemetry/delete', '/telemetry/markers']) {
    const response = await fetch(`${bridge.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
    await response.json();
  }
  assert.deepEqual(await (await post('/telemetry/merge', { clientId: 'scan', document })).json(),
    { merged: true, clientId: 'scan', tiles: 1, markers: 1 });
  const changedMarker = { ...marker, x: 30, label: 'Explore here later' };
  assert.deepEqual(await (await post('/telemetry/markers', { clientId: 'scan', marker: changedMarker })).json(),
    { saved: true, clientId: 'scan', marker: changedMarker });
  const merged = await (await request(`/telemetry?since=${original.revision}&serverId=${original.serverId}`)).json();
  assert.deepEqual(merged.clients[0].tiles.map(item => item.key), ['saved']);
  assert.deepEqual(merged.clients[0].markers, [changedMarker]);
  assert.equal(merged.clients[0].lastSeen, original.clients[0].lastSeen);
  assert.deepEqual(merged.clients[0].frame, original.clients[0].frame);
  assert.deepEqual(await (await post('/telemetry/delete', { clientId: 'scan', tileKeys: ['saved'], markerIds: [marker.id] })).json(),
    { deleted: true, clientId: 'scan', tiles: 1, markers: 1 });
  const deleted = await (await request(`/telemetry?since=${merged.revision}&serverId=${merged.serverId}`)).json();
  assert.deepEqual(deleted.clients[0].tileKeys, ['0,0']);
  assert.deepEqual(deleted.clients[0].markers, []);
  assert.equal(deleted.clients[0].resetTiles, false);
  assert.equal((await (await request('/bundle')).json()).revision, bundle.revision, 'selective edits must not restart capture');
  for (const [route, body] of [
    ['/telemetry/merge', { clientId: 'scan', document: { ...document, version: 99 } }],
    ['/telemetry/delete', { clientId: 'scan', tileKeys: ['0,0'], markerIds: [null] }],
    ['/telemetry/markers', { clientId: 'scan', marker: { ...marker, label: '' } }],
  ]) {
    const response = await post(route, body);
    assert.equal(response.status, 400);
    await response.json();
  }
  const absent = await post('/telemetry/merge', { clientId: 'missing', document });
  assert.equal(absent.status, 404);
  await absent.json();
  const large = { ...document, tiles: Array.from({ length: 55 }, (_, index) => ({
    ...tile, key: `large-${index}`, x: index * 64, pixelWidth: 64, pixelHeight: 64,
    rgba: Buffer.alloc(64 * 64 * 4, 255).toString('base64'),
  })) };
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > MAX_BODY_BYTES);
  const accepted = await post('/telemetry/merge', { clientId: 'scan', document: large });
  assert.equal(accepted.status, 200, 'full file import has its own body limit');
  assert.equal((await accepted.json()).tiles, 55);
  const tooLarge = await new Promise((resolve, reject) => {
    const call = httpRequest(`${bridge.url}/telemetry/merge`, {
      method: 'POST', headers: { 'X-DigDig-Token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': MAX_MERGE_BODY_BYTES + 1 },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    call.on('error', reject);
    call.end('{}');
  });
  assert.equal(tooLarge, 413);
  const rate = await post('/settings', { updateIntervalMs: 20 });
  assert.equal(rate.status, 200);
  assert.deepEqual(await rate.json(), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 20 });
  assert.match((await (await request('/bundle')).json()).code, /"updateIntervalMs":20/);
  await assert.rejects(readdir(path.join(rootDir, 'reports/live')), { code: 'ENOENT' });
});

test('shared game cleanup is authenticated, preserves fixtures and map data, and preferences do not reload capture', async (t) => {
  let clock = 1000;
  const { request, post, bridge } = await fixture(t, { now: () => clock });
  const bundle = await (await request('/bundle')).json();
  const preferences = await (await post('/settings', { showNotifications: true, autoReconnect: false, alwaysOnTop: true })).json();
  assert.deepEqual(preferences, { updateIntervalMs: 100, showNotifications: true, autoReconnect: false, alwaysOnTop: true, windowOpacity: 1 });
  assert.equal((await (await request('/bundle')).json()).revision, bundle.revision);
  assert.ok(!bundle.code.includes('autoReconnect'));
  const frame = {
    version: 1, source: 'game', status: 'live', message: 'HTTP shared map test', buildHash: 'a'.repeat(64),
    capturedAt: '2026-10-24T00:00:00.000Z', terrainMode: 'materials-v1',
    world: { centerX: 0, centerY: 0, radius: 100 },
    player: { x: 10, y: 20, normalizedX: .1, normalizedY: .2 },
    camera: { x: 10, y: 20, scale: 1, width: 800, height: 600 },
    tiles: [{ key: 'old', x: 0, y: 0, width: 64, height: 64, pixelWidth: 1, pixelHeight: 1, rgba: '/wAA/w==' }],
  };
  await (await post('/reports', { clientId: 'old', kind: 'map-frame', report: frame })).json();
  await (await post('/reports', { clientId: 'fixture', kind: 'map-frame', report: { ...frame, source: 'fixture', buildHash: null } })).json();
  const marker = { id: 'note', x: 10, y: 20, label: 'Preserved' };
  await (await post('/telemetry/markers', { clientId: 'old', marker })).json();
  clock += 5001;
  await (await post('/reports', { clientId: 'new', kind: 'map-frame', report: { ...frame, tiles: [{ ...frame.tiles[0], key: 'new' }] } })).json();
  const before = await (await request('/telemetry')).json();
  assert.deepEqual(before.clients.map(client => client.clientId), ['old', 'fixture', 'new']);
  assert.equal(before.clients[0].mapId, before.clients[2].mapId);
  assert.equal(before.clients[2].mapData, false);
  assert.equal(before.clients[0].tiles.length, 2);
  const unauthorized = await fetch(`${bridge.url}/telemetry/cleanup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(unauthorized.status, 401); await unauthorized.json();
  assert.equal((await post('/telemetry/cleanup', { clientId: 'fixture' })).status, 400);
  assert.deepEqual(await (await post('/telemetry/cleanup', {})).json(), { removed: ['old'] });
  const cleaned = await (await request('/telemetry')).json();
  assert.deepEqual(cleaned.clients.map(client => client.clientId), ['fixture', 'new']);
  assert.deepEqual(cleaned.clients[1].tiles.map(tile => tile.key), ['old', 'new']);
  assert.deepEqual(cleaned.clients[1].markers, [marker]);
  await (await post('/settings', { autoReconnect: true })).json();
  clock += 5001;
  await (await post('/reports', { clientId: 'third', kind: 'map-frame', report: { ...frame, tiles: [{ ...frame.tiles[0], key: 'third' }] } })).json();
  const reconnected = await (await request('/telemetry')).json();
  assert.deepEqual(reconnected.clients.map(client => client.clientId), ['fixture', 'third']);
  assert.equal(reconnected.clients[1].tiles.length, 3);
  assert.deepEqual(reconnected.clients[1].markers, [marker]);
  assert.equal((await (await request('/bundle')).json()).revision, bundle.revision);
});
