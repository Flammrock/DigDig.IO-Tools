import assert from 'node:assert/strict';
import test from 'node:test';
import { startMapStream } from '../src/map-stream.ts';
import { gameLayouts } from '../src/game-layouts.ts';
import { syntheticMemory } from './helpers/layout-fixture.mjs';

function harness(t, { fixture = true, instances = [], report, raf = false, requestLayout } = {}) {
  let clock = 1000;
  let nextTimer = 0;
  const timers = new Map();
  const animationFrames = new Map();
  const observers = new Set();
  const reports = [];
  const diagnostics = [];
  const logs = [];
  const reads = [];
  const state = {
    world: { centerX: 0, centerY: 0, radius: 9000 },
    player: { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
    camera: { x: 0, y: 0, scale: 1, width: 1920, height: 1080 },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  class ScratchCanvas {
    constructor(width, height) {
      this.width = width; this.height = height;
      const pixels = new Uint8ClampedArray(width * height * 4);
      this.context = {
        canvas: this, globalAlpha: 1, globalCompositeOperation: 'source-over',
        clearRect() { pixels.fill(0); },
        getImageData() { return { data: pixels.slice() }; },
        drawImage(source) {
          const input = source.getContext('2d').getImageData(0, 0, width, height).data;
          for (let i = 0; i < pixels.length; i += 4) {
            const sourceAlpha = input[i + 3] / 255 * this.globalAlpha;
            const destAlpha = pixels[i + 3] / 255;
            const alpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
            for (let channel = 0; channel < 3; channel++) pixels[i + channel] = alpha === 0 ? 0
              : Math.round((input[i + channel] * sourceAlpha + pixels[i + channel] * destAlpha * (1 - sourceAlpha)) / alpha);
            pixels[i + 3] = Math.round(alpha * 255);
          }
        },
      };
    }
    getContext() { return this.context; }
  }
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: ScratchCanvas });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: clock + delay }); return id; },
    ...(raf ? {
      requestAnimationFrame(callback) { const id = ++nextTimer; animationFrames.set(id, callback); return id; },
      cancelAnimationFrame(id) { animationFrames.delete(id); },
    } : {}),
  } });
  t.after(() => previousWindow ? Object.defineProperty(globalThis, 'window', previousWindow) : delete globalThis.window);
  t.after(() => previousCanvas ? Object.defineProperty(globalThis, 'OffscreenCanvas', previousCanvas) : delete globalThis.OffscreenCanvas);
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  t.mock.method(Date, 'now', () => clock);
  const api = {
    page: { location: { origin: fixture ? 'http://127.0.0.1:4317' : 'https://digdig.io', pathname: fixture ? '/fixture' : '/' },
      document: { getElementById: () => ({ textContent: JSON.stringify(state) }) } },
    capture: { instances }, clientId: 'map-stream-test', requestLayout, log: (message) => logs.push(message),
    observeDrawImage(observer) { observers.add(observer); return () => observers.delete(observer); },
    async report(kind, frame) { (kind === 'map-frame' ? reports : diagnostics).push({ kind, frame, sentAt: clock }); if (kind === 'map-frame') await report?.(kind, frame); },
  };
  const pixels = new Uint8ClampedArray(64 * 64 * 4).fill(255);
  const source = { width: 64, height: 64, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
  const context = { canvas: { width: 1920, height: 1080 }, globalAlpha: 1, globalCompositeOperation: 'source-over',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 960, f: 540 }) };
  return { api, reports, diagnostics, timers, observers, pixels, logs, animationFrames,
    advance(milliseconds) { clock += milliseconds; },
    animationFrame() {
      const callbacks = [...animationFrames.values()];
      animationFrames.clear(); clock += 16;
      for (const callback of callbacks) callback(clock);
    },
    reads,
    draw({ alpha = 1, data = pixels, tile = 0, row = 0 } = {}) {
      context.globalAlpha = alpha;
      const input = { ...source, getContext: () => ({ getImageData: () => { reads.push(`${tile},${row}`); return { data }; } }) };
      for (const observe of observers) observe(context, [input, tile * 1024 - 1, row * 1024 - 1, 1026, 1026]);
    },
    async tick() {
      const before = reports.length;
      for (let attempt = 0; attempt < 10 && reports.length === before; attempt++) {
        assert.ok(timers.size, 'a scheduled timer is required');
        const [id, { callback, at }] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        timers.delete(id); clock = at; callback();
        await new Promise(setImmediate);
      }
      assert.ok(reports.length > before, 'the stream must eventually send a frame');
    },
  };
}

