import type { DevelopmentApi } from './api.ts';
import type { CapturedWasm } from './capture.ts';
import type { MapFrame, MapState, MemoryLayout, TerrainProfile } from './map-types.ts';
import { currentTerrainProfile, gameLayouts } from './game-layouts.ts';
import { readMapState } from './map-reader.ts';

const MAX_BYTES = 8 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[a-z0-9][a-z0-9._+-]{0,63}$/;
type Matrix = Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>;
type Rectangle = { x: number; y: number; width: number; height: number };
type RecordState = {
  entry: CapturedWasm;
  phase: 'lookup' | 'validating' | 'ready' | 'unsupported';
  message: string;
  layout?: MemoryLayout;
  resolverVersion?: string;
  ticket?: string;
  origin?: 'cache' | 'resolved';
  upload: boolean;
  nextAttempt: number;
  frames: Set<number>;
  tiles: Set<string>;
  firstSampleAt: number;
  committing: boolean;
  diagnostic: string;
  generation: number;
};

export interface LayoutView {
  data?: MapState;
  layout?: MemoryLayout;
  entry?: CapturedWasm;
  hash: string | null;
  status: MapFrame['status'];
  message: string;
  dynamic?: boolean;
}

/** Validate the bridge recipe before using any of its offsets to read memory. */
export function parseResolvedLayout(value: unknown, sha256: string): MemoryLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hashPattern.test(sha256)) throw Error('Invalid resolved layout');
  const v = value as Record<string, unknown>;
  const address = (name: string) => {
    const result = v[name];
    if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0 || result > 0xffff_fffc) throw Error(`Invalid layout field: ${name}`);
    return result;
  };
  if (typeof v.memoryExport !== 'string' || !v.memoryExport || v.memoryExport.length > 128 || /[\u0000-\u001f]/.test(v.memoryExport)
    || !['divide-f32', 'legacy-reciprocal'].includes(String(v.scaleMode))) throw Error('Unsupported resolved memory or scale mode');
  const layout: MemoryLayout = {
    sha256, memoryExport: v.memoryExport,
    mapX: address('mapX'), mapY: address('mapY'), mapRadius: address('mapRadius'),
    cameraOffset: address('cameraOffset'), cameraX: address('cameraX'), cameraY: address('cameraY'),
    cameraScale: address('cameraScale'), viewWidth: address('viewWidth'), viewHeight: address('viewHeight'),
    scaleMode: v.scaleMode as MemoryLayout['scaleMode']
  };
  if (v.cameraPointer !== undefined) layout.cameraPointer = address('cameraPointer');
  if (v.cameraVtable !== undefined) layout.cameraVtable = address('cameraVtable');
  for (const offsets of [[layout.mapX, layout.mapY, layout.mapRadius],
    [layout.cameraX, layout.cameraY, layout.cameraScale, layout.viewWidth, layout.viewHeight]]) {
    if (offsets.some((offset, index) => offsets.slice(0, index).some(previous => Math.abs(offset - previous) < 4))) throw Error('Overlapping layout fields');
  }
  const terrain = v.terrain as Record<string, unknown> | undefined;
  if (!terrain || terrain.sourceWidth !== 64 || terrain.sourceHeight !== 64 || terrain.paletteProfile !== 'materials-v1') {
    throw Error('The resolved terrain image or material profile is unsupported');
  }
  for (const field of ['worldGridSpacing', 'worldDrawSize', 'worldDrawInset']) {
    if (typeof terrain[field] !== 'number' || !Number.isFinite(terrain[field]) || Math.abs(terrain[field]) > 1e7) throw Error('Invalid terrain geometry');
  }
  if ((terrain.worldGridSpacing as number) <= 0 || (terrain.worldDrawSize as number) <= 0
    || Math.abs(terrain.worldDrawInset as number) > (terrain.worldDrawSize as number)) throw Error('Invalid terrain extent');
  layout.terrain = { sourceWidth: 64, sourceHeight: 64, paletteProfile: 'materials-v1',
    worldGridSpacing: terrain.worldGridSpacing as number, worldDrawSize: terrain.worldDrawSize as number,
    worldDrawInset: terrain.worldDrawInset as number };
  return layout;
}

