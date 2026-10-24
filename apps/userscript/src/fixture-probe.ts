import type { DevelopmentApi } from './api.ts';

// Independently authored memory-only fixture. Never a game binary or replacement.
const fixtureBytes = [0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0];

/** Exercise real page-context calls only on our own local synthetic fixture. */
export async function probeLocalFixture(api: DevelopmentApi, developmentOrigin: string): Promise<void> {
  const { page, capture } = api;
  if (page.location.origin !== developmentOrigin || page.location.pathname !== '/fixture') return;
  const document = page.document;
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
  if (!nonce) throw new Error('The local fixture script nonce is unavailable');
  const resultId = `digdig-fixture-probe-${crypto.randomUUID()}`;
  const resultNode = document.createElement('pre');
  resultNode.id = resultId;
  resultNode.hidden = true;
  const script = document.createElement('script');
  script.nonce = nonce;
  const previousIds = new Set(capture.instances.map((instance) => instance.id));
  const observation: Record<string, unknown> = {
    testedAt: new Date().toISOString(),
    stage: 'page-context-after-runtime-start',
    instanceCountBefore: capture.instances.length,
    fixtureStatus: document.getElementById('status')?.textContent,
    documentReadyState: document.readyState
  };
  // This runs under the fixture's own nonce, in a normal page script. It never
  // executes on the game page and cannot replace any game module.
  script.textContent = `(async () => {
    const output = document.getElementById(${JSON.stringify(resultId)});
    const report = { steps: [] };
    const expected = ${JSON.stringify(fixtureBytes)};
    const bytes = new Uint8Array(expected);
    try {
      const first = await WebAssembly.instantiate(bytes);
      report.steps.push({ source: 'instantiate-bytes', memoryBytes: first.instance.exports.memory.buffer.byteLength });
      const second = await WebAssembly.instantiate(first.module);
      report.steps.push({ source: 'instantiate-module', memoryBytes: second.exports.memory.buffer.byteLength });
      const third = new WebAssembly.Instance(first.module);
      report.steps.push({ source: 'Instance', memoryBytes: third.exports.memory.buffer.byteLength });
      const fourth = await WebAssembly.instantiateStreaming(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
      report.steps.push({ source: 'instantiateStreaming', memoryBytes: fourth.instance.exports.memory.buffer.byteLength });
      first.instance.exports.memory.grow(1);
      report.grownMemoryBytes = first.instance.exports.memory.buffer.byteLength;
    } catch (error) { report.error = String(error); }
    report.sourceBytesUnchanged = bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
    output.textContent = JSON.stringify(report);
  })();`;
  try {
    document.documentElement.append(resultNode, script);
    const deadline = Date.now() + 5000;
    while (!resultNode.textContent && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!resultNode.textContent) throw new Error('The local page-context test did not complete');
    observation.pageResults = JSON.parse(resultNode.textContent);
  } catch (error) { observation.error = String(error); }
  finally { script.remove(); resultNode.remove(); }
  const newInstances = capture.instances.filter((instance) => !previousIds.has(instance.id));
  observation.instanceCountAfter = capture.instances.length;
  observation.newInstanceCount = newInstances.length;
  observation.newInstances = newInstances.map((entry) => ({
    id: entry.id, source: entry.source,
    memories: entry.memories.map(({ name, memory }) => ({ name, byteLength: memory.buffer.byteLength }))
  }));
  observation.hookErrors = [...capture.errors];
  await api.report('fixture-probe', observation);
}