test('streams nearby tiles once, resends changed pixels, and removes its timers and observers', async (t) => {
  const h = harness(t);
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  await h.tick();
  h.draw(); h.draw();
  await h.tick();
  const delivered = h.reports.at(-1).frame;
  assert.equal(delivered.source, 'fixture');
  assert.equal(delivered.tiles.length, 1);
  assert.equal(delivered.tiles[0].key, '0,0');
  assert.deepEqual(Buffer.from(delivered.tiles[0].rgba, 'base64'), Buffer.from(h.pixels));
  h.draw();
  await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 0, 'unchanged pixels should be deduplicated');
  h.pixels[0] = 0;
  h.draw();
  await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1);
  stop(); stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.observers.size, 0);
});

for (const updateIntervalMs of [20, 100, 250, 500, 1000]) {
  test(`uses the selected ${updateIntervalMs}ms cadence including request time`, async (t) => {
    const h = harness(t, { report() { h.advance(Math.min(35, updateIntervalMs / 2)); } });
    const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs });
    t.after(stop);
    await h.tick(); h.draw(); await h.tick(); h.draw(); await h.tick();
    assert.equal(h.reports[1].sentAt - h.reports[0].sentAt, updateIntervalMs);
    assert.equal(h.reports[2].sentAt - h.reports[1].sentAt, updateIntervalMs);
  });
}

test('20ms mode waits for slow requests and still completes animation-bracketed terrain captures', async (t) => {
  const h = harness(t, { raf: true, report() { h.advance(35); } });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs: 20 });
  try {
    await h.tick();
    await h.tick();
    assert.equal(h.reports[1].sentAt - h.reports[0].sentAt, 35);
    assert.equal(h.animationFrames.size, 1, 'a faster poll must not replace the pending capture callback');
    h.animationFrame();
    h.draw();
    h.animationFrame();
    await h.tick();
    assert.equal(h.reports.at(-1).frame.tiles.length, 1);
  } finally { stop(); }
});

test('invalid capture intervals fall back to 100ms instead of creating a busy loop', async (t) => {
  const h = harness(t);
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs: 0 });
  t.after(stop);
  await h.tick(); await h.tick();
  assert.equal(h.reports[1].sentAt - h.reports[0].sentAt, 100);
});

test('unknown binary hashes stay unsupported without reading guessed game memory', async (t) => {
  const h = harness(t, { fixture: false, instances: [{ sha256: 'f'.repeat(64), memories: [{ name: 'Mf', memory: { buffer: { byteLength: 16 * 1024 * 1024 } } }] }] });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  await h.tick();
  assert.equal(h.reports[0].frame.status, 'unsupported');
  assert.equal(h.reports[0].frame.buildHash, 'f'.repeat(64));
  assert.equal(h.reports[0].frame.world, undefined);
  assert.deepEqual(h.reports[0].frame.tiles, []);
  stop();
});

test('pending reports apply backpressure and disposal during a send cannot restart the old runtime', async (t) => {
  let resolveSend;
  const pending = new Promise((resolve) => { resolveSend = resolve; });
  const h = harness(t, { report: () => pending });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  await h.tick();
  assert.equal(h.reports.length, 1);
  assert.equal(h.timers.size, 0, 'no polling queue may grow while a network request is pending');
  stop();
  resolveSend();
  await new Promise(setImmediate);
  assert.equal(h.timers.size, 0);
  assert.equal(h.observers.size, 0);
});

test('runtime replacement keeps the new terrain subscription when the old runtime disposes', async (t) => {
  const h = harness(t);
  const stopPrevious = startMapStream(h.api, 'http://127.0.0.1:4317');
  const stopCurrent = startMapStream(h.api, 'http://127.0.0.1:4317');
  assert.equal(h.observers.size, 2);
  stopPrevious();
  assert.equal(h.observers.size, 1);
  assert.equal(h.timers.size, 1);
  await h.tick(); h.draw(); await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1);
  stopCurrent();
});

