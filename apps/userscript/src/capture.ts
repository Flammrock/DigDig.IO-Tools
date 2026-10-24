export interface CapturedWasm {
  id: number;
  source: string;
  capturedAt: string;
  instance: WebAssembly.Instance;
  module?: WebAssembly.Module;
  memories: Array<{ name: string; origin: 'export' | 'import'; memory: WebAssembly.Memory }>;
  exports: Array<{ name: string; kind: string }>;
  sha256?: string;
  byteLength?: number;
  /** Unchanged private source bytes for local read-only layout analysis. */
  bytes?: Uint8Array;
}

export interface CaptureState {
  installedAt: string;
  hooks: string[];
  errors: string[];
  instances: CapturedWasm[];
  dispose(): void;
}

type PageExporter = (fn: Function, target?: object, key?: string) => Function;
type BinaryMetadata = { sha256?: string; byteLength?: number; bytes?: Uint8Array };
type BinaryProbe = { metadata: BinaryMetadata; targets: CapturedWasm[] };

const LIMIT = 8;
const MAX_ANALYSIS_BYTES = 8 * 1024 * 1024;

/**
 * Install before the game starts. The live Memory objects are retained; readers
 * must create their views from memory.buffer, which can change after growth.
 *
 * Firefox's JavaScript sandbox must pass exportFunction as exportToPage. Page
 * methods and Promise callbacks are exported, and original native Promises are
 * returned unchanged. Diagnostics never replace successful game results.
 */
