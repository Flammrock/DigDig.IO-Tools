import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { installCapture } from '../src/capture.ts';

const header = [0, 97, 115, 109, 1, 0, 0, 0];
const memoryExport = [7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0];
const exportedMemory = new Uint8Array([...header, 5, 4, 1, 1, 1, 2, ...memoryExport]);
const importedMemory = new Uint8Array([...header, 2, 16, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 1, 1, 2]);

function realm() {
  return vm.runInNewContext('globalThis', { Response });
}

async function eventually(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Asynchronous capture did not complete.');
}

test('captures bytes and precompiled modules while retaining native promises and exact arguments', async () => {
  const page = realm();
  const original = page.WebAssembly.instantiate;
  let lastPromise;
  let forwardedArgs;
  let forwardedThis;
  page.WebAssembly.instantiate = function (...args) {
    forwardedArgs = args;
    forwardedThis = this;
    lastPromise = Reflect.apply(original, this, args);
    return lastPromise;
  };
  const exported = [];
  const state = installCapture(page, (fn, target, key) => {
    exported.push(fn);
    if (target && key !== undefined) Object.defineProperty(target, key, { value: fn, writable: true, configurable: true });
    return fn;
  });
  const options = { builtins: [] };
  const receiver = {};
  const promise = page.WebAssembly.instantiate.call(receiver, exportedMemory, {}, options);
  assert.equal(promise, lastPromise);
  assert.equal(forwardedThis, receiver);
  assert.equal(forwardedArgs[2], options);
  const result = await promise;
  assert.equal(state.instances.length, 1);
  assert.equal(state.instances[0].instance, result.instance);
  assert.equal(state.instances[0].module, result.module);
  assert.equal(state.instances[0].memories[0].memory, result.instance.exports.memory);
  assert.equal(state.instances[0].memories[0].origin, 'export');
  assert.deepEqual(state.instances[0].exports, [{ name: 'memory', kind: 'memory' }]);
  await eventually(() => Boolean(state.instances[0].sha256));
  assert.equal(state.instances[0].sha256, createHash('sha256').update(exportedMemory).digest('hex'));
  assert.equal(state.instances[0].byteLength, exportedMemory.byteLength);

  const instance = await page.WebAssembly.instantiate(result.module);
  assert.equal(state.instances[1].instance, instance);
  assert.equal(state.instances[1].module, result.module);
  assert.equal(state.instances[1].sha256, state.instances[0].sha256);
  assert.equal(state.instances[1].bytes, state.instances[0].bytes, 'compiled module instances share the unchanged source copy');
  assert.ok(exported.length >= 7, 'wrappers, constructor trap, and Promise callbacks are exported');
  state.dispose();
});

test('streaming accepts Response and Promise<Response> without consuming the caller body', async () => {
  const page = realm();
  const state = installCapture(page);
  const makeResponse = () => new Response(exportedMemory, { headers: { 'Content-Type': 'application/wasm' } });
  for (const source of [makeResponse(), page.Promise.resolve(makeResponse())]) {
    const result = await page.WebAssembly.instantiateStreaming(source);
    assert.equal(state.instances.at(-1).instance, result.instance);
    assert.equal(state.instances.at(-1).source, 'instantiateStreaming');
  }
  await eventually(() => state.instances.every((entry) => entry.sha256));
  assert.ok(state.instances.every((entry) => entry.byteLength === exportedMemory.byteLength));
  assert.equal(state.errors.length, 0);
  state.dispose();
});

test('preserves rejected native promises and synchronous constructor errors', async () => {
  const page = realm();
  const sentinel = new Error('native rejection');
  const nativePromise = page.Promise.reject(sentinel);
  page.WebAssembly.instantiate = () => nativePromise;
  const state = installCapture(page);
  const result = page.WebAssembly.instantiate(new Uint8Array());
  assert.equal(result, nativePromise);
  await assert.rejects(result, (error) => error === sentinel);
  assert.throws(() => new page.WebAssembly.Instance({}), /Module/);
  await assert.rejects(page.WebAssembly.instantiateStreaming(new Response(exportedMemory)), /MIME|Content-Type/);
  assert.equal(state.instances.length, 0);
  state.dispose();
});

