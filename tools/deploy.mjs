import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseRoot, validateReleaseUserscript } from './build-release-userscript.mjs';
import { TROUBLESHOOTING_GUIDE } from '../apps/userscript/src/troubleshooting.ts';

const require = createRequire(import.meta.url);

function nx(target) {
  const metadataPath = require.resolve('nx/package.json');
  const executable = path.resolve(path.dirname(metadataPath), require(metadataPath).bin.nx);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, 'run', target, '--output-style=static'], {
      cwd: releaseRoot, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${target} failed (${code ?? 'signal'}).`)));
  });
}

// Replace only files produced by this command. Other files in deploy stay intact.
async function atomicFile(destination, operation) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { await operation(temporary); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
}

export async function assembleDeploy({ rootDir, binaryPath, userscriptPath, version, platform = process.platform }) {
  const directory = path.join(rootDir, 'deploy');
  const binaryName = `DigDig-Map-Observatory${platform === 'win32' ? '.exe' : ''}`;
  const script = await readFile(userscriptPath, 'utf8');
  validateReleaseUserscript(script);
  const binaryStat = await stat(binaryPath);
  if (!binaryStat.isFile() || binaryStat.size === 0) throw new Error('The desktop build did not produce an executable.');
  await mkdir(directory, { recursive: true });
  await atomicFile(path.join(directory, binaryName), temporary => copyFile(binaryPath, temporary));
  await atomicFile(path.join(directory, 'digdig.user.js'), temporary => writeFile(temporary, script));
  const instructions = `DigDig Map Observatory ${version}

1. Run ${binaryName}. Keep the app open while playing.
2. In Brave/Chrome extension settings, open Tampermonkey -> Details and enable
   Allow User Scripts. This permission can be disabled by default.
3. Open the app's hamburger menu, choose Install userscript, then Install userscript.
4. Install the script in Tampermonkey and reload https://digdig.io/.

The app contains the userscript and its own HTTP bridge on 127.0.0.1:4319.
Node, npm, and this source checkout are not needed to run it. Windows requires
Microsoft Edge WebView2 Runtime (normally already installed).

The included digdig.user.js is a generic copy without private credentials.
If installed directly, open the app, visit digdig.io, then use Tampermonkey's
"DigDig: Pair with desktop" menu. Install the personalized replacement and reload
the game tab. Install/Copy/Export from inside the app provide a paired copy directly.
Personalized scripts are specific to this computer's app data; share the generic
deploy file, not a personalized export.

In Firefox, Tampermonkey's Content Script API may need to be set to UserScripts API
so observation starts before the game. Allow its connection to 127.0.0.1 if asked.
Disable the separate development userscript when using this release script to
avoid running two observers on the same game page.

The app keeps settings and pairing data in its user-data directory. Open the
hamburger menu's info icon to see the actual folder, then choose Open in Explorer.
File locations also lists settings, reports, and the game layout cache folder.
Save scans as .chunks files before closing the app to retain them between launches.
The local bridge never modifies the game's WASM binary or instructions.

${TROUBLESHOOTING_GUIDE}
`;
  await atomicFile(path.join(directory, 'README.txt'), temporary => writeFile(temporary, instructions));
  const files = [];
  for (const name of [binaryName, 'digdig.user.js', 'README.txt']) {
    const bytes = await readFile(path.join(directory, name));
    files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = { version, platform, architecture: process.arch, builtAt: new Date().toISOString(), files };
  await atomicFile(path.join(directory, 'manifest.json'), temporary => writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`));
  return { directory, files };
}

export async function deploy() {
  await nx('userscript:release-build');
  await nx('desktop:native-build');
  const { version } = JSON.parse(await readFile(path.join(releaseRoot, 'package.json'), 'utf8'));
  const cargoDirectory = process.env.CARGO_TARGET_DIR
    ? path.resolve(releaseRoot, process.env.CARGO_TARGET_DIR)
    : path.join(releaseRoot, 'apps/desktop/src-tauri/target');
  const target = process.env.CARGO_BUILD_TARGET;
  const binaryPath = path.join(cargoDirectory, ...(target ? [target] : []), 'release',
    `digdig-desktop${process.platform === 'win32' ? '.exe' : ''}`);
  const result = await assembleDeploy({ rootDir: releaseRoot, binaryPath,
    userscriptPath: path.join(releaseRoot, 'dist/release-userscript/digdig.user.js'), version });
  console.log(`\nDeployment ready: ${result.directory}`);
  for (const file of result.files) console.log(`  ${file.name} (${(file.bytes / 1024 / 1024).toFixed(2)} MiB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await deploy();
}
