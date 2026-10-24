import webpack from 'webpack';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseWebpackConfig } from '../apps/userscript/webpack.config.mjs';

export const releaseRoot = fileURLToPath(new URL('../', import.meta.url));

export function validateReleaseUserscript(source) {
  if (!source.startsWith('// ==UserScript==') || (source.match(/__DIGDIG_PAIRING_TOKEN__/g) ?? []).length !== 1
    || /new\s+Function\b|\beval\s*\(|sourceMappingURL|127\.0\.0\.1:4317|@match[^\n]*fixture/.test(source)) {
    throw new Error('Release userscript must be standalone, contain one pairing placeholder, and exclude development code/maps.');
  }
}

export async function buildReleaseUserscript() {
  const { version } = JSON.parse(await readFile(path.join(releaseRoot, 'package.json'), 'utf8'));
  const config = createReleaseWebpackConfig({ rootDir: releaseRoot, version });
  const compiler = webpack(config);
  try {
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) => {
      if (error || result?.hasErrors()) reject(error ?? new Error(result.toString({ colors: false })));
      else resolve(result);
    }));
    console.log(stats.toString({ colors: Boolean(process.stdout.isTTY) }));
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
  const filename = path.join(config.output.path, 'digdig.user.js');
  validateReleaseUserscript(await readFile(filename, 'utf8'));
  return filename;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildReleaseUserscript();
}
