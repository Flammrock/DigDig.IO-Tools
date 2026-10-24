import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import webpack from 'webpack';
import { UserscriptPlugin } from '../src/index.mjs';

function compile(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) return reject(error ?? closeError);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve(stats);
      });
    });
  });
}

for (const mode of ['development', 'production']) {
  test(`webpack ${mode}: header survives compilation and only targets userscripts`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'digdig-userscript-plugin-'));
    try {
      const entry = path.join(directory, 'entry.js');
      await writeFile(entry, 'globalThis.digdigPluginFixture = 42;\n');
      await compile({
        mode,
        devtool: 'source-map',
        entry: { 'bootstrap.user': entry, 'second.user': entry, runtime: entry },
        output: { path: path.join(directory, 'dist'), filename: '[name].js' },
        plugins: [new UserscriptPlugin({
          metadata: { name: 'Fixture', version: '1.0.0', grant: ['unsafeWindow', 'GM_xmlhttpRequest'] },
          include: /\.user\.js$/g,
        })],
      });
      for (const filename of ['bootstrap.user.js', 'second.user.js']) {
        const output = await readFile(path.join(directory, 'dist', filename), 'utf8');
        assert.ok(output.startsWith('// ==UserScript==\n// @name Fixture\n'));
        assert.equal((output.match(/==UserScript==/g) ?? []).length, 1);
        assert.ok(output.includes('sourceMappingURL='));
        const map = JSON.parse(await readFile(path.join(directory, 'dist', `${filename}.map`), 'utf8'));
        assert.equal(map.file, filename);
        // Four metadata entries plus opening/closing markers: mapped code starts
        // after the prefix, not at generated line 1.
        assert.ok(map.mappings.startsWith(';;;;;;'));
        assert.ok(map.sourcesContent.some((source) => source.includes('digdigPluginFixture')));
      }
      const runtime = await readFile(path.join(directory, 'dist', 'runtime.js'), 'utf8');
      assert.ok(!runtime.includes('==UserScript=='));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