export function installCapture(
  realm: Window & typeof globalThis,
  exportToPage?: PageExporter,
): CaptureState {
  const state: CaptureState = {
    installedAt: new Date().toISOString(),
    hooks: [],
    errors: [],
    instances: [],
    dispose,
  };
  const restore: Array<() => void> = [];
  const known = new WeakMap<object, CapturedWasm>();
  const moduleProbes = new WeakMap<object, BinaryProbe>();
  const retainedBytes = new Set<BinaryProbe>();
  let nextId = 1;
  let disposed = false;

  function recordError(context: string, error: unknown): void {
    try {
      const detail = error instanceof Error ? error.message : String(error);
      state.errors.push(`${context}: ${detail}`.slice(0, 500));
      if (state.errors.length > LIMIT) state.errors.splice(0, state.errors.length - LIMIT);
    } catch {
      // Even error formatting is only observational.
    }
  }

  function exported<T extends Function>(fn: T): T {
    return (exportToPage ? exportToPage(fn) : fn) as T;
  }

  /** Firefox exports pass Xray views, which can hide WASM objects and fields.
   * Waive that view without cloning or changing the underlying page value.
   */
  function unwrapped<T>(value: T): T {
    if (!exportToPage || value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    try {
      return (value as T & { wrappedJSObject?: T }).wrappedJSObject ?? value;
    } catch {
      return value;
    }
  }

  /** The child Promise is always fulfilled, even if an observer throws. */
  function observePromise(
    promise: unknown,
    onValue: (value: unknown) => void,
    context: string,
    onFailure?: (error: unknown) => void,
  ): void {
    try {
      const observedPromise = unwrapped(promise);
      const then = (observedPromise as Promise<unknown>).then;
      Reflect.apply(then, observedPromise, [
        exported(function (value: unknown): void {
          try {
            if (!disposed) onValue(unwrapped(value));
          } catch (error) {
            recordError(context, error);
          }
        }),
        exported(function (error: unknown): void {
          try {
            onFailure?.(error);
          } catch (observerError) {
            recordError(context, observerError);
          }
        }),
      ]);
    } catch (error) {
      recordError(context, error);
    }
  }

  function probeBytes(value: unknown, probe: BinaryProbe): void {
    try {
      value = unwrapped(value);
      let input: Uint8Array;
      if (ArrayBuffer.isView(value)) {
        input = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
        input = new Uint8Array(value as ArrayBuffer);
      } else {
        return; // A precompiled Module has no recoverable byte buffer.
      }
      probe.metadata.byteLength = input.byteLength;
      for (const target of probe.targets) target.byteLength = input.byteLength;
      if (input.byteLength > 64 * 1024 * 1024) {
        recordError('fingerprint', 'Skipping a WASM binary larger than 64 MiB.');
        return;
      }
      const copy = new Uint8Array(input.byteLength);
      copy.set(input);
      if (copy.byteLength <= MAX_ANALYSIS_BYTES) {
        probe.metadata.bytes = copy;
        for (const target of probe.targets) target.bytes = copy;
        retainedBytes.add(probe);
        if (retainedBytes.size > LIMIT) {
          const oldest = retainedBytes.values().next().value!;
          retainedBytes.delete(oldest);
          delete oldest.metadata.bytes;
          for (const target of oldest.targets) delete target.bytes;
        }
      }
      const cryptoApi = globalThis.crypto ?? realm.crypto;
      if (!cryptoApi?.subtle) return;
      observePromise(cryptoApi.subtle.digest('SHA-256', copy), (digest) => {
        const hash = Array.from(new Uint8Array(digest as ArrayBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
        probe.metadata.sha256 = hash;
        for (const target of probe.targets) target.sha256 = hash;
      }, 'fingerprint', (error) => recordError('fingerprint', error));
    } catch (error) {
      recordError('fingerprint', error);
    }
  }

  function probeStreaming(value: unknown, probe: BinaryProbe): void {
    const read = (response: unknown): void => {
      try {
        const clone = (unwrapped(response) as Response).clone();
        observePromise(clone.arrayBuffer(), (bytes) => probeBytes(bytes, probe), 'stream fingerprint',
          (error) => recordError('stream fingerprint', error));
      } catch (error) {
        recordError('stream fingerprint', error);
      }
    };
    try {
      value = unwrapped(value);
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        // Register before instantiateStreaming so cloning can precede body use.
        observePromise(value, read, 'stream response');
      } else {
        read(value);
      }
    } catch (error) {
      recordError('stream fingerprint', error);
    }
  }

  let wasm: typeof WebAssembly;
  let originalInstance: typeof WebAssembly.Instance;
  let exportsGetter: ((this: WebAssembly.Instance) => WebAssembly.Exports) | undefined;
  let memoryBufferGetter: ((this: WebAssembly.Memory) => ArrayBuffer) | undefined;
  try {
    wasm = realm.WebAssembly;
    originalInstance = wasm.Instance;
    exportsGetter = Object.getOwnPropertyDescriptor(originalInstance.prototype, 'exports')?.get;
    memoryBufferGetter = Object.getOwnPropertyDescriptor(wasm.Memory.prototype, 'buffer')?.get;
  } catch (error) {
    recordError('WebAssembly access', error);
    return state;
  }

  function isMemory(value: unknown): value is WebAssembly.Memory {
    value = unwrapped(value);
    if (typeof value !== 'object' || value === null || !memoryBufferGetter) return false;
    try {
      Reflect.apply(memoryBufferGetter, value, []);
      return true;
    } catch {
      return false;
    }
  }

  function getExports(value: unknown): WebAssembly.Exports | undefined {
    value = unwrapped(value);
    if (typeof value !== 'object' || value === null || !exportsGetter) return undefined;
    try {
      return unwrapped(Reflect.apply(exportsGetter, value, [])) as WebAssembly.Exports;
    } catch {
      return undefined;
    }
  }

  function capture(
    value: unknown,
    source: string,
    imports: unknown,
    suppliedModule: unknown,
    probe: BinaryProbe,
  ): void {
    if (disposed) return;
    const observedValue = unwrapped(value);
    let instance = observedValue;
    let module = unwrapped(suppliedModule);
    let instanceExports = getExports(instance);
    if (!instanceExports) {
      const result = observedValue as WebAssembly.WebAssemblyInstantiatedSource;
      instance = unwrapped(result.instance);
      module = unwrapped(result.module);
      instanceExports = getExports(instance);
    }
    if (!instanceExports || !instance || typeof instance !== 'object') {
      recordError(source, 'Fulfilled WASM result exposes no readable instance exports.');
      return;
    }
    const previous = known.get(instance);
    if (previous) return;
    const entry: CapturedWasm = {
      id: nextId++,
      source,
      capturedAt: new Date().toISOString(),
      instance: instance as WebAssembly.Instance,
      memories: [],
      exports: [],
      ...probe.metadata,
    };
    const seenMemories = new Set<WebAssembly.Memory>();
    for (const [name, rawExportedValue] of Object.entries(instanceExports)) {
      const exportedValue = unwrapped(rawExportedValue);
      if (isMemory(exportedValue)) {
        entry.exports.push({ name, kind: 'memory' });
        if (!seenMemories.has(exportedValue)) {
          seenMemories.add(exportedValue);
          entry.memories.push({ name, origin: 'export', memory: exportedValue });
        }
      } else {
        const tag = Object.prototype.toString.call(exportedValue).match(/^\[object WebAssembly\.(\w+)\]$/)?.[1];
        entry.exports.push({ name, kind: typeof exportedValue === 'function' ? 'function' : tag?.toLowerCase() ?? typeof exportedValue });
      }
    }
    if (module) {
      try {
        // Native Module.imports performs the brand check across JS realms.
        const descriptors = wasm.Module.imports(module as WebAssembly.Module);
        entry.module = module as WebAssembly.Module;
        moduleProbes.set(module as object, probe);
        for (const descriptor of descriptors) {
          if (descriptor.kind !== 'memory' || !imports) continue;
          const namespace = unwrapped((unwrapped(imports) as Record<string, Record<string, unknown>>)[descriptor.module]);
          const candidate = unwrapped(namespace?.[descriptor.name]);
          if (isMemory(candidate) && !seenMemories.has(candidate)) {
            seenMemories.add(candidate);
            entry.memories.push({ name: `${descriptor.module}.${descriptor.name}`, origin: 'import', memory: candidate });
          }
        }
      } catch (error) {
        recordError('module imports', error);
      }
    }
    known.set(instance, entry);
    state.instances.push(entry);
    if (state.instances.length > LIMIT) state.instances.splice(0, state.instances.length - LIMIT);
    probe.targets.push(entry);
    if (probe.targets.length > LIMIT) probe.targets.splice(0, probe.targets.length - LIMIT);
  }

  function moduleProbe(value: unknown): BinaryProbe | undefined {
    value = unwrapped(value);
    return value && (typeof value === 'object' || typeof value === 'function')
      ? moduleProbes.get(value as object) : undefined;
  }

  function replace(
    key: 'instantiate' | 'instantiateStreaming' | 'Instance' | 'compile' | 'compileStreaming' | 'Module',
    replacement: Function,
    exportMethod = false,
  ): void {
    const target = wasm as unknown as Record<string, unknown>;
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, key);
    const original = target[key];
    if (exportMethod && exportToPage) {
      // Firefox can expose a different callable identity when crossing a
      // userscript membrane. Define directly in the page's WebAssembly scope,
      // then retain the identity that the target actually exposes.
      const exportedMethod = exportToPage(replacement, target, key);
      // Also support exporters that only create a page callable (no defineAs).
      if (target[key] === original) target[key] = exportedMethod;
    } else {
      target[key] = replacement;
    }
    const installed = target[key];
    if (typeof installed !== 'function' || installed === original) {
      throw new Error(`Cannot replace WebAssembly.${key}.`);
    }
    state.hooks.push(`WebAssembly.${key}`);
    restore.push(() => {
      if (target[key] !== installed) return;
      if (originalDescriptor) Object.defineProperty(target, key, originalDescriptor);
      else delete target[key];
    });
  }

  for (const method of ['instantiate', 'instantiateStreaming'] as const) {
    try {
      const original = wasm[method];
      if (typeof original !== 'function') continue;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        // These are the same page objects behind Firefox's filtered views,
        // not reconstructed modules, substituted imports, or copied bytes.
        const nativeArgs = args.map((argument) => unwrapped(argument));
        const probe: BinaryProbe = moduleProbe(nativeArgs[0]) ?? { metadata: {}, targets: [] };
        // Best effort only: cloning never consumes the caller's response.
        if (method === 'instantiateStreaming') probeStreaming(nativeArgs[0], probe);
        const promise = Reflect.apply(original, unwrapped(this), nativeArgs);
        if (method === 'instantiate') probeBytes(nativeArgs[0], probe);
        observePromise(promise, (value) => capture(value, method, nativeArgs[1], nativeArgs[0], probe), method);
        return promise;
      };
      replace(method, wrapper, true);
    } catch (error) {
      recordError(`install ${method}`, error);
    }
  }

  for (const method of ['compile', 'compileStreaming'] as const) {
    try {
      const original = wasm[method];
      if (typeof original !== 'function') continue;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        const nativeArgs = args.map((argument) => unwrapped(argument));
        const probe: BinaryProbe = { metadata: {}, targets: [] };
        if (method === 'compileStreaming') probeStreaming(nativeArgs[0], probe);
        const promise = Reflect.apply(original, unwrapped(this), nativeArgs);
        if (method === 'compile') probeBytes(nativeArgs[0], probe);
        observePromise(promise, (module) => {
          // Native brand check, then associate only the observed original module.
          wasm.Module.imports(module as WebAssembly.Module);
          moduleProbes.set(module as object, probe);
        }, method);
        return promise;
      };
      replace(method, wrapper, true);
    } catch (error) { recordError(`install ${method}`, error); }
  }

  try {
    const NativeModule = wasm.Module;
    const handler = new realm.Object() as ProxyHandler<typeof WebAssembly.Module>;
    handler.construct = exported(function (target: typeof WebAssembly.Module, args: unknown[], newTarget: Function): WebAssembly.Module {
      const nativeArgs = Array.from(unwrapped(args), argument => unwrapped(argument));
      const module = Reflect.construct(unwrapped(target), nativeArgs, unwrapped(newTarget)) as WebAssembly.Module;
      try {
        const probe: BinaryProbe = { metadata: {}, targets: [] };
        probeBytes(nativeArgs[0], probe);
        moduleProbes.set(module, probe);
      } catch (error) { recordError('Module', error); }
      return module;
    });
    replace('Module', new realm.Proxy(NativeModule, handler));
  } catch (error) { recordError('install Module', error); }

  try {
    // Allocate both proxy and handler in the page realm. In Firefox the trap
    // must be exported too; a sandbox-created plain handler is not sufficient.
    const handler = new realm.Object() as ProxyHandler<typeof WebAssembly.Instance>;
    handler.construct = exported(function (target: typeof WebAssembly.Instance, args: unknown[], newTarget: Function): WebAssembly.Instance {
      const nativeArgs = Array.from(unwrapped(args), (argument) => unwrapped(argument));
      const instance = Reflect.construct(unwrapped(target), nativeArgs, unwrapped(newTarget)) as WebAssembly.Instance;
      try {
        capture(instance, 'Instance', nativeArgs[1], nativeArgs[0], moduleProbe(nativeArgs[0]) ?? { metadata: {}, targets: [] });
      } catch (error) {
        recordError('Instance', error);
      }
      return instance;
    });
    const proxy = new realm.Proxy(originalInstance, handler);
    replace('Instance', proxy);
  } catch (error) {
    recordError('install Instance', error);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const probe of retainedBytes) {
      delete probe.metadata.bytes;
      for (const target of probe.targets) delete target.bytes;
    }
    retainedBytes.clear();
    for (const undo of restore.reverse()) {
      try {
        undo();
      } catch (error) {
        recordError('dispose', error);
      }
    }
  }

  return state;
}
