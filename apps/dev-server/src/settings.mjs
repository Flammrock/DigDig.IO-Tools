import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const UPDATE_INTERVALS = Object.freeze([20, 100, 250, 500, 1000]);
export const DEFAULT_VIEWER_SETTINGS = Object.freeze({
  updateIntervalMs: 100, showNotifications: false, autoReconnect: true, alwaysOnTop: false, windowOpacity: 1,
});

export class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export function parseSettings(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length === 0 || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_VIEWER_SETTINGS, key))) {
    throw new SettingsError('Provide one or more supported viewer settings.');
  }
  const result = {};
  for (const [key, setting] of Object.entries(value)) {
    if (key === 'windowOpacity') {
      if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 0.2 || setting > 1) {
        throw new SettingsError('windowOpacity must be a number from 0.2 to 1.');
      }
    } else if (key === 'updateIntervalMs' ? !UPDATE_INTERVALS.includes(setting) : typeof setting !== 'boolean') {
      throw new SettingsError(key === 'updateIntervalMs' ? 'updateIntervalMs must be 20, 100, 250, 500, or 1000.' : `${key} must be true or false.`);
    }
    result[key] = setting;
  }
  return result;
}

export async function loadViewerSettings(rootDir) {
  const directory = path.join(rootDir, '.local');
  const filename = path.join(directory, 'viewer-settings.json');
  let current = { ...DEFAULT_VIEWER_SETTINGS };
  try {
    // Old files stored only the capture interval; new preferences use defaults.
    current = { ...current, ...parseSettings(JSON.parse(await readFile(filename, 'utf8'))) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not load .local/viewer-settings.json: ${error.message}`);
  }
  let pending = Promise.resolve();
  return {
    snapshot: () => ({ ...current }),
    update(value) {
      const patch = parseSettings(value);
      const operation = pending.then(async () => {
        // Merge inside the serialized operation so concurrent partial updates
        // cannot restore stale values for unrelated settings.
        const next = { ...current, ...patch };
        if (Object.keys(next).every(key => next[key] === current[key])) return { ...current };
        await mkdir(directory, { recursive: true });
        const temporary = path.join(directory, `viewer-settings-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
          await rename(temporary, filename);
        } finally { await rm(temporary, { force: true }); }
        current = next;
        return { ...current };
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