test('constructor preserves subclass/prototype behavior and discovers unexported imported memory', () => {
  const page = realm();
  const NativeInstance = page.WebAssembly.Instance;
  const state = installCapture(page);
  const module = new page.WebAssembly.Module(importedMemory);
  const memory = new page.WebAssembly.Memory({ initial: 1, maximum: 2 });
  class DerivedInstance extends page.WebAssembly.Instance {}
  const instance = new DerivedInstance(module, { env: { memory } });
  assert.ok(instance instanceof DerivedInstance);
  assert.ok(instance instanceof NativeInstance);
  assert.equal(page.WebAssembly.Instance.prototype, NativeInstance.prototype);
  assert.equal(state.instances[0].instance, instance);
  assert.deepEqual(state.instances[0].memories.map(({ name, origin }) => ({ name, origin })), [{ name: 'env.memory', origin: 'import' }]);
  assert.equal(state.instances[0].memories[0].memory, memory);
  state.dispose();
});

test('keeps live memories across growth and deduplicates an imported memory exported again', async () => {
  const page = realm();
  const state = installCapture(page);
  const memory = new page.WebAssembly.Memory({ initial: 1, maximum: 2 });
  const result = await page.WebAssembly.instantiate(new Uint8Array([...importedMemory, ...memoryExport]), { env: { memory } });
  const captured = state.instances[0];
  assert.equal(captured.instance, result.instance);
  assert.equal(captured.memories.length, 1);
  const previousBuffer = captured.memories[0].memory.buffer;
  memory.grow(1);
  assert.notEqual(captured.memories[0].memory.buffer, previousBuffer);
  assert.equal(captured.memories[0].memory.buffer.byteLength, 2 * 65536);
  state.dispose();
});

test('bounds retention, deduplicates instances and restores only its own hooks', async () => {
  const page = realm();
  const instantiate = page.WebAssembly.instantiate;
  const Instance = page.WebAssembly.Instance;
  const module = new page.WebAssembly.Module(exportedMemory);
  const sharedInstance = new Instance(module);
  page.WebAssembly.instantiate = () => page.Promise.resolve(sharedInstance);
  const first = installCapture(page);
  await page.WebAssembly.instantiate(module);
  await page.WebAssembly.instantiate(module);
  assert.equal(first.instances.length, 1);
  first.dispose();
  page.WebAssembly.instantiate = instantiate;

  const state = installCapture(page);
  for (let index = 0; index < 12; index++) new page.WebAssembly.Instance(module);
  assert.equal(state.instances.length, 8);
  assert.equal(state.instances[0].id, 5);
  const laterHook = () => page.Promise.resolve(sharedInstance);
  page.WebAssembly.instantiate = laterHook;
  state.dispose();
  state.dispose();
  assert.equal(page.WebAssembly.instantiate, laterHook);
  assert.equal(page.WebAssembly.Instance, Instance);
});

test('observer failures cannot reject a successful game result', async () => {
  const page = realm();
  const state = installCapture(page);
  const memory = new page.WebAssembly.Memory({ initial: 1, maximum: 2 });
  const imports = { env: { memory } };
  // WASM reads this once while instantiating; the later observer must tolerate it
  // becoming inaccessible without changing the fulfilled result.
  let reads = 0;
  Object.defineProperty(imports.env, 'memory', {
    get() {
      if (++reads > 1) throw new Error('observer access refused');
      return memory;
    },
  });
  const result = await page.WebAssembly.instantiate(importedMemory, imports);
  assert.ok(result.instance instanceof page.WebAssembly.Instance);
  assert.ok(state.errors.some((error) => error.includes('observer access refused')));
  state.dispose();
});