function solidPixelData(red, green, blue, alpha = 255) {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([red, green, blue, alpha], i);
  return pixels;
}

test('composites same-tile layers in order and clears recycled surfaces between render intervals', async (t) => {
  const h = harness(t);
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  const red = solidPixelData(255, 0, 0);
  const blue = solidPixelData(0, 0, 255);
  const originalRed = red.slice();
  const originalBlue = blue.slice();
  await h.tick();
  h.draw({ data: red });
  h.draw({ data: blue, alpha: 0.5 });
  await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1);
  assert.deepEqual([...Buffer.from(h.reports.at(-1).frame.tiles[0].rgba, 'base64').subarray(0, 4)], [128, 0, 128, 255]);
  h.draw({ data: blue, alpha: 0.5 });
  await h.tick();
  assert.deepEqual([...Buffer.from(h.reports.at(-1).frame.tiles[0].rgba, 'base64').subarray(0, 4)], [0, 0, 255, 128],
    'the previous interval must not bleed into this tile');
  assert.deepEqual(red, originalRed);
  assert.deepEqual(blue, originalBlue);
  stop();
});

test('animation callbacks bracket capture and disposal cancels the next scheduled frame', async (t) => {
  const h = harness(t, { raf: true });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  await h.tick();
  assert.equal(h.animationFrames.size, 1);
  h.draw({ data: solidPixelData(255, 0, 0) }); // Before beginFrame: excluded.
  h.animationFrame();
  h.draw({ data: solidPixelData(0, 255, 0), alpha: 0.5 });
  h.animationFrame();
  h.draw({ data: solidPixelData(0, 0, 255) }); // After finishFrame: excluded.
  await h.tick();
  assert.deepEqual([...Buffer.from(h.reports.at(-1).frame.tiles[0].rgba, 'base64').subarray(0, 4)], [0, 255, 0, 128]);
  assert.equal(h.animationFrames.size, 1);
  stop();
  assert.equal(h.animationFrames.size, 0);
  assert.equal(h.timers.size, 0);
});

test('a failed transmission makes unchanged visible terrain eligible for immediate retry', async (t) => {
  let sends = 0;
  const h = harness(t, { report() { if (++sends === 2) throw new Error('temporary disconnect'); } });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  await h.tick(); h.draw(); await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1);
  assert.ok(h.logs.some((line) => line.includes('temporary disconnect')));
  h.draw(); await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1);
  stop();
});

function syntheticGameInstance() {
  // Independently authored runtime data, not an instantiated or altered game module.
  const layout = gameLayouts[0];
  const memory = new WebAssembly.Memory({ initial: 256 });
  const view = new DataView(memory.buffer);
  const owner = 1024 * 1024;
  const camera = owner + layout.cameraOffset;
  view.setUint32(layout.cameraPointer, owner, true);
  view.setUint32(camera, layout.cameraVtable, true);
  view.setFloat32(layout.mapX, 0, true);
  view.setFloat32(layout.mapY, 0, true);
  view.setFloat32(layout.mapRadius, 9000, true);
  view.setFloat32(camera + layout.cameraX, 0, true);
  view.setFloat32(camera + layout.cameraY, 0, true);
  view.setFloat32(camera + layout.cameraScale, 1, true);
  view.setInt32(camera + layout.viewWidth, 1920, true);
  view.setInt32(camera + layout.viewHeight, 1080, true);
  return { sha256: layout.sha256, memories: [{ name: layout.memoryExport, memory }] };
}

