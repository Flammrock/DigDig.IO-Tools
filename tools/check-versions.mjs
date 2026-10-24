import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const dependencyKinds = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));

function tomlString(body, key) {
  const matches = [...body.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(["'])([^\\r\\n]*?)\\1\\s*(?:#.*)?$`, 'gm'))];
  return matches.length === 1 ? matches[0][2] : undefined;
}

function tomlSection(text, name) {
  let current = '', result = '';
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/);
    if (heading) current = heading[1];
    else if (current === name) result += `${line}\n`;
  }
  return result;
}

/** Read-only release gate: every published version must agree before building. */
export async function checkVersions({ rootDir = repositoryRoot, tag } = {}) {
  const root = await readJson(path.join(rootDir, 'package.json'));
  const version = root.version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    || version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('package.json version must be a stable x.y.z version with each Windows version component between 0 and 65535.');
  }
  const errors = [];
  const equal = (actual, expected, label) => {
    if (actual !== expected) errors.push(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
  };
  if (tag !== undefined) equal(tag, `v${version}`, 'Release tag');
  if (!Array.isArray(root.workspaces) || root.workspaces.length === 0) throw new Error('package.json must declare workspace directories.');
  const workspaces = [];
  for (const pattern of root.workspaces) {
    if (pattern !== 'apps/*' && pattern !== 'packages/*') throw new Error(`Unsupported workspace pattern: ${pattern}`);
    const directory = pattern.slice(0, -2);
    for (const entry of await readdir(path.join(rootDir, directory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = `${directory}/${entry.name}`;
      let manifest;
      try { manifest = await readJson(path.join(rootDir, relative, 'package.json')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      workspaces.push({ relative, manifest });
      equal(manifest.version, version, `${relative}/package.json version`);
    }
  }
  if (!workspaces.length) throw new Error('No workspace package manifests were found.');
  const internalNames = new Set(workspaces.map(item => item.manifest.name));
  const lock = await readJson(path.join(rootDir, 'package-lock.json'));
  equal(lock.version, version, 'package-lock.json version');
  equal(lock.packages?.['']?.version, version, 'package-lock.json root package version');
  for (const { relative, manifest } of [{ relative: '', manifest: root }, ...workspaces]) {
    const locked = lock.packages?.[relative];
    equal(locked?.version, version, `package-lock.json packages[${JSON.stringify(relative)}].version`);
    for (const kind of dependencyKinds) {
      const declared = manifest[kind] ?? {}, recorded = locked?.[kind] ?? {};
      for (const name of new Set([...Object.keys(declared), ...Object.keys(recorded)])) {
        if (!internalNames.has(name)) continue;
        if (declared[name] !== '*' && declared[name] !== version) {
          errors.push(`${relative || 'root'} ${kind}.${name}: internal dependencies must use "*" or the release version ${version}.`);
        }
        equal(recorded[name], declared[name], `package-lock.json ${relative || 'root'} ${kind}.${name}`);
      }
    }
  }
  const cargoPath = 'apps/desktop/src-tauri/Cargo.toml';
  const cargo = await readFile(path.join(rootDir, cargoPath), 'utf8');
  equal(tomlString(tomlSection(cargo, 'package'), 'version'), version, `${cargoPath} package.version`);
  const windowsVersion = `${version}.0`;
  for (const key of ['FileVersion', 'ProductVersion']) {
    equal(tomlString(tomlSection(cargo, 'package.metadata.tauri-winres'), key), windowsVersion, `${cargoPath} ${key}`);
  }
  const cargoLockPath = 'apps/desktop/src-tauri/Cargo.lock';
  const cargoLock = await readFile(path.join(rootDir, cargoLockPath), 'utf8');
  const packages = cargoLock.split(/^\s*\[\[package\]\]\s*(?:#.*)?$/m)
    .filter(block => tomlString(block, 'name') === 'digdig-desktop');
  equal(packages.length, 1, `${cargoLockPath} digdig-desktop entries`);
  equal(packages.length === 1 ? tomlString(packages[0], 'version') : undefined, version, `${cargoLockPath} digdig-desktop version`);
  if (errors.length) throw new Error(`Release versions do not agree:\n${errors.map(error => `- ${error}`).join('\n')}`);
  return { version, windowsVersion, workspaces: workspaces.map(item => item.relative).sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node tools/check-versions.mjs [vX.Y.Z]');
    const result = await checkVersions({ ...(process.argv[2] === undefined ? {} : { tag: process.argv[2] }) });
    console.log(`Release versions verified: ${result.version}; Windows ${result.windowsVersion}; ${result.workspaces.length} workspaces.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