test('direct page export tolerates a different readback callable and restores original descriptors', async () => {
  const page = realm();
  const wasm = page.WebAssembly;
  const originalDescriptors = Object.fromEntries(['instantiate', 'instantiateStreaming', 'Instance', 'compile', 'compileStreaming', 'Module']
    .map((key) => [key, Object.getOwnPropertyDescriptor(wasm, key)]));
  const defined = [];
  const state = installCapture(page, (fn, target, key) => {
    const exportedCallable = function (...args) { return Reflect.apply(fn, this, args); };
    if (target && key !== undefined) {
      // Model a membrane that exposes a second callable identity on readback.
      const installedCallable = function (...args) { return Reflect.apply(exportedCallable, this, args); };
      Object.defineProperty(target, key, { value: installedCallable, configurable: true, writable: true, enumerable: true });
      assert.notEqual(target[key], exportedCallable);
      defined.push({ target, key });
    }
    return exportedCallable;
  });
  assert.deepEqual(defined.map(({ key }) => key), ['instantiate', 'instantiateStreaming', 'compile', 'compileStreaming']);
  assert.ok(defined.every(({ target }) => target === wasm));
  assert.equal(state.errors.length, 0);
  assert.equal(state.hooks.length, 6);
  const bytes = exportedMemory.slice();
  const before = bytes.slice();
  const result = await wasm.instantiate(bytes);
  assert.equal(state.instances[0].instance, result.instance);
  assert.deepEqual(bytes, before, 'capture must not modify source WASM bytes');
  state.dispose();
  for (const [key, descriptor] of Object.entries(originalDescriptors)) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(wasm, key), descriptor);
  }
});

test('rejects unchanged method readback instead of claiming an installed hook', () => {
  const page = realm();
  const original = page.WebAssembly;
  page.WebAssembly = new Proxy(original, {
    set(target, key, value) {
      if (key === 'instantiate') return true; // Simulate a membrane that ignores this assignment.
      return Reflect.set(target, key, value);
    }
  });
  const state = installCapture(page);
  assert.ok(!state.hooks.includes('WebAssembly.instantiate'));
  assert.ok(state.errors.some((error) => error.includes('Cannot replace WebAssembly.instantiate.')));
  state.dispose();
});

test('failed native compilation leaves the original byte buffer unchanged', async () => {
  const page = realm();
  const state = installCapture(page);
  // Independently authored invalid fixture, never bytes from the game.
  const bytes = new Uint8Array([...header, 255]);
  const before = bytes.slice();
  await assert.rejects(page.WebAssembly.instantiate(bytes), /WebAssembly|section|decode/);
  assert.deepEqual(bytes, before);
  assert.equal(state.instances.length, 0);
  state.dispose();
});

test('compile, compileStreaming, and Module constructor retain unchanged source copies for later instances', async () => {
  const page = realm();
  const nativeCompile = page.WebAssembly.compile;
  let nativePromise, nativeArgs;
  page.WebAssembly.compile = function (...args) {
    nativeArgs = args;
    nativePromise = Reflect.apply(nativeCompile, this, args);
    return nativePromise;
  };
  const state = installCapture(page);
  try {
    const backing = new Uint8Array(exportedMemory.length + 6);
    backing.set(exportedMemory, 3);
    const input = backing.subarray(3, backing.length - 3), before = backing.slice();
    const options = { builtins: [] };
    const result = page.WebAssembly.compile(input, options);
    assert.equal(result, nativePromise);
    assert.equal(nativeArgs[0], input); assert.equal(nativeArgs[1], options);
    const compiled = await result;
    const streamed = await page.WebAssembly.compileStreaming(new Response(input, { headers: { 'Content-Type': 'application/wasm' } }));
    class DerivedModule extends page.WebAssembly.Module {}
    const constructed = new DerivedModule(input);
    assert.ok(constructed instanceof DerivedModule);
    for (const module of [compiled, streamed, constructed]) new page.WebAssembly.Instance(module);
    await eventually(() => state.instances.length === 3 && state.instances.every(entry => entry.sha256));
    for (const entry of state.instances) {
      assert.equal(entry.sha256, createHash('sha256').update(exportedMemory).digest('hex'));
      assert.deepEqual(entry.bytes, exportedMemory);
      assert.notEqual(entry.bytes.buffer, input.buffer);
    }
    assert.deepEqual(backing, before);
  } finally { state.dispose(); }
});