function base64(bytes: Uint8Array) {
  let result = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(result);
}

/** One controller per capture stream. All memory and render checks are read-only. */
export class LayoutResolution {
  private records = new Map<CapturedWasm, RecordState>();
  private stopped = false;
  private networkBusy = false;
  private api: DevelopmentApi;
  constructor(api: DevelopmentApi) { this.api = api; }

  private report(record: RecordState, stage: string, detail?: unknown) {
    const identity = `${stage}:${record.message}`;
    if (record.diagnostic === identity || this.stopped) return;
    record.diagnostic = identity;
    const boundedDetail = detail === undefined ? undefined : JSON.stringify(detail).slice(0, 8192);
    void this.api.report('layout-resolution', { stage, buildHash: record.entry.sha256,
      resolverVersion: record.resolverVersion ?? null, origin: record.origin ?? null,
      message: record.message, samples: record.frames.size, tiles: record.tiles.size,
      ...(boundedDetail === undefined ? {} : { evidence: boundedDetail }) }).catch(() => {});
  }

  private restart(record: RecordState, message: string) {
    record.phase = 'lookup'; record.message = message; record.upload = false;
    record.nextAttempt = Date.now() + 1000;
    record.frames.clear(); record.tiles.clear(); record.firstSampleAt = 0;
    record.generation++;
    delete record.layout; delete record.ticket; delete record.resolverVersion; delete record.origin;
  }

  private async resolve(record: RecordState) {
    if (this.networkBusy || this.stopped || !this.api.requestLayout || Date.now() < record.nextAttempt) return;
    this.networkBusy = true;
    record.nextAttempt = Date.now() + 1000;
    try {
      const body: Record<string, unknown> = { clientId: this.api.clientId, wasmSha256: record.entry.sha256 };
      if (record.upload) {
        if (!record.entry.bytes || record.entry.bytes.byteLength > MAX_BYTES) {
          record.phase = 'unsupported'; record.message = 'Original WASM bytes are unavailable for analysis. Reinstall the current userscript and reload the game.';
          this.report(record, 'unsupported'); return;
        }
        body.wasmBase64 = base64(record.entry.bytes);
      }
      const response = await this.api.requestLayout('/layouts/resolve', body) as Record<string, unknown>;
      if (this.stopped) return;
      record.upload = false;
      if (!response || typeof response !== 'object' || typeof response.resolverVersion !== 'string' || !versionPattern.test(response.resolverVersion)) throw Error('Unsupported layout resolver response');
      record.resolverVersion = response.resolverVersion;
      if (response.status === 'needs-bytes') {
        record.upload = true; record.nextAttempt = Date.now();
        record.message = 'Sending an unchanged WASM copy to the local layout analyzer.';
      } else if (response.status === 'pending') {
        record.message = 'Analyzing this game build locally…';
      } else if (response.status === 'unsupported') {
        record.phase = 'unsupported'; record.message = String(response.message ?? 'The game build has no unique supported layout.').slice(0, 500);
        this.report(record, 'unsupported', response.evidence);
      } else if (response.status === 'candidate') {
        if (typeof response.ticket !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(response.ticket)
          || !['cache', 'resolved'].includes(String(response.origin))) {
          record.phase = 'unsupported'; record.message = 'Invalid layout validation ticket.'; this.report(record, 'unsupported'); return;
        }
        try { record.layout = parseResolvedLayout(response.layout, record.entry.sha256!); }
        catch (error) {
          record.phase = 'unsupported'; record.message = String(error).slice(0, 500); this.report(record, 'unsupported'); return;
        }
        record.ticket = response.ticket; record.origin = response.origin as 'cache' | 'resolved';
        record.phase = 'validating'; record.message = 'Checking the resolved layout against live terrain rendering…';
        record.frames.clear(); record.tiles.clear(); record.firstSampleAt = 0;
        record.generation++;
        this.report(record, 'candidate', response.evidence);
      } else throw Error('Unsupported layout resolver status');
    } catch (error) {
      if (!this.stopped) {
        record.message = `Layout resolver unavailable: ${String(error).slice(0, 350)}`;
        record.nextAttempt = Date.now() + 3000;
        this.report(record, 'pending');
      }
    } finally { this.networkBusy = false; }
  }

