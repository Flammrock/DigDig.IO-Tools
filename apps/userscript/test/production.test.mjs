import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import webpack from 'webpack';
import { createReleaseWebpackConfig } from '../webpack.config.mjs';
import { releaseRoot, validateReleaseUserscript } from '../../../tools/build-release-userscript.mjs';
import { assembleDeploy } from '../../../tools/deploy.mjs';

const temporary = await mkdtemp(path.join(tmpdir(), 'digdig-production-'));
const releaseVersion = '9.8.7-beta.1+report-test';
const config = createReleaseWebpackConfig({ rootDir: releaseRoot, version: releaseVersion });
config.output.path = path.join(temporary, 'userscript');
const compiler = webpack(config);
try {
  await new Promise((resolve, reject) => compiler.run((error, stats) => {
    if (error || stats?.hasErrors()) reject(error ?? new Error(stats.toString()));
    else resolve();
  }));
} finally { await new Promise(resolve => compiler.close(resolve)); }
const userscriptPath = path.join(config.output.path, 'digdig.user.js');
const source = await readFile(userscriptPath, 'utf8');

test.after(async () => {
  assert.ok(path.resolve(temporary).startsWith(path.join(path.resolve(tmpdir()), 'digdig-production-')));
  await rm(temporary, { recursive: true, force: true });
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (check()) return; await pause(10); }
  assert.fail(`Timed out: ${label}`);
}

function sandbox(code, { settings, unavailable = () => false } = {}) {
  const timers = new Set(), menus = new Map(), listeners = new Map();
  const requests = [], scheduledDelays = [], openedTabs = [], logs = [], alerts = [];
  const page = vm.runInNewContext('globalThis', {
    crypto: webcrypto, Response,
    location: { origin: 'https://digdig.io', pathname: '/' },
  });
  const original = page.WebAssembly.instantiate;
  const context = vm.createContext({
    unsafeWindow: page, crypto: webcrypto,
    Date: class extends Date { static now() { return 1_000_000; } },
    console: { info: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')) },
    alert: message => alerts.push(message),
    setTimeout: (callback, ms) => {
      scheduledDelays.push(ms);
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, Math.min(ms, 60));
      timers.add(timer); return timer;
    },
    clearTimeout,
    addEventListener: (name, handler) => listeners.set(name, handler),
    GM_registerMenuCommand: (name, callback) => menus.set(name, callback),
    GM_openInTab: (url, options) => openedTabs.push({ url, options }),
    GM_xmlhttpRequest: request => {
      requests.push(request);
      queueMicrotask(() => {
        if (unavailable()) request.onerror();
        else request.onload({ status: 200, responseText: JSON.stringify(request.url.endsWith('/settings')
          ? settings() : { accepted: true }) });
      });
    },
  });
  vm.runInContext('window=globalThis', context);
  vm.runInContext(code, context);
  return { page, original, menus, requests, scheduledDelays, openedTabs, logs, alerts,
    pagehide: event => listeners.get('pagehide')?.(event),
    dispose() {
      listeners.get('pagehide')?.({ persisted: false });
      for (const timer of timers) clearTimeout(timer);
    },
  };
}