test('source-copy retention is bounded independently of live compiled modules', async () => {
  const page = realm();
  const state = installCapture(page);
  try {
    const modules = Array.from({ length: 12 }, () => new page.WebAssembly.Module(exportedMemory));
    for (const module of modules) new page.WebAssembly.Instance(module);
    await eventually(() => state.instances.every(entry => entry.sha256));
    assert.equal(state.instances.length, 8);
    assert.ok(state.instances.every(entry => entry.bytes));
    new page.WebAssembly.Instance(modules[0]);
    const old = state.instances.at(-1);
    assert.equal(old.sha256, createHash('sha256').update(exportedMemory).digest('hex'));
    assert.equal(old.bytes, undefined, 'old module identity is remembered without retaining its source bytes forever');
    const recent = modules.at(-1);
    for (let i = 0; i < 30; i++) new page.WebAssembly.Instance(recent);
    assert.equal(state.instances.length, 8);
    assert.ok(state.instances.every(entry => entry.bytes === state.instances[0].bytes));
  } finally { state.dispose(); }
});

test('compile errors and observation failures preserve original native errors', async () => {
  const page = realm();
  const failure = new Error('native compile sentinel');
  const nativePromise = page.Promise.reject(failure);
  page.WebAssembly.compile = () => nativePromise;
  const state = installCapture(page);
  try {
    const bytes = exportedMemory.slice();
    const result = page.WebAssembly.compile(bytes);
    assert.equal(result, nativePromise);
    await assert.rejects(result, error => error === failure);
    assert.deepEqual(bytes, exportedMemory);
    assert.throws(() => new page.WebAssembly.Module(new Uint8Array([1, 2, 3])), /WebAssembly|buffer|magic/);
    assert.equal(state.instances.length, 0);
  } finally { state.dispose(); }
});

function xrayExporter() {
  const views = new WeakMap();
  function filtered(value) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (views.has(value)) return views.get(value);
    // Model Firefox's opaque view: fields and indexed elements disappear,
    // while wrappedJSObject exposes the exact original page object.
    const view = new Proxy(Object.create(null), {
      get(_target, key) { return key === 'wrappedJSObject' ? value : undefined; },
      ownKeys() { return []; },
    });
    views.set(value, view);
    return view;
  }
  function exporter(fn, target, key) {
    const callable = function (...args) { return Reflect.apply(fn, filtered(this), args.map(filtered)); };
    if (target && key !== undefined) Object.defineProperty(target, key, { value: callable, writable: true, configurable: true });
    return callable;
  }
  return { filtered, exporter };
}

test('Firefox-filtered compile and Module paths retain native module identity and unchanged inputs', async () => {
  const page = realm();
  const { exporter } = xrayExporter();
  const state = installCapture(page, exporter);
  const input = exportedMemory.slice(), before = input.slice();
  try {
    const modules = [await page.WebAssembly.compile(input),
      await page.WebAssembly.compileStreaming(page.Promise.resolve(new Response(input, { headers: { 'Content-Type': 'application/wasm' } }))),
      new page.WebAssembly.Module(input)];
    for (const module of modules) {
      const instance = new page.WebAssembly.Instance(module);
      assert.equal(state.instances.at(-1).module, module);
      assert.equal(state.instances.at(-1).instance, instance);
    }
    await eventually(() => state.instances.every(entry => entry.sha256));
    for (const entry of state.instances) assert.deepEqual(entry.bytes, before);
    assert.deepEqual(input, before);
    assert.deepEqual(state.errors, []);
  } finally { state.dispose(); }
});

