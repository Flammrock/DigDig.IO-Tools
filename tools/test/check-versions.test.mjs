import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkVersions } from '../check-versions.mjs';

const workspaceNames = ['apps/desktop', 'apps/dev-server', 'apps/userscript',
  'packages/layout-resolver', 'packages/terrain', 'packages/userscript-webpack-plugin'];

async function fixture(t, version = '2.0.0') {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'digdig-versions-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(rootDir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(rootDir), /^digdig-versions-/);
    await rm(rootDir, { recursive: true, force: true });
  });
  const files = new Map();
  const root = { name: 'digdig-tools', version, workspaces: ['apps/*', 'packages/*'] };
  const lock = { version, lockfileVersion: 3, packages: { '': structuredClone(root) } };
  files.set('package.json', JSON.stringify(root));
  for (const relative of workspaceNames) {
    const manifest = { name: `@digdig/${relative.split('/')[1]}`, version };
    if (relative === 'apps/userscript') {
      manifest.dependencies = { '@digdig/terrain': '*' };
      manifest.devDependencies = { '@digdig/userscript-webpack-plugin': version };
    }
    lock.packages[relative] = structuredClone(manifest);
    files.set(`${relative}/package.json`, JSON.stringify(manifest));
  }
  files.set('package-lock.json', JSON.stringify(lock));
  files.set('.release-please-manifest.json', JSON.stringify({ '.': '1.2.2' }));
  files.set('apps/desktop/src-tauri/Cargo.toml', `[package]\nname = "digdig-desktop"\nversion = "${version}" # x-release-please-version\n\n[package.metadata.tauri-winres]\nFileVersion = "${version}.0" # x-release-please-version\nProductVersion = "${version}.0" # x-release-please-version\n\n[dependencies]\nversion = "9.8.7"\n`);
  files.set('apps/desktop/src-tauri/Cargo.lock', `version = 4\n\n[[package]]\nname = "unrelated"\nversion = "9.8.7"\n\n[[package]]\nname = "digdig-desktop"\nversion = "${version}"\ndependencies = ["unrelated"]\n\n[[package]]\nname = "another"\nversion = "1.2.3"\n`);
  for (const [relative, contents] of files) {
    const filename = path.join(rootDir, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents);
  }
  return { rootDir, files,
    async json(relative, change) {
      const filename = path.join(rootDir, relative), value = JSON.parse(await readFile(filename, 'utf8'));
      change(value); await writeFile(filename, JSON.stringify(value));
    },
    async text(relative, change) {
      const filename = path.join(rootDir, relative);
      await writeFile(filename, change(await readFile(filename, 'utf8')));
    },
  };
}

test('checks current and next releases without writing files or treating the last release as the next', async t => {
  for (const version of ['2.0.0', '2.1.0']) {
    const f = await fixture(t, version);
    const result = await checkVersions({ rootDir: f.rootDir, tag: `v${version}` });
    assert.deepEqual(result, { version, windowsVersion: `${version}.0`, workspaces: workspaceNames });
    for (const [relative, contents] of f.files) assert.equal(await readFile(path.join(f.rootDir, relative), 'utf8'), contents);
  }
});

test('rejects invalid Windows/SemVer versions and a tag for a different release', async t => {
  for (const version of ['2.1.0-beta.1', '02.1.0', '2.1', '65536.0.0', '2.0.0.0', 2]) {
    const f = await fixture(t);
    await f.json('package.json', value => { value.version = version; });
    await assert.rejects(checkVersions({ rootDir: f.rootDir }), /stable x.y.z/);
  }
  const f = await fixture(t);
  await assert.rejects(checkVersions({ rootDir: f.rootDir, tag: 'v2.1.0' }), /Release tag/);
});

test('rejects stale workspace and lock versions, including newly added workspaces', async t => {
  for (const [file, mutate, message] of [
    ['apps/userscript/package.json', value => { value.version = '1.2.2'; }, /apps\/userscript\/package.json version/],
    ['package-lock.json', value => { value.version = '1.2.2'; }, /package-lock.json version/],
    ['package-lock.json', value => { value.packages[''].version = '1.2.2'; }, /root package version/],
    ['package-lock.json', value => { value.packages['packages/terrain'].version = '1.2.2'; }, /packages\/terrain/],
  ]) {
    const f = await fixture(t);
    await f.json(file, mutate);
    await assert.rejects(checkVersions({ rootDir: f.rootDir }), message);
  }
  const f = await fixture(t);
  await mkdir(path.join(f.rootDir, 'apps/new-app'));
  await writeFile(path.join(f.rootDir, 'apps/new-app/package.json'), JSON.stringify({ name: '@digdig/new-app', version: '1.2.2' }));
  await assert.rejects(checkVersions({ rootDir: f.rootDir }), /apps\/new-app/);
});

test('rejects internal dependency drift in manifests and lockfiles', async t => {
  const old = await fixture(t, '2.1.0');
  await old.json('apps/userscript/package.json', value => { value.dependencies['@digdig/terrain'] = '2.0.0'; });
  await assert.rejects(checkVersions({ rootDir: old.rootDir }), /internal dependencies/);
  const lock = await fixture(t);
  await lock.json('package-lock.json', value => { value.packages['apps/userscript'].dependencies['@digdig/terrain'] = '2.0.0'; });
  await assert.rejects(checkVersions({ rootDir: lock.rootDir }), /package-lock.json apps\/userscript dependencies/);
});

test('checks native crate, Windows resource and lock versions in their own sections', async t => {
  for (const [file, from, to, message] of [
    ['Cargo.toml', 'version = "2.0.0"', 'version = "1.2.2"', /package.version/],
    ['Cargo.toml', 'FileVersion = "2.0.0.0"', 'FileVersion = "2.0.0"', /FileVersion/],
    ['Cargo.toml', 'ProductVersion = "2.0.0.0"', 'ProductVersion = "1.2.2.0"', /ProductVersion/],
    ['Cargo.lock', 'version = "2.0.0"', 'version = "1.2.2"', /digdig-desktop version/],
    ['Cargo.lock', 'name = "digdig-desktop"', 'name = "different-app"', /digdig-desktop entries/],
  ]) {
    const f = await fixture(t);
    await f.text(`apps/desktop/src-tauri/${file}`, text => text.replace(from, to));
    await assert.rejects(checkVersions({ rootDir: f.rootDir }), message);
  }
});
