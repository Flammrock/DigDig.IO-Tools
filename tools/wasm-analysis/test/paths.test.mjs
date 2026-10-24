import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertSeparateAnalysisPaths } from '../src/paths.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/analyze.mjs', import.meta.url));
// Independently authored memory-only test module, never a game module.
const wasmBytes = Buffer.from([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]);
const jsBytes = Buffer.from('// Synthetic loader fixture; do not overwrite.\n');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'digdig-paths-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'digdig-paths-')));
    await rm(directory, { recursive: true, force: true });
  });
  const wasm = path.join(directory, 'fixture.wasm');
  const js = path.join(directory, 'fixture.js');
  await writeFile(wasm, wasmBytes);
  await writeFile(js, jsBytes);
  return { directory, wasm, js, out: path.join(directory, 'report.txt') };
}

async function unchanged(files) {
  assert.deepEqual(await readFile(files.wasm), wasmBytes);
  assert.deepEqual(await readFile(files.js), jsBytes);
}

async function rejectedCli(files, extra, message) {
  await assert.rejects(run(process.execPath, [cli, '--wasm', files.wasm, '--js', files.js, ...extra]),
    (error) => error.code !== 0 && message.test(error.stderr));
  await unchanged(files);
}

test('CLI rejects normalized output/input collisions without changing WASM bytes', async (t) => {
  const files = await fixture(t);
  const alias = path.join(files.directory, 'unused', '..', 'fixture.wasm');
  await rejectedCli(files, ['--out', alias], /--out aliases --wasm/);
});

test('CLI checks WAT/input collisions before writing the report', async (t) => {
  const files = await fixture(t);
  await rejectedCli(files, ['--out', files.out, '--wat', files.js], /--wat aliases --js/);
  await assert.rejects(stat(files.out), { code: 'ENOENT' });
});

test('CLI rejects hard-linked output/input aliases and preserves both files', async (t) => {
  const files = await fixture(t);
  const alias = path.join(files.directory, 'hardlink.txt');
  await link(files.wasm, alias);
  await rejectedCli(files, ['--out', alias], /--out aliases --wasm/);
  assert.deepEqual(await readFile(alias), wasmBytes);
});

test('CLI rejects an output reached through a symlinked parent', async (t) => {
  const files = await fixture(t);
  const source = path.join(files.directory, 'source');
  const alias = path.join(files.directory, 'alias');
  await mkdir(source);
  const input = path.join(source, 'input.wasm');
  await writeFile(input, wasmBytes);
  await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await rejectedCli({ ...files, wasm: input }, ['--out', path.join(alias, 'input.wasm')], /--out aliases --wasm/);
});

test('report and WAT outputs cannot alias, including missing files under symlinked parents', async (t) => {
  const files = await fixture(t);
  const outputDir = path.join(files.directory, 'output');
  const alias = path.join(files.directory, 'output-alias');
  await mkdir(outputDir);
  await symlink(outputDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const output = path.join(outputDir, 'new.txt');
  await rejectedCli(files, ['--out', output, '--wat', path.join(alias, 'new.txt')], /--out aliases --wat/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('Windows path comparisons reject case-only input aliases', { skip: process.platform !== 'win32' }, async (t) => {
  const files = await fixture(t);
  await assert.rejects(assertSeparateAnalysisPaths({ ...files, out: files.wasm.toUpperCase() }), /--out aliases --wasm/);
  await unchanged(files);
});

test('both output options refuse another WASM file, even when it is not an input', async (t) => {
  const files = await fixture(t);
  const anotherWasm = path.join(files.directory, 'another.WASM');
  await writeFile(anotherWasm, wasmBytes);
  await rejectedCli(files, ['--out', anotherWasm], /--out must not target a \.wasm file/);
  await rejectedCli(files, ['--out', files.out, '--wat', anotherWasm], /--wat must not target a \.wasm file/);
  assert.deepEqual(await readFile(anotherWasm), wasmBytes);
  await assert.rejects(stat(files.out), { code: 'ENOENT' });
});

test('CLI writes separate report and WAT outputs while preserving input bytes', async (t) => {
  const files = await fixture(t);
  const wat = path.join(files.directory, 'new-directory', 'fixture.wat');
  await run(process.execPath, [cli, '--wasm', files.wasm, '--js', files.js, '--out', files.out, '--wat', wat]);
  await unchanged(files);
  assert.match(await readFile(files.out, 'utf8'), /DigDig static WASM inspection/);
  assert.match(await readFile(wat, 'utf8'), /\(module/);
});