test('game scanning classifies raw material pixels before fog or draw alpha and leaves source images unchanged', async (t) => {
  const h = harness(t, { fixture: false, instances: [syntheticGameInstance()] });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  t.after(stop);
  const material = solidPixelData(49, 49, 49);
  material.set([115, 65, 0, 255], 0); // Dithered dirt.
  material.set([214, 214, 214, 255], 4); // Dithered quartz.
  material.set([34, 34, 34, 255], 8); // Empty background is not bedrock.
  material.set([16, 16, 16, 255], 12); // Current bedrock is near 17 gray.
  material.set([168, 161, 22, 254], 16); // Partially transparent source pixels are unknown.
  material.set([0, 0, 0, 255], 20); // Archived black is not current bedrock.
  const fog = solidPixelData(49, 49, 49);
  const originalMaterial = material.slice();
  const originalFog = fog.slice();
  await h.tick();
  h.draw({ data: material, alpha: 0.5 });
  h.draw({ data: fog });
  await h.tick();
  const frame = h.reports.at(-1).frame;
  assert.equal(frame.source, 'game');
  assert.equal(frame.status, 'live');
  assert.equal(frame.terrainMode, 'materials-v1');
  assert.equal(frame.tiles.length, 1);
  const pixels = Buffer.from(frame.tiles[0].rgba, 'base64');
  assert.deepEqual([...pixels.subarray(0, 24)], [
    120, 68, 0, 255,
    221, 221, 221, 255,
    0, 0, 0, 0,
    17, 17, 17, 255,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  assert.ok(pixels.subarray(24).every((byte) => byte === 0), 'fog is transparent in the outgoing tile');
  assert.deepEqual(material, originalMaterial);
  assert.deepEqual(fog, originalFog);
});

test('unknown-only game tiles are omitted and later fog cannot send an erasing tile', async (t) => {
  const h = harness(t, { fixture: false, instances: [syntheticGameInstance()] });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317');
  t.after(stop);
  await h.tick();
  h.draw({ data: solidPixelData(49, 49, 49) });
  await h.tick();
  assert.equal(h.reports.at(-1).frame.terrainMode, 'materials-v1');
  assert.deepEqual(h.reports.at(-1).frame.tiles, []);

  h.draw({ data: solidPixelData(120, 68, 0) });
  await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1);

  h.draw({ data: solidPixelData(34, 34, 34) });
  await h.tick();
  assert.deepEqual(h.reports.at(-1).frame.tiles, [], 'unknown pixels must not erase prior discoveries');
});

test('large views spread readbacks across frames and eventually scan every tile despite changing draw order', async (t) => {
  const instance = syntheticGameInstance();
  const originalMemory = new Uint8Array(instance.memories[0].memory.buffer).slice();
  const h = harness(t, { fixture: false, instances: [instance] });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs: 20 });
  t.after(stop);
  const material = solidPixelData(120, 68, 0), fog = solidPixelData(49, 49, 49);
  const tiles = [];
  for (let row = -3; row <= 2; row++) for (let tile = -3; tile <= 2; tile++) {
    if ((tile + .5) ** 2 + (row + .5) ** 2 <= 9) tiles.push({ tile, row });
  }
  assert.equal(tiles.length, 32);
  const delivered = new Set();
  await h.tick();
  for (let frame = 0; frame < 6; frame++) {
    const start = h.reads.length;
    for (const position of frame % 2 ? [...tiles].reverse() : tiles) {
      h.draw({ ...position, data: material }); h.draw({ ...position, data: fog });
    }
    assert.ok(h.reads.length - start <= 12, 'only six tiles, with both layers, may cause pixel readbacks');
    const sampled = new Map();
    for (const key of h.reads.slice(start)) sampled.set(key, (sampled.get(key) ?? 0) + 1);
    assert.ok([...sampled.values()].every(count => count === 2), 'every layer of each selected tile must be included');
    await h.tick();
    for (const tile of h.reports.at(-1).frame.tiles) delivered.add(tile.key);
  }
  assert.deepEqual(delivered, new Set(tiles.map(({ tile, row }) => `${tile},${row}`)), 'render order must not starve terrain');
  assert.deepEqual(new Uint8Array(instance.memories[0].memory.buffer), originalMemory, 'scanning never writes game memory');
});