test('Firefox-filtered results and arguments resolve to the original WASM objects without changing bytes', async () => {
  const page = realm();
  const { filtered, exporter } = xrayExporter();
  const nativeInstantiate = page.WebAssembly.instantiate;
  let nativeArgs;
  let nativePromise;
  let nativeThis;
  page.WebAssembly.instantiate = function (...args) {
    nativeArgs = args;
    nativeThis = this;
    nativePromise = Reflect.apply(nativeInstantiate, this, args);
    return nativePromise;
  };
  const state = installCapture(page, exporter);
  const bytes = exportedMemory.slice();
  const before = bytes.slice();
  const imports = {};
  const options = { builtins: [] };
  const receiver = {};
  const promise = page.WebAssembly.instantiate.call(receiver, bytes, imports, options);
  assert.equal(promise, nativePromise, 'the native Promise must not be replaced');
  assert.equal(nativeArgs[0], bytes);
  assert.equal(nativeArgs[1], imports);
  assert.equal(nativeArgs[2], options);
  assert.equal(nativeThis, receiver);
  const result = await promise;
  assert.deepEqual(Object.getOwnPropertyNames(filtered(result)), []);
  assert.equal(filtered(result).instance, undefined);
  assert.equal(state.instances.length, 1);
  assert.equal(state.instances[0].instance, result.instance);
  assert.equal(state.instances[0].module, result.module);
  assert.equal(state.instances[0].memories[0].memory, result.instance.exports.memory);
  await eventually(() => Boolean(state.instances[0].sha256));
  assert.equal(state.instances[0].sha256, createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(bytes, before);
  const invalidBytes = new Uint8Array([...header, 255]);
  const invalidBefore = invalidBytes.slice();
  const rejected = page.WebAssembly.instantiate(invalidBytes);
  assert.equal(rejected, nativePromise);
  assert.equal(nativeArgs[0], invalidBytes);
  await assert.rejects(rejected, /WebAssembly|section|decode/);
  assert.deepEqual(invalidBytes, invalidBefore);
  assert.equal(state.errors.length, 0);
  state.dispose();
});

test('Firefox-filtered constructor argument arrays retain the original module, imports, and subclass', () => {
  const page = realm();
  const { filtered, exporter } = xrayExporter();
  const NativeInstance = page.WebAssembly.Instance;
  let constructorArgs;
  let constructorNewTarget;
  page.WebAssembly.Instance = new Proxy(NativeInstance, {
    construct(target, args, newTarget) {
      constructorArgs = args;
      constructorNewTarget = newTarget;
      return Reflect.construct(target, args, newTarget);
    }
  });
  const state = installCapture(page, exporter);
  const bytes = importedMemory.slice();
  const before = bytes.slice();
  const module = new page.WebAssembly.Module(bytes);
  const memory = new page.WebAssembly.Memory({ initial: 1, maximum: 2 });
  const imports = { env: { memory } };
  assert.equal(filtered([module, imports])[0], undefined);
  class DerivedInstance extends page.WebAssembly.Instance {}
  const instance = new DerivedInstance(module, imports);
  assert.equal(constructorArgs[0], module);
  assert.equal(constructorArgs[1], imports);
  assert.equal(constructorNewTarget, DerivedInstance);
  assert.ok(instance instanceof DerivedInstance);
  assert.ok(instance instanceof NativeInstance);
  assert.equal(state.instances[0].instance, instance);
  assert.equal(state.instances[0].module, module);
  assert.equal(state.instances[0].memories[0].memory, memory);
  assert.deepEqual(bytes, before);
  assert.equal(state.errors.length, 0);
  state.dispose();
});
