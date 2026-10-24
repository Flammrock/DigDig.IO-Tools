import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_WASM_BYTES, RESOLVER_VERSION, resolveWasm } from '../src/index.mjs';
import { buildResolverFixture } from './fixtures.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('automatic resolution captures relocated fields, owner slot, palette, and renamed memory without rewriting bytes', async () => {
  for (const options of [
    {},
    { staticCamera: true, fieldShift: 16 },
    { origin: 30000000, owner: 20000, ownerField: 108, cameraOffset: 1024, allocation: 32000,
      vtable: 3336, palette: 6000, memoryExport: 'renamed_memory', fieldShift: 32 },
  ]) {
    const fixture = await buildResolverFixture(options);
    const before = hash(fixture.bytes);
    const result = await resolveWasm(fixture.bytes);
    assert.equal(result.status, 'candidate', JSON.stringify(result));
    assert.deepEqual(result.layout, fixture.layout);
    assert.equal(result.evidence.layoutCandidates, 1);
    assert.equal(result.evidence.resolverVersion, RESOLVER_VERSION);
    assert.equal(hash(fixture.bytes), before);
    assert.ok(JSON.stringify(result.evidence).length < 2048);
  }
});

test('coordinate resemblance alone, unknown palettes, changed geometry, and inconsistent operands stay unsupported', async () => {
  for (const options of [{ missingTerrain: true }, { wrongPalette: true }, { wrongGrid: true }, { wrongCamera: true }]) {
    const fixture = await buildResolverFixture(options);
    const result = await resolveWasm(fixture.bytes);
    assert.equal(result.status, 'unsupported', JSON.stringify({ options, result }));
    assert.equal('layout' in result, false);
  }
});

test('multiple complete camera owners are preserved as ambiguity', async () => {
  const fixture = await buildResolverFixture({ ambiguous: true });
  const result = await resolveWasm(fixture.bytes);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.evidence.cameraCandidates, 2);
  assert.equal(result.evidence.layoutCandidates, 2);
});

test('malformed and oversized inputs return bounded diagnostics', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(15), new Uint8Array(MAX_WASM_BYTES + 1),
    new Uint8Array([0,97,115,109,1,0,0,0,7,255,255,255,255,127])]) {
    const result = await resolveWasm(bytes);
    assert.equal(result.status, 'unsupported');
    assert.ok(result.message.length < 600);
    assert.equal('layout' in result, false);
  }
});

test('expanded local declarations are bounded before decoder allocation', async () => {
  // Authored section bytes, unrelated to any game file. The declared local
  // vector expands to 100001 entries despite its tiny encoded representation.
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0,
    5,3,1,0,1, 7,5,1,1,109,2,0,
    10,8,1,6,1,0xa1,0x8d,0x06,0x7f,0x0b]);
  const result = await resolveWasm(bytes);
  assert.equal(result.status, 'unsupported');
  assert.match(result.message, /expanded local count/);
});

test('original current snapshot resolves solely through patterns and remains byte-identical', async context => {
  const filename = process.env.DIGDIG_CURRENT_WASM ?? path.join(root, '.local/current-game/client.wasm');
  let bytes;
  try { bytes = await readFile(filename); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('Original current snapshot is not present'); return; } throw error; }
  const before = hash(bytes);
  assert.equal(before, '8ff0e9d2bc58c6f9c52ef4fe2ee99173aa577bd51dc264cbef0b02e1f298f58d');
  const result = await resolveWasm(bytes);
  assert.equal(result.status, 'candidate', JSON.stringify(result));
  const reference = JSON.parse(await readFile(path.join(root, 'reports/current-game-layout.json'), 'utf8'));
  assert.equal(result.layout.mapX, reference.mapX);
  assert.equal(result.layout.mapY, reference.mapY);
  assert.equal(result.layout.mapRadius, reference.mapRadius);
  assert.equal(result.layout.cameraPointer, reference.cameraPointer);
  assert.equal(result.layout.cameraOffset, reference.cameraOffset);
  assert.equal(result.layout.cameraVtable, reference.cameraVtable);
  assert.equal(result.layout.memoryExport, reference.memoryExport);
  assert.equal(result.layout.terrain.paletteProfile, 'materials-v1');
  assert.equal(hash(bytes), before);
  assert.equal(hash(await readFile(filename)), before);
});

test('archived original is inspected conservatively and never rewritten', async context => {
  const filename = process.env.DIGDIG_REFERENCE_WASM ?? 'C:/Users/flamm/Downloads/digdigio-old-snapshot/client.wasm';
  let bytes;
  try { bytes = await readFile(filename); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('Original archived snapshot is not present'); return; } throw error; }
  const before = hash(bytes);
  assert.equal(before, 'f33b4b100c2b520eecbe3012a0125385975fc64f7c45864086ce7258ed471ff2');
  const result = await resolveWasm(bytes);
  assert.equal(result.status, 'unsupported', 'Archived terrain semantics must not inherit the current palette/profile');
  assert.equal(result.evidence.coordinateCandidates, 1);
  assert.equal(result.evidence.cameraCandidates, 1);
  assert.equal(hash(bytes), before);
  assert.equal(hash(await readFile(filename)), before);
});
