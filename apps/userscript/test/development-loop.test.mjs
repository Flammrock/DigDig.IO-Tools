import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import webpack from 'webpack';
import { createWebpackConfig } from '../webpack.config.mjs';
import { startDevServer } from '../../dev-server/src/server.mjs';
import { rootDir } from '../../../tools/dev-config.mjs';

const workspaceVersion = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')).version;

async function until(check, label) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`Timed out: ${label}`);
}

async function compile(config) {
  const compiler = webpack(config);
  try {
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString()));
      else resolve();
    }));
  } finally { await new Promise((resolve) => compiler.close(resolve)); }
}

test('installed loader captures WASM, applies settings without reinstall, replaces runtime, and receives commands', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'digdig-loop-'));
  const distDir = path.join(temp, 'dist');
  const reportsDir = path.join(temp, 'reports/live');
  const token = 'integration-test-token-not-a-user-secret';
  const server = await startDevServer({ rootDir: temp, port: 0, token, distDir, reportsDir });
  const timers = new Set();
  const intervals = new Set();
  const listeners = new Map();
  let page;
  try {
    const config = createWebpackConfig({ rootDir, url: server.url, token });
    config.output.path = distDir;
    await compile(config);
    const logs = [];
    const menus = new Map();
    const gmRequests = [];
    const scheduledDelays = [];
    let reloads = 0;
    // Separate VM worlds exercise the privileged bridge boundary. This does not
    // emulate Firefox Xray wrappers or prove real Tampermonkey permissions.
    const pageContext = vm.createContext({
      crypto: webcrypto, Response,
      location: { origin: 'https://digdig.io', pathname: '/', reload: () => reloads++ },
      document: { querySelectorAll: () => [] },
      innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1
    });
    page = vm.runInContext('globalThis', pageContext);
    const sandbox = vm.createContext({
      unsafeWindow: page,
      exportFunction: (fn, target, options) => {
        if (options?.defineAs) target[options.defineAs] = fn;
        return fn;
      },
      crypto: webcrypto,
      // Keep elapsed-time subtraction deterministic while leaving actual HTTP
      // requests and timers real. Other stream tests cover slow request timing.
      Date: class extends Date { static now() { return 1_000_000; } },
      navigator: { userAgent: 'Node VM bridge integration test' },
      console: { info: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
      setTimeout: (callback, ms) => {
        scheduledDelays.push(ms);
        const timer = setTimeout(callback, ms); timers.add(timer); return timer;
      },
      clearTimeout,
      setInterval: (callback, ms) => { const timer = setInterval(callback, ms); intervals.add(timer); return timer; },
      clearInterval,
      addEventListener: (event, callback) => listeners.set(event, callback),
      GM_registerMenuCommand: (name, callback) => menus.set(name, callback),
      GM_xmlhttpRequest: (details) => {
        gmRequests.push(details);
        // Network access is supplied only to the userscript sandbox, never to the page.
        void fetch(details.url, {
          method: details.method, headers: details.headers,
          ...(details.data === undefined ? {} : { body: details.data })
        }).then(async (response) => details.onload({ status: response.status, responseText: await response.text() }))
          .catch(() => details.onerror());
      }
    });
    vm.runInContext('window = globalThis', sandbox);
    const installedLoader = await readFile(path.join(distDir, 'dev.user.js'), 'utf8');
    vm.runInContext(installedLoader, sandbox);
    // Instantiate immediately, before the first asynchronous bundle request resolves.
    const result = await vm.runInContext('WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]))', pageContext);
    assert.equal(page.GM_xmlhttpRequest, undefined);

    async function reports() {
      const files = await readdir(reportsDir).catch(() => []);
      return Promise.all(files.filter((file) => file.endsWith('.txt')).map((file) => readFile(path.join(reportsDir, file), 'utf8')));
    }
    async function control(type) {
      const response = await fetch(`${server.url}/command`, {
        method: 'POST', headers: { 'X-DigDig-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      assert.equal(response.status, 202);
      return response.json();
    }

    await until(async () => (await reports()).some((text) => text.includes('"byteLength": 65536') && text.includes('"source": "instantiate"')), 'early captured instance in report');
    const diagnostic = (await reports()).find(text => text.includes('"byteLength": 65536'));
    assert.equal(JSON.parse(diagnostic).report.appVersion, workspaceVersion,
      'saved diagnostic reports identify the root package version');
    await until(async () => {
      const response = await fetch(`${server.url}/clients`, { headers: { 'X-DigDig-Token': token } });
      return (await response.json()).clients.length === 1;
    }, 'client registration');

    await until(() => scheduledDelays.includes(100), 'default 100ms map cadence');
    const telemetry = await (await fetch(`${server.url}/telemetry`, {
      headers: { 'X-DigDig-Token': token },
    })).json();
    assert.equal(telemetry.clients[0].frame.appVersion, workspaceVersion,
      'the development bridge retains the userscript version in live frames');
    const unchangedRuntimeSource = await readFile(path.join(distDir, 'runtime.js'), 'utf8');
    const settingsResponse = await fetch(`${server.url}/settings`, {
      method: 'POST', headers: { 'X-DigDig-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateIntervalMs: 20 }),
    });
    assert.equal(settingsResponse.status, 200);
    assert.deepEqual(await settingsResponse.json(), {
      updateIntervalMs: 20, showNotifications: false, autoReconnect: true, alwaysOnTop: false, windowOpacity: 1,
    });
    const settingsBundle = await (await fetch(`${server.url}/bundle`, {
      headers: { 'X-DigDig-Token': token },
    })).json();
    const delayCursor = scheduledDelays.length;
    await until(() => logs.some(entry => entry.includes(`Loaded runtime ${settingsBundle.revision.slice(0, 12)}`))
      && scheduledDelays.slice(delayCursor).includes(20), 'installed bootstrap applies the 20ms setting through runtime replacement');
    assert.equal(reloads, 0, 'applying update-rate settings must not reload the page');
    assert.equal(await readFile(path.join(distDir, 'dev.user.js'), 'utf8'), installedLoader, 'the installed loader remains unchanged');
    assert.equal(await readFile(path.join(distDir, 'runtime.js'), 'utf8'), unchangedRuntimeSource,
      'settings travel in the bundle prefix rather than requiring source edits or recompilation');

    for (const preferences of [
      { showNotifications: true, autoReconnect: false, alwaysOnTop: true, windowOpacity: 0.2 },
      { showNotifications: false, autoReconnect: true, alwaysOnTop: false, windowOpacity: 1 },
    ]) {
      const response = await fetch(`${server.url}/settings`, {
        method: 'POST', headers: { 'X-DigDig-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { updateIntervalMs: 20, ...preferences },
        'partial viewer preferences preserve the userscript capture interval');
      const bundle = await (await fetch(`${server.url}/bundle`, {
        headers: { 'X-DigDig-Token': token },
      })).json();
      assert.deepEqual(bundle, settingsBundle, 'viewer preferences must not replace the installed userscript runtime');
    }

    result.instance.exports.memory.grow(1);
    await control('report');
    await until(async () => (await reports()).some((text) => text.includes('"byteLength": 131072')), 'fresh memory view after grow');

    const runtimeFile = path.join(distDir, 'runtime.js');
    const source = await readFile(runtimeFile, 'utf8');
    assert.ok(source.includes('Diagnostics active.'));
    const replacementVersion = '9.8.7-hot-runtime';
    const replacementSource = source.replace('Diagnostics active.', 'Updated diagnostics active.')
      .replaceAll(JSON.stringify(workspaceVersion), JSON.stringify(replacementVersion));
    await writeFile(runtimeFile, replacementSource);
    await until(() => logs.some((entry) => entry.includes('Updated diagnostics active.')), 'runtime replacement');
    await until(async () => (await reports()).some(text => text.includes(`"appVersion": "${replacementVersion}"`)),
      'the active runtime version supersedes the installed bootstrap version');
    assert.equal(reloads, 0, 'runtime replacement must preserve the running page');
    assert.equal(menus.size, 3);
    assert.ok(menus.has('DigDig: Help / troubleshooting'));

    // A broken edit must leave the previous runtime available, including when
    // the source is reverted exactly to its previous hash.
    await writeFile(runtimeFile, 'var DigDigRuntime = { activate() { throw new Error("intentional test failure"); } };');
    await until(() => logs.some((entry) => entry.includes('Runtime could not start')), 'failed replacement detected');
    const beforeFailureReport = (await reports()).length;
    await control('report');
    await until(async () => (await reports()).length > beforeFailureReport, 'previous runtime retained after failed replacement');
    await writeFile(runtimeFile, replacementSource);
    listeners.get('pagehide')?.({ persisted: true });

    await control('ping');
    await until(async () => (await reports()).some((text) => text.includes('pong')), 'command reply report');
    const bootstrapReports = (await reports()).map(text => JSON.parse(text))
      .filter(entry => ['pong', 'runtime-error'].includes(entry.kind));
    assert.ok(bootstrapReports.some(entry => entry.kind === 'runtime-error'));
    assert.ok(bootstrapReports.every(entry => entry.report.appVersion === workspaceVersion),
      'bootstrap command replies and runtime failures identify the installed loader');
    assert.ok(gmRequests.every((request) => request.headers['X-DigDig-Token'] === token));

    await control('reload');
    await until(() => reloads === 1, 'explicit page reload command');
    assert.equal(logs.filter((entry) => entry.includes('Runtime could not start')).length, 1, logs.join('\n'));
  } finally {
    listeners.get('pagehide')?.({ persisted: false });
    for (const timer of timers) clearTimeout(timer);
    for (const timer of intervals) clearInterval(timer);
    await server.close();
    assert.ok(path.resolve(temp).startsWith(path.join(path.resolve(tmpdir()), 'digdig-loop-')));
    await rm(temp, { recursive: true, force: true });
  }
});