test('partially obscured observations deduplicate without replaying stale hidden pixels into the shared map', async (t) => {
  const h = harness(t, { fixture: false, instances: [syntheticGameInstance()] });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs: 1000 }); t.after(stop);
  const first = solidPixelData(49, 49, 49), second = first.slice();
  first.set([120, 68, 0, 255], 0); second.set([221, 221, 221, 255], 4);
  const beforeFirst = first.slice(), beforeSecond = second.slice();
  await h.tick(); h.draw({ data: first }); await h.tick();
  h.draw({ data: second }); await h.tick();
  assert.deepEqual([...Buffer.from(h.reports.at(-1).frame.tiles[0].rgba, 'base64').subarray(0, 8)],
    [0, 0, 0, 0, 221, 221, 221, 255], 'hidden dirt may have changed in another session and must not be replayed');
  h.draw({ data: first }); await h.tick();
  assert.deepEqual(h.reports.at(-1).frame.tiles, [], 'revealing only already known pixels should not generate another payload');
  second.set([50, 168, 160, 255], 4);
  h.draw({ data: second }); await h.tick();
  assert.deepEqual([...Buffer.from(h.reports.at(-1).frame.tiles[0].rgba, 'base64').subarray(4, 8)], [50, 168, 160, 255],
    'a changed material still replaces its previous observation');
  for (let frame = 0; frame < 5; frame++) { h.draw({ data: second }); await h.tick(); }
  assert.deepEqual([...Buffer.from(h.reports.at(-1).frame.tiles[0].rgba, 'base64').subarray(0, 8)],
    [0, 0, 0, 0, 50, 168, 160, 255], 'periodic refresh also sends only currently observed pixels');
  assert.deepEqual(first, beforeFirst);
  assert.deepEqual(second.subarray(8), beforeSecond.subarray(8));
});

test('slower capture presets retain the existing twenty-four-tile budget', async (t) => {
  const h = harness(t, { fixture: false, instances: [syntheticGameInstance()] });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs: 1000 }); t.after(stop);
  const material = solidPixelData(120, 68, 0);
  await h.tick();
  for (let row = -3; row <= 2; row++) for (let tile = -3; tile <= 2; tile++) h.draw({ row, tile, data: material });
  assert.equal(h.reads.length, 24);
  await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 24);
});

test('game material cache refreshes periodically and resends after a failed transmission', async (t) => {
  let fail = false;
  const h = harness(t, { fixture: false, instances: [syntheticGameInstance()], report() {
    if (fail) { fail = false; throw Error('offline'); }
  } });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317', { updateIntervalMs: 1000 }); t.after(stop);
  const material = solidPixelData(120, 68, 0);
  await h.tick(); h.draw({ data: material }); await h.tick();
  for (let frame = 0; frame < 4; frame++) {
    h.draw({ data: material }); await h.tick();
    assert.equal(h.reports.at(-1).frame.tiles.length, 0);
  }
  fail = true;
  h.draw({ data: material }); await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1, 'the five-second refresh is retained');
  h.draw({ data: material }); await h.tick();
  assert.equal(h.reports.at(-1).frame.tiles.length, 1, 'failed requests retry unchanged retained terrain');
});

test('unknown-build map frames withhold pixels and coordinates until independent render validation succeeds', async t => {
  const instance = syntheticMemory(), requests = [];
  const h = harness(t, { fixture: false, instances: [instance.entry], requestLayout: async (route, body) => {
    requests.push({ route, body });
    return route === '/layouts/validate' ? { cached: true } : {
      status: 'candidate', resolverVersion: 'wasm-patterns-1', ticket: 'stream-validation', origin: 'cache', layout: instance.layout
    };
  } });
  const stop = startMapStream(h.api, 'http://127.0.0.1:4317'); t.after(stop);
  const material = solidPixelData(120, 68, 0), before = material.slice();
  for (let frame = 0; frame < 4; frame++) {
    await h.tick(); h.draw({ data: material, tile: 0 }); h.draw({ data: material, tile: 1 });
    assert.equal(h.reports.at(-1).frame.status, 'waiting');
    assert.equal(h.reports.at(-1).frame.world, undefined);
    assert.deepEqual(h.reports.at(-1).frame.tiles, []);
  }
  // Lookup cadence is one second; advance enough to allow the validation ACK.
  for (let frame = 0; frame < 16 && h.reports.at(-1).frame.status !== 'live'; frame++) {
    await h.tick(); h.draw({ data: material, tile: 0 }); h.draw({ data: material, tile: 1 });
  }
  await h.tick(); h.draw({ data: material, tile: 0 }); await h.tick();
  assert.equal(h.reports.at(-1).frame.status, 'live');
  assert.ok(h.reports.some(({ frame }) => frame.tiles.length));
  assert.equal(requests.filter(request => request.route === '/layouts/validate').length, 1);
  assert.deepEqual(material, before);
});