  read(): LayoutView {
    if (this.stopped) return { hash: null, status: 'waiting', message: 'Layout observation has stopped.' };
    const entries = this.api.capture.instances.filter(entry => entry.sha256 && hashPattern.test(entry.sha256) && entry.memories.length);
    // Exact bundled manifests take precedence; no file-size guess identifies a module.
    const known = entries.flatMap(entry => {
      const layout = gameLayouts.find(layout => layout.sha256 === entry.sha256);
      return layout ? [{ entry, layout }] : [];
    });
    if (known.length === 1) return this.readEntry(known[0]!.entry, known[0]!.layout, false);
    if (known.length > 1) return { hash: null, status: 'unsupported', message: 'Multiple recognized game instances are active; a unique instance is required.' };
    for (const [entry] of this.records) if (!entries.includes(entry)) this.records.delete(entry);
    for (const entry of entries) {
      if (!this.records.has(entry)) this.records.set(entry, { entry, phase: 'lookup', message: 'Looking for a cached game layout…',
        upload: false, nextAttempt: 0, frames: new Set(), tiles: new Set(), firstSampleAt: 0, committing: false, diagnostic: '', generation: 0 });
    }
    if (!entries.length) return { hash: null, status: 'waiting', message: 'Waiting for the game WASM and its fingerprint. Reload the game if capture started late.' };
    if (!this.api.requestLayout) return { hash: entries[0]!.sha256!, status: 'unsupported', message: 'This game build needs layout discovery. Reinstall the current userscript to enable the local resolver.' };
    const records = [...this.records.values()];
    const lookup = records.find(record => record.phase === 'lookup' && Date.now() >= record.nextAttempt);
    if (lookup) void this.resolve(lookup);
    const candidates = records.filter(record => record.layout);
    if (candidates.length > 1) return { hash: null, status: 'unsupported', message: 'Multiple WASM instances match a game layout; capture is waiting for one unambiguous instance.' };
    // Do not activate the first answer while another module is still unresolved.
    if (candidates.length === 1 && !records.some(record => record !== candidates[0] && record.phase === 'lookup')) {
      const record = candidates[0]!;
      const view = this.readEntry(record.entry, record.layout!, true);
      if (!view.data) {
        record.frames.clear(); record.tiles.clear(); record.firstSampleAt = 0;
        record.generation++;
        if (record.phase === 'ready') this.restart(record, 'The camera changed; checking its layout again.');
        return view;
      }
      if (record.phase !== 'ready') {
        view.status = 'waiting'; view.message = record.message;
        if (record.frames.size >= 3 && record.tiles.size >= 2 && Date.now() >= record.nextAttempt) void this.commit(record);
      } else view.message = `Scanning discovered materials · ${record.origin === 'cache' ? 'cached' : 'resolved'} layout verified.`;
      return view;
    }
    const first = records.find(record => record.phase !== 'unsupported') ?? records[0]!;
    return { hash: first.entry.sha256!, status: records.every(record => record.phase === 'unsupported') ? 'unsupported' : 'waiting', message: first.message };
  }

  private readEntry(entry: CapturedWasm, layout: MemoryLayout, dynamic: boolean): LayoutView {
    const memories = entry.memories.filter(memory => memory.name === layout.memoryExport);
    const result: LayoutView = { entry, layout, dynamic, hash: entry.sha256!, status: 'waiting', message: 'The game camera is not ready.' };
    if (memories.length !== 1) return { ...result, status: 'unsupported', message: 'The resolved memory does not identify one captured game memory.' };
    try { return { ...result, data: readMapState(memories[0]!.memory, layout), status: 'live', message: 'Scanning discovered materials around your position.' }; }
    catch (error) { return { ...result, message: String(error).slice(0, 500) }; }
  }

