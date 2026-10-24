import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { installCapture } from '../src/capture.ts';
import { probeLocalFixture } from '../src/fixture-probe.ts';

const developmentOrigin = 'http://127.0.0.1:4317';

test('fixture probing never touches DOM or WASM on the game or another path', async () => {
  const locations = [
    { origin: 'https://digdig.io', pathname: '/fixture' },
    { origin: 'https://digdig.io', pathname: '/' },
    { origin: 'http://127.0.0.1:4318', pathname: '/fixture' },
    { origin: developmentOrigin, pathname: '/' },
    { origin: developmentOrigin, pathname: '/fixture-other' },
  ];
  for (const location of locations) {
    const page = { location };
    Object.defineProperties(page, {
      document: { get() { assert.fail('Non-fixture DOM must not be read'); } },
      WebAssembly: { get() { assert.fail('Non-fixture WASM must not be accessed'); } },
    });
    await probeLocalFixture({
      page,
      capture: undefined,
      report() { assert.fail('Non-fixture probing must not emit a test report'); },
    }, developmentOrigin);
  }
});

test('local fixture executes authored WASM in the page realm and reports all four paths despite bounded retention', async () => {
  const nodes = new Map();
  const removed = [];
  const evaluations = [];
  const nonce = 'local-fixture-authorized-script';
  let context;
  const document = {
    readyState: 'complete',
    querySelector(selector) {
      assert.equal(selector, 'script[nonce]');
      return { nonce };
    },
    getElementById(id) {
      return id === 'status' ? { textContent: 'Synthetic fixture ready' } : nodes.get(id) ?? null;
    },
    createElement(tagName) {
      return {
        tagName,
        id: '',
        textContent: '',
        remove() { nodes.delete(this.id); removed.push(this); },
      };
    },
    documentElement: {
      append(...elements) {
        for (const element of elements) {
          if (element.id) nodes.set(element.id, element);
          if (element.tagName === 'script') {
            assert.equal(element.nonce, nonce, 'fixture scripts must use the authorized page nonce');
            evaluations.push(vm.runInContext(element.textContent, context));
          }
        }
      },
    },
  };
  context = vm.createContext({
    document,
    location: { origin: developmentOrigin, pathname: '/fixture' },
    crypto: webcrypto,
    Response,
  });
  const page = vm.runInContext('globalThis', context);
  const nativeInstantiate = page.WebAssembly.instantiate;
  const byteInputs = [];
  page.WebAssembly.instantiate = function (...args) {
    if (ArrayBuffer.isView(args[0])) {
      assert.ok(args[0] instanceof page.Uint8Array, 'test bytes originate in the page realm');
      assert.ok(!(args[0] instanceof Uint8Array), 'the sandbox did not instantiate its own typed array');
      byteInputs.push({ source: args[0], copy: new Uint8Array(args[0]) });
    }
    return Reflect.apply(nativeInstantiate, this, args);
  };
  const capture = installCapture(page);
  const reports = [];
  try {
    // Fill the bounded capture list first: total length remains eight after the
    // probe, so a count based on length subtraction would incorrectly be zero.
    const emptyModule = new page.WebAssembly.Module(new page.Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    for (let index = 0; index < 8; index++) new page.WebAssembly.Instance(emptyModule);
    const beforeIds = new Set(capture.instances.map((entry) => entry.id));
    await probeLocalFixture({
      page, capture, clientId: 'fixture-test', revision: 'fixture-test', log() {},
      async report(kind, report) { reports.push({ kind, report }); },
    }, developmentOrigin);
    await Promise.all(evaluations);
    assert.equal(evaluations.length, 1);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].kind, 'fixture-probe');
    const report = reports[0].report;
    assert.equal(report.error, undefined);
    assert.equal(report.instanceCountBefore, 8);
    assert.equal(report.instanceCountAfter, 8);
    assert.equal(report.newInstanceCount, 4);
    assert.equal(report.pageResults.error, undefined);
    assert.deepEqual(report.pageResults.steps.map((step) => step.source), [
      'instantiate-bytes', 'instantiate-module', 'Instance', 'instantiateStreaming',
    ]);
    assert.ok(report.pageResults.steps.every((step) => step.memoryBytes === 65536));
    assert.equal(report.pageResults.sourceBytesUnchanged, true);
    assert.equal(report.pageResults.grownMemoryBytes, 131072);
    assert.deepEqual(report.hookErrors, []);
    const captured = capture.instances.filter((entry) => !beforeIds.has(entry.id));
    assert.equal(captured.length, 4);
    assert.equal(captured[0].memories[0].memory.buffer.byteLength, 131072);
    assert.equal(byteInputs.length, 1);
    assert.deepEqual(new Uint8Array(byteInputs[0].source), byteInputs[0].copy);
    assert.equal(nodes.size, 0, 'temporary result nodes are removed');
    assert.equal(removed.length, 2, 'temporary script and result nodes are removed');
  } finally {
    capture.dispose();
  }
});
