import type { DevelopmentApi, RuntimeController } from './api.ts';
import { probeLocalFixture } from './fixture-probe.ts';
import { startMapStream } from './map-stream.ts';
import { gameLayouts } from './game-layouts.ts';

declare const __DEV_URL__: string;
declare const __APP_VERSION__: string;
// The authenticated bridge prepends this variable to the replaceable runtime.
// This keeps settings compatible with already-installed diagnostic bootstraps.
declare const __DIGDIG_RUNTIME_SETTINGS__: { updateIntervalMs?: number } | undefined;

// Add small candidate windows here during analysis. These are byte offsets, not typed-array indices.
// Empty initially: historical addresses must not be treated as valid for the current game.
const probeWindows: Array<{ label: string; offset: number; count: number }> = [];

export function activate(transport: DevelopmentApi): RuntimeController {
  // Stamp the active runtime version even when the installed bootstrap is older.
  const api: DevelopmentApi = { ...transport, report(kind, payload) {
    // An already-running webpack watcher may still have the older config.
    const versioned = typeof __APP_VERSION__ !== 'undefined'
      && payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, appVersion: __APP_VERSION__ } : payload;
    return transport.report(kind, versioned);
  } };
  let disposed = false;
  let previousFingerprint = '';
  let reporting = false;

  function snapshot() {
    const { page, capture } = api;
    return {
      recordedAt: new Date().toISOString(),
      runtimeRevision: api.revision,
      page: { origin: page.location.origin, pathname: page.location.pathname },
      userAgent: navigator.userAgent,
      viewport: { width: page.innerWidth, height: page.innerHeight, devicePixelRatio: page.devicePixelRatio },
      canvases: Array.from(page.document.querySelectorAll('canvas')).slice(0, 8).map((canvas) => ({
        width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight
      })),
      mapCandidates: capture.instances.flatMap<Record<string, unknown>>((entry) => {
        const layout = gameLayouts.find((item) => item.sha256 === entry.sha256);
        const memory = layout && entry.memories.find((item) => item.name === layout.memoryExport)?.memory;
        if (!layout || !memory) return [];
        try {
          const view = new DataView(memory.buffer);
          const owner = layout.cameraPointer === undefined ? 0 : view.getUint32(layout.cameraPointer, true);
          const camera = owner + layout.cameraOffset;
          return [{ sha256: entry.sha256, owner, camera,
            map: { x: view.getFloat32(layout.mapX, true), y: view.getFloat32(layout.mapY, true), radius: view.getFloat32(layout.mapRadius, true) },
            cameraValues: { x: view.getFloat32(camera + layout.cameraX, true), y: view.getFloat32(camera + layout.cameraY, true),
              scale: view.getFloat32(camera + layout.cameraScale, true), width: view.getInt32(camera + layout.viewWidth, true),
              height: view.getInt32(camera + layout.viewHeight, true), vtable: view.getUint32(camera, true) } }];
        } catch (error) { return [{ error: String(error) }]; }
      }),
      capture: {
        installedAt: capture.installedAt,
        hooks: capture.hooks,
        errors: [...capture.errors],
        note: capture.instances.length ? 'Captured live WASM. Map reads use a known layout or a unique discovered layout verified against live terrain rendering.'
          : 'No WASM captured yet. Check injection timing, workers, and whether the game has loaded.',
        instances: capture.instances.map((entry) => ({
          id: entry.id, source: entry.source, capturedAt: entry.capturedAt,
          sha256: entry.sha256 ?? null, byteLength: entry.byteLength ?? null,
          analysisBytesAvailable: Boolean(entry.bytes),
          exports: entry.exports,
          memories: entry.memories.map(({ name, origin, memory }) => {
            // Always acquire the current buffer: memory.grow may detach the previous one.
            const buffer = memory.buffer;
            const view = new DataView(buffer);
            return {
              name, origin, byteLength: buffer.byteLength,
              probes: probeWindows.slice(0, 16).map(({ label, offset, count }) => {
                if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 1
                  || count > 64 || offset + count * 4 > view.byteLength) {
                  return { label, offset, error: 'Invalid or out-of-bounds probe' };
                }
                return {
                  label, offset,
                  words: Array.from({ length: count }, (_, index) => {
                    const address = offset + index * 4;
                    const float = view.getFloat32(address, true);
                    return { address, uint32: view.getUint32(address, true), float32: Number.isFinite(float) ? float : String(float) };
                  })
                };
              })
            };
          })
        }))
      }
    };
  }

  async function report() {
    if (disposed || reporting) return;
    reporting = true;
    try { await api.report('diagnostic', snapshot()); }
    finally { reporting = false; }
  }

  async function reportOnChange() {
    if (disposed || reporting) return;
    const fingerprint = JSON.stringify({
      errors: api.capture.errors,
      instances: api.capture.instances.map((entry) => [
        entry.id, entry.sha256, entry.memories.map(({ memory }) => memory.buffer.byteLength)
      ])
    });
    if (fingerprint === previousFingerprint) return;
    try {
      await report();
      previousFingerprint = fingerprint;
    } catch (error) { api.log(`Report pending: ${String(error)}`); }
  }

  const interval = setInterval(() => void reportOnChange(), 2000);
  const streamSettings = typeof __DIGDIG_RUNTIME_SETTINGS__ === 'undefined' ? {} : __DIGDIG_RUNTIME_SETTINGS__;
  const stopMapStream = startMapStream(api, __DEV_URL__, streamSettings);
  void reportOnChange();
  void probeLocalFixture(api, __DEV_URL__).catch((error) => api.log(`Fixture probe failed: ${String(error)}`));
  api.log('Diagnostics active. Edit runtime.ts to update this tab automatically.');
  return { report, dispose() { disposed = true; clearInterval(interval); stopMapStream(); } };
}