test('release bundle is standalone; generic installation offers pairing without sending credentials', async () => {
  validateReleaseUserscript(source);
  assert.equal((source.match(/__DIGDIG_PAIRING_TOKEN__/g) ?? []).length, 1);
  assert.match(source, /@name DigDig Tools — desktop/);
  assert.match(source, /@namespace digdig-tools.desktop/);
  assert.ok(source.includes(`// @version ${releaseVersion}\n`));
  assert.match(source, /@grant GM_openInTab/);
  const sourceGuide = source.match(/\/\*\nDigDig Tools[^]*?\*\//)?.[0];
  assert.ok(sourceGuide, 'readable source guide survives production minification');
  assert.match(sourceGuide, /Allow User Scripts/);
  assert.match(sourceGuide, /disabled by default/);
  assert.doesNotMatch(source, /\/bundle|\/events|dev-token|DigDigRuntime|\beval\s*\(|new\s+Function/);
  const runtime = sandbox(source);
  try {
    assert.notEqual(runtime.page.WebAssembly.instantiate, runtime.original, 'capture starts before pairing');
    await pause(80);
    assert.equal(runtime.requests.length, 0, 'generic file does not make unauthorized requests');
    assert.equal(runtime.alerts.length, 0, 'help does not interrupt the game automatically');
    runtime.menus.get('DigDig: Help / troubleshooting')();
    assert.match(runtime.alerts[0], /Allow User Scripts/);
    assert.match(runtime.alerts[0], /brave:\/\/extensions/);
    assert.match(runtime.alerts[0], /DigDig: Pair with desktop/);
    assert.equal(runtime.requests.length, 0, 'opening help does not contact the desktop');
    runtime.menus.get('DigDig: Pair with desktop')();
    assert.equal(runtime.openedTabs[0].url, 'http://127.0.0.1:4319/install.user.js');
    assert.equal(runtime.openedTabs[0].options.active, true);
  } finally { runtime.dispose(); }
  assert.equal(runtime.page.WebAssembly.instantiate, runtime.original);
});

test('paired release captures early, retries offline, applies interval/clear/restart settings and cleans up', async () => {
  const token = '9'.repeat(64);
  let current = { updateIntervalMs: 100, captureEpoch: 0, serverId: 'first-app', showNotifications: false };
  let unavailable = true;
  const runtime = sandbox(source.replace('__DIGDIG_PAIRING_TOKEN__', token), {
    settings: () => current, unavailable: () => unavailable,
  });
  try {
    assert.notEqual(runtime.page.WebAssembly.instantiate, runtime.original);
    // Independently authored synthetic WASM; no game module is patched or used.
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const before = createHash('sha256').update(bytes).digest('hex');
    const result = await runtime.page.WebAssembly.instantiate(bytes);
    assert.ok(result.instance instanceof runtime.page.WebAssembly.Instance);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), before);
    await until(() => runtime.scheduledDelays.includes(3000), 'offline retry');
    unavailable = false;
    await until(() => runtime.requests.some(request => request.url.endsWith('/reports')), 'first capture frame');
    assert.ok(runtime.requests.every(request => request.headers['X-DigDig-Token'] === token));
    assert.ok(runtime.requests.every(request => ['/settings', '/reports'].includes(new URL(request.url).pathname)));
    const first = JSON.parse(runtime.requests.find(request => request.url.endsWith('/reports')).data);
    assert.equal(first.kind, 'map-frame');
    assert.equal(first.report.source, 'game');
    assert.equal(first.report.version, 1, 'the wire format version remains independent of the app version');
    assert.equal(first.report.appVersion, releaseVersion, 'reports carry the compiled package version');
    assert.equal(runtime.page.GM_xmlhttpRequest, undefined, 'privileged credentials never enter the game page');
    const starts = () => runtime.scheduledDelays.filter(ms => ms === 0).length;
    const initialStarts = starts();
    current = { ...current, showNotifications: true };
    await pause(160);
    assert.equal(starts(), initialStarts, 'viewer preferences do not restart capture');
    current = { ...current, updateIntervalMs: 20 };
    await until(() => starts() > initialStarts && runtime.scheduledDelays.includes(20), '20ms cadence');
    const rateStarts = starts();
    current = { ...current, captureEpoch: 1 };
    await until(() => starts() > rateStarts, 'map clear invalidates prior observed pixels');
    const clearStarts = starts();
    current = { ...current, serverId: 'restarted-app', captureEpoch: 0 };
    await until(() => starts() > clearStarts, 'app restart refreshes visible terrain');
    runtime.pagehide({ persisted: true });
    const stillActive = runtime.requests.length;
    await until(() => runtime.requests.length > stillActive, 'back/forward cache keeps observation active');
  } finally { runtime.dispose(); }
  assert.equal(runtime.page.WebAssembly.instantiate, runtime.original, 'unload restores the native entrypoint');
  const requestsAfterDispose = runtime.requests.length;
  await pause(100);
  assert.equal(runtime.requests.length, requestsAfterDispose);
});

test('deploy assembly copies only release artifacts and records hashes without replacing unrelated files', async () => {
  const rootDir = path.join(temporary, 'package');
  const binaryPath = path.join(temporary, 'desktop-test.exe');
  await writeFile(binaryPath, 'synthetic executable fixture');
  const result = await assembleDeploy({ rootDir, binaryPath, userscriptPath, version: '0.1.0', platform: 'win32' });
  assert.deepEqual(result.files.map(file => file.name), ['DigDig-Map-Observatory.exe', 'digdig.user.js', 'README.txt']);
  const manifest = JSON.parse(await readFile(path.join(result.directory, 'manifest.json'), 'utf8'));
  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(result.directory, entry.name));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(await readFile(path.join(result.directory, 'digdig.user.js'), 'utf8'), source);
  await writeFile(path.join(result.directory, 'user-notes.txt'), 'Keep this');
  await assembleDeploy({ rootDir, binaryPath, userscriptPath, version: '0.1.0', platform: 'win32' });
  assert.equal(await readFile(path.join(result.directory, 'user-notes.txt'), 'utf8'), 'Keep this');
  const invalidScript = path.join(temporary, 'invalid.user.js');
  await writeFile(invalidScript, 'development script');
  await assert.rejects(assembleDeploy({ rootDir, binaryPath, userscriptPath: invalidScript, version: '0.1.0' }), /standalone/);
});
