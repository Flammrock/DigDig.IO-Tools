import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { DEFAULT_VIEWER_SETTINGS, loadViewerSettings, parseSettings } from '../src/settings.mjs';

test('racing viewer setting changes persist in request order without partial files', async () => {
  const prefix = path.join(os.tmpdir(), 'digdig-settings-test-');
  const rootDir = await mkdtemp(prefix);
  try {
    const settings = await loadViewerSettings(rootDir);
    const writes = [250, 500, 1000, 100, 20].map(updateIntervalMs => settings.update({ updateIntervalMs }));
    assert.deepEqual(await Promise.all(writes), [250, 500, 1000, 100, 20].map(updateIntervalMs => ({ ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs })));
    assert.deepEqual(settings.snapshot(), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 20 });
    assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, '.local/viewer-settings.json'), 'utf8')), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 20 });
    assert.deepEqual(await readdir(path.join(rootDir, '.local')), ['viewer-settings.json']);
    const reloaded = await loadViewerSettings(rootDir);
    assert.deepEqual(reloaded.snapshot(), settings.snapshot());
  } finally {
    assert.ok(path.resolve(rootDir).startsWith(path.resolve(prefix)));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('old interval-only settings gain defaults and concurrent partial preferences preserve false values', async () => {
  const prefix = path.join(os.tmpdir(), 'digdig-settings-migration-');
  const rootDir = await mkdtemp(prefix);
  try {
    await mkdir(path.join(rootDir, '.local'));
    await writeFile(path.join(rootDir, '.local/viewer-settings.json'), '{"updateIntervalMs":250}');
    const settings = await loadViewerSettings(rootDir);
    assert.deepEqual(settings.snapshot(), { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 250 });
    await Promise.all([settings.update({ showNotifications: true }), settings.update({ autoReconnect: false }),
      settings.update({ alwaysOnTop: true }), settings.update({ showNotifications: false })]);
    const expected = { ...DEFAULT_VIEWER_SETTINGS, updateIntervalMs: 250, showNotifications: false, autoReconnect: false, alwaysOnTop: true };
    assert.deepEqual(settings.snapshot(), expected);
    assert.deepEqual((await loadViewerSettings(rootDir)).snapshot(), expected);
    for (const bad of [{}, { autoReconnect: 0 }, { showNotifications: 'false' }, { alwaysOnTop: null },
      { unknown: true }, JSON.parse('{"__proto__":true}'), { toString: true }]) {
      assert.throws(() => parseSettings(bad), error => error.status === 400);
    }
  } finally {
    assert.ok(path.resolve(rootDir).startsWith(path.resolve(prefix)));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('window opacity persists independently and rejects values outside the visible range', async () => {
  const prefix = path.join(os.tmpdir(), 'digdig-opacity-test-');
  const rootDir = await mkdtemp(prefix);
  try {
    const settings = await loadViewerSettings(rootDir);
    for (const windowOpacity of [0.2, 0.57, 1]) {
      await Promise.all([settings.update({ windowOpacity }), settings.update({ alwaysOnTop: true })]);
      assert.deepEqual((await loadViewerSettings(rootDir)).snapshot(), {
        ...DEFAULT_VIEWER_SETTINGS, alwaysOnTop: true, windowOpacity,
      });
    }
    for (const windowOpacity of [0, 0.19, 1.01, NaN, Infinity, -Infinity, null, '0.5', true]) {
      assert.throws(() => parseSettings({ windowOpacity }), error => error.status === 400);
    }
  } finally {
    assert.ok(path.resolve(rootDir).startsWith(path.resolve(prefix)));
    await rm(rootDir, { recursive: true, force: true });
  }
});
