// The development adapter uses the same JSON recipes and filenames as Rust.
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
const MAX_BYTES = 64 * 1024;
const MAX_ENTRIES = 128;
const prefix = 'layout-v1-';
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validVersion = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._+-]{0,63}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, required = allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const fields = values => values.every((value, index) => uint(value) && value <= 0xfffffffc && values.slice(0, index).every(previous => Math.abs(previous - value) >= 4));

export function validCacheEntry(entry) {
  if (!keys(entry, ['schemaVersion', 'wasmSha256', 'resolverVersion', 'resolvedAtUnixMs', 'layout'])
    || entry.schemaVersion !== SCHEMA_VERSION || !validHash(entry.wasmSha256) || !validVersion(entry.resolverVersion)
    || !Number.isSafeInteger(entry.resolvedAtUnixMs) || entry.resolvedAtUnixMs <= 0) return false;
  const layout = entry.layout, optional = ['cameraPointer', 'cameraVtable'];
  const required = ['memoryExport', 'mapX', 'mapY', 'mapRadius', 'cameraOffset', 'cameraX', 'cameraY', 'cameraScale', 'viewWidth', 'viewHeight', 'scaleMode', 'terrain'];
  if (!keys(layout, [...required, ...optional], required) || typeof layout.memoryExport !== 'string'
    || !layout.memoryExport.length || Buffer.byteLength(layout.memoryExport) > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(layout.memoryExport)
    || !fields([layout.mapX, layout.mapY, layout.mapRadius]) || !uint(layout.cameraOffset)
    || optional.some(key => Object.hasOwn(layout, key) && !uint(layout[key]))
    || (layout.cameraPointer !== undefined && layout.cameraPointer > 0xfffffffc)
    || !['divide-f32', 'legacy-reciprocal'].includes(layout.scaleMode)) return false;
  const camera = [layout.cameraX, layout.cameraY, layout.cameraScale, layout.viewWidth, layout.viewHeight];
  if (!fields(camera) || camera.some(offset => layout.cameraOffset + offset > 0xfffffffc)) return false;
  const t = layout.terrain;
  return keys(t, ['sourceWidth', 'sourceHeight', 'worldGridSpacing', 'worldDrawSize', 'worldDrawInset', 'paletteProfile'])
    && [t.sourceWidth, t.sourceHeight].every(size => Number.isInteger(size) && size >= 1 && size <= 1024)
    && [t.worldGridSpacing, t.worldDrawSize].every(size => Number.isFinite(size) && size > 0 && size <= 1e7)
    && Number.isFinite(t.worldDrawInset) && Math.abs(t.worldDrawInset) <= t.worldDrawSize && validVersion(t.paletteProfile);
}

async function metadata(filename) {
  try {
    const value = await lstat(filename);
    if (value.isSymbolicLink()) throw Error('Layout cache cannot use links or reparse points.');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export class LayoutCache {
  #directory;
  #tail = Promise.resolve();
  constructor(directory) { this.#directory = path.resolve(directory); }
  get directory() { return this.#directory; }
  #serial(operation) { const result = this.#tail.then(operation); this.#tail = result.catch(() => {}); return result; }
  #entry(hash, resolver) {
    if (!validHash(hash) || !validVersion(resolver)) throw Error('Invalid layout cache hash or resolver version.');
    return path.join(this.#directory, `${prefix}${resolver}--${hash}.json`);
  }
  async #check(create = false) {
    let directory = this.#directory;
    while (true) {
      const value = await metadata(directory);
      if (value && !value.isDirectory()) throw Error('Layout cache path is not a directory.');
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
    if (create) await mkdir(this.#directory, { recursive: true });
    return Boolean(await metadata(this.#directory));
  }
  async #entries() {
    const entries = [];
    for (const name of await readdir(this.#directory)) {
      const match = /^layout-v1-(.+)--([a-f0-9]{64})\.json$/.exec(name);
      if (!match || !validVersion(match[1])) continue;
      const filename = path.join(this.#directory, name), value = await metadata(filename);
      if (!value) continue;
      if (!value.isFile()) throw Error('A layout cache entry is not a regular file.');
      entries.push(filename);
    }
    return entries;
  }
  get(hash, resolver) {
    return this.#serial(async () => {
      const filename = this.#entry(hash, resolver);
      if (!(await this.#check())) return null;
      const info = await metadata(filename);
      if (!info) return null;
      if (!info.isFile()) throw Error('A layout cache entry is not a regular file.');
      if (info.size > MAX_BYTES) return null;
      let file;
      try { file = await open(filename, 'r'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      let bytes;
      try {
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.length) { const { bytesRead } = await file.read(buffer, length, buffer.length - length); if (!bytesRead) break; length += bytesRead; }
        if (length > MAX_BYTES) return null;
        bytes = buffer.subarray(0, length);
      } finally { await file.close(); }
      let entry;
      try { entry = JSON.parse(bytes.toString('utf8')); } catch { return null; }
      return validCacheEntry(entry) && entry.wasmSha256 === hash && entry.resolverVersion === resolver ? entry : null;
    });
  }
  putValidated(entry) {
    return this.#serial(async () => {
      if (!validCacheEntry(entry)) throw Error('Invalid layout cache recipe.');
      const bytes = Buffer.from(JSON.stringify(entry, null, 2));
      if (bytes.length > MAX_BYTES) throw Error('Layout cache entry is too large.');
      const filename = this.#entry(entry.wasmSha256, entry.resolverVersion);
      await this.#check(true);
      const previous = await metadata(filename);
      if (previous && !previous.isFile()) throw Error('A layout cache entry is not a regular file.');
      if (!previous && (await this.#entries()).length >= MAX_ENTRIES) throw Error('Layout cache is full. Remove old entries before saving another layout.');
      const temporary = path.join(this.#directory, `.${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx');
      try {
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await this.#check();
        const target = await metadata(filename);
        if (target && !target.isFile()) throw Error('A layout cache entry is not a regular file.');
        await rename(temporary, filename);
      } finally { await rm(temporary, { force: true }); }
    });
  }
  remove(hash, resolver) {
    return this.#serial(async () => {
      const filename = this.#entry(hash, resolver);
      if (!(await this.#check())) return false;
      const value = await metadata(filename); if (!value) return false;
      if (!value.isFile()) throw Error('A layout cache entry is not a regular file.');
      await rm(filename); return true;
    });
  }
  clear() {
    return this.#serial(async () => {
      if (!(await this.#check())) return 0;
      const filenames = await this.#entries(); let removed = 0;
      for (const filename of filenames) {
        await this.#check();
        const value = await metadata(filename); if (!value) continue;
        if (!value.isFile()) throw Error('A layout cache entry is not a regular file.');
        await rm(filename); removed++;
      }
      return removed;
    });
  }
}