  /** Called only for unblended material pixels on an observed terrain draw. */
  observe(view: LayoutView, frame: number, transform: Matrix, destination: Rectangle, rect: Rectangle, key: string): boolean {
    if (!view.dynamic) return true;
    const record = view.entry && this.records.get(view.entry);
    if (!record || !view.data || !record.layout || !record.ticket) return false;
    const { camera } = view.data;
    const terrain: TerrainProfile = record.layout.terrain ?? currentTerrainProfile;
    const close = (a: number, b: number, tolerance: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
    const scaleTolerance = Math.max(1e-5, camera.scale * 1e-4);
    const gridTolerance = .25;
    const aligned = (value: number) => close((value - terrain.worldDrawInset) / terrain.worldGridSpacing,
      Math.round((value - terrain.worldDrawInset) / terrain.worldGridSpacing), gridTolerance / terrain.worldGridSpacing);
    const valid = close(transform.a, camera.scale, scaleTolerance) && close(transform.d, camera.scale, scaleTolerance)
      && close(transform.b, 0, 1e-5) && close(transform.c, 0, 1e-5)
      && close(transform.e, camera.width / 2 - camera.x * camera.scale, 2)
      && close(transform.f, camera.height / 2 - camera.y * camera.scale, 2)
      && close(destination.width, terrain.worldDrawSize, gridTolerance) && close(destination.height, terrain.worldDrawSize, gridTolerance)
      && close(rect.x, destination.x, gridTolerance) && close(rect.y, destination.y, gridTolerance)
      && aligned(rect.x) && aligned(rect.y);
    if (!valid) {
      record.frames.clear(); record.tiles.clear(); record.firstSampleAt = 0;
      record.generation++;
      if (record.phase === 'ready') this.restart(record, 'Terrain no longer agrees with the resolved camera; checking again.');
      else record.message = 'Waiting for terrain draws that agree with the resolved camera and grid.';
      return false;
    }
    if (record.phase === 'ready') return true;
    if (!record.firstSampleAt) record.firstSampleAt = Date.now();
    if (record.frames.size < 16) record.frames.add(frame);
    if (record.tiles.size < 32) record.tiles.add(key);
    if (record.frames.size >= 3 && record.tiles.size >= 2 && Date.now() - record.firstSampleAt >= 100) void this.commit(record);
    return false;
  }

  private async commit(record: RecordState) {
    if (record.committing || this.networkBusy || this.stopped || !this.api.requestLayout || !record.ticket
      || record.phase !== 'validating' || Date.now() < record.nextAttempt || Date.now() - record.firstSampleAt < 100) return;
    record.committing = true; this.networkBusy = true;
    const ticket = record.ticket;
    const generation = record.generation;
    try {
      const reply = await this.api.requestLayout('/layouts/validate', { clientId: this.api.clientId,
        wasmSha256: record.entry.sha256, resolverVersion: record.resolverVersion, ticket,
        evidence: { samples: record.frames.size, tiles: record.tiles.size } }) as { cached?: boolean };
      if (this.stopped || ticket !== record.ticket || record.phase !== 'validating' || generation !== record.generation
        || record.frames.size < 3 || record.tiles.size < 2) return;
      if (typeof reply?.cached !== 'boolean') throw Error('Invalid layout validation acknowledgement');
      record.phase = 'ready'; record.message = reply.cached ? 'Resolved layout validated and cached.' : 'Resolved layout validated; persistent cache is unavailable.';
      this.report(record, 'validated', { cached: reply.cached });
    } catch (error) {
      if (!this.stopped && ticket === record.ticket) {
        // A bridge restart or expired ticket requires a fresh lookup, never an
        // endless retry of a stale ticket. Cached layouts are validated again.
        this.restart(record, `Layout validation will retry: ${String(error).slice(0, 300)}`);
        this.report(record, 'pending');
      }
    } finally { record.committing = false; this.networkBusy = false; }
  }

  dispose() { this.stopped = true; this.records.clear(); }
}
