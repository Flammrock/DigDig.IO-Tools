import type { DevelopmentApi } from './api.ts';
import { currentTerrainProfile } from './game-layouts.ts';
import { locateTerrainTile } from './map-reader.ts';
import { LayoutResolution } from './layout-resolution.ts';
import type { LayoutView } from './layout-resolution.ts';
import type { MapFrame, MapState, MapTile } from './map-types.ts';
import { observeMaterialChanges } from '@digdig/terrain';
import { TileScheduler } from './tile-scheduler.ts';

export function startMapStream(api: DevelopmentApi, developmentOrigin: string, options: { updateIntervalMs?: number } = {}) {
  const requestedInterval = options.updateIntervalMs ?? 100;
  const updateIntervalMs = [20, 100, 250, 500, 1000].includes(requestedInterval) ? requestedInterval : 100;
  // Fast position updates do not require reading every nearby terrain tile in
  // the same render interval. Slower presets retain their existing throughput.
  const tilesPerFrame = updateIntervalMs === 20 ? 6 : 24;
  const fixture = api.page.location.origin === developmentOrigin && api.page.location.pathname === '/fixture';
  const game = /^https?:\/\/digdig\.io$/.test(api.page.location.origin);
  if (!fixture && !game) return () => {};
  const resolution = game ? new LayoutResolution(api) : undefined;
  let stopped = false;
  let sending = false;
  let hookError = '';
  let lastError = '';
  let lastWorld = '';
  let nextScan = 0;
  let animationFrame: number | undefined;
  let frameTimer: number | undefined;
  let capturing = false;
  let compositing = false;
  let frameState: MapState | undefined;
  let frameView: LayoutView | undefined;
  let frameNumber = 0;
  const pending = new Map<string, MapTile>();
  const sent = new Map<string, { hash: number; at: number }>();
  const tileScheduler = new TileScheduler(tilesPerFrame);
  const knownMaterials = new Map<string, Uint8ClampedArray>();
  const frameMaterials = new Map<string, Uint8ClampedArray>();
  const spareMaterials: Uint8ClampedArray[] = [];
  type Surface = { canvas: OffscreenCanvas | HTMLCanvasElement;
    context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D };
  type Composite = { rect: NonNullable<ReturnType<typeof locateTerrainTile>>;
    surface: Surface | null; materials: Uint8ClampedArray | null };
  const composites = new Map<string, Composite>();
  const spareSurfaces: Surface[] = [];
  let unsubscribe = () => {};

  function releaseComposites() {
    for (const { surface } of composites.values()) if (surface && spareSurfaces.length < 24) spareSurfaces.push(surface);
    composites.clear();
    for (const pixels of frameMaterials.values()) if (spareMaterials.length < tilesPerFrame) spareMaterials.push(pixels);
    frameMaterials.clear();
  }

  function surface(): Surface {
    const reused = spareSurfaces.pop();
    if (reused) {
      reused.context.clearRect(0, 0, 64, 64);
      return reused;
    }
    // Private output only: never resize or paint onto a source/game canvas.
    // OffscreenCanvas has a different prototype from the observed main canvas.
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(64, 64)
      : api.page.document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as Surface['context'] | null;
    if (!context) throw new Error('A private canvas for terrain compositing is unavailable');
    return { canvas, context };
  }

  function finishFrame() {
    animationFrame = undefined;
    frameTimer = undefined;
    capturing = false;
    if (stopped) { releaseComposites(); return; }
    const now = Date.now();
    for (const [key, { rect, surface, materials }] of composites) {
      try {
        const prior = sent.get(key);
        const pixels = materials ?? surface!.context.getImageData(0, 0, 64, 64).data;
        if (game) {
          const known = knownMaterials.get(key) ?? new Uint8ClampedArray(64 * 64 * 4);
          const { changed } = observeMaterialChanges(pixels, known);
          // This retained buffer is only a comparison cache. Send this frame's
          // positive observations, never stale hidden pixels that could replace
          // more recent observations from another connected game session.
          knownMaterials.delete(key); knownMaterials.set(key, known);
          if (knownMaterials.size > 256) knownMaterials.delete(knownMaterials.keys().next().value!);
          if (!changed && prior && now - prior.at < 5000) continue;
        }
        let hash = 2166136261;
        if (!game) {
          for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i]!, 16777619) >>> 0;
          if (prior?.hash === hash && now - prior.at < 5000) continue;
        }
        // A tile is only 16 KiB, safely below the argument limit. Avoid creating
        // thousands of one-character strings for each outgoing tile.
        const rgba = btoa(String.fromCharCode(...pixels));
        pending.set(key, { ...rect, pixelWidth: 64, pixelHeight: 64, rgba });
        sent.delete(key);
        sent.set(key, { hash, at: now });
        if (sent.size > 256) sent.delete(sent.keys().next().value!);
        lastError = '';
      } catch (error) {
        // Do not recycle a tainted surface into subsequent captures.
        composites.delete(key);
        lastError = `Terrain image read failed: ${String(error)}`;
      }
    }
    releaseComposites();
  }

  function beginFrame() {
    animationFrame = undefined;
    if (stopped) return;
    releaseComposites();
    frameState = undefined;
    frameView = undefined;
    frameNumber++;
    if (game) tileScheduler.beginFrame();
    capturing = true;
    // Consecutive animation callbacks bracket one render interval. Compositing
    // across a timed 100ms window would blend several game frames together.
    if (typeof window.requestAnimationFrame === 'function') {
      animationFrame = window.requestAnimationFrame(finishFrame);
    } else frameTimer = window.setTimeout(finishFrame, 20);
  }

  function scheduleFrame() {
    if (stopped || capturing || animationFrame !== undefined || frameTimer !== undefined) return;
    if (typeof window.requestAnimationFrame === 'function') animationFrame = window.requestAnimationFrame(beginFrame);
    else beginFrame();
  }

  function state(): LayoutView {
    if (fixture) {
      const raw = api.page.document.getElementById('map-state')?.textContent;
      return raw ? { data: JSON.parse(raw) as MapState, hash: null, status: 'live', message: 'Synthetic moving terrain fixture' }
        : { hash: null, status: 'waiting', message: 'Reload the local fixture to start its moving terrain test.' };
    }
    return resolution!.read();
  }

  try {
    if (!api.observeDrawImage) hookError = 'Reinstall the development userscript, then reload this page to enable terrain capture.';
    else unsubscribe = api.observeDrawImage((context, args) => {
      if (stopped || !capturing || compositing || args.length !== 5) return;
      const source = args[0] as HTMLCanvasElement | OffscreenCanvas | undefined;
      if (!source || source.width !== 64 || source.height !== 64 || typeof source.getContext !== 'function') return;
      const currentView = frameView ??= state();
      const current = frameState ?? currentView.data;
      if (!current || context.canvas.width !== current.camera.width || context.canvas.height !== current.camera.height) return;
      const profile = currentView.layout?.terrain ?? currentTerrainProfile;
      const x = args[1] as number, y = args[2] as number, width = args[3] as number, height = args[4] as number;
      if (x === undefined || y === undefined || width === undefined || height === undefined) return;
      const transform = context.getTransform();
      const destination = { x, y, width, height };
      const rect = locateTerrainTile(current, transform, destination);
      if (!rect || Math.abs(rect.width - profile.worldDrawSize) > 2 || Math.abs(rect.height - profile.worldDrawSize) > 2) return;
      const dx = rect.x + rect.width / 2 - current.player.x, dy = rect.y + rect.height / 2 - current.player.y;
      if (dx * dx + dy * dy > 9 * profile.worldGridSpacing * profile.worldGridSpacing) return;
      rect.key = `${Math.round((rect.x - profile.worldDrawInset) / profile.worldGridSpacing)},${Math.round((rect.y - profile.worldDrawInset) / profile.worldGridSpacing)}`;
      if (game && !tileScheduler.includes(rect.key)) return;
      if (!composites.has(rect.key) && composites.size >= 24) return;
      try {
        const alpha = typeof context.globalAlpha === 'number' ? context.globalAlpha : 1;
        if (!Number.isFinite(alpha) || alpha <= 0) return;
        let composite = composites.get(rect.key);
        if (game) {
          // Classify unblended source bytes, like the original scanner. Applying
          // fog/globalAlpha first would darken legitimate ore colors. Unknown
          // pixels never erase a positive observation from an earlier layer.
          const sourceContext = source.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!sourceContext) return;
          const pixels = sourceContext.getImageData(0, 0, 64, 64).data;
          let materials = frameMaterials.get(rect.key);
          if (!materials) {
            materials = spareMaterials.pop() ?? new Uint8ClampedArray(64 * 64 * 4);
            materials.fill(0);
            frameMaterials.set(rect.key, materials);
          }
          const changes = observeMaterialChanges(pixels, materials);
          if (!changes.observed) return;
          frameView = currentView;
          frameState = current;
          // Candidate observation is allowed while waiting, but no unvalidated
          // tile enters the outgoing queue or shared map.
          if (!resolution!.observe(currentView, frameNumber, transform, destination, rect, rect.key)) return;
          if (!composite) {
            composite = { rect, surface: null, materials };
            composites.set(rect.key, composite);
          }
          frameState = current;
          return;
        }
        // The synthetic fixture continues to exercise ordinary transparent
        // compositing independently of the game's material palette.
        if (!composite) {
          composite = { rect, surface: surface(), materials: null };
          composites.set(rect.key, composite);
        }
        frameState = current;
        const target = composite.surface!.context;
        target.globalAlpha = Math.min(alpha, 1);
        target.globalCompositeOperation = 'source-over';
        // The HTML fallback may share the observed prototype. Suppress re-entry
        // while invoking its draw; the normal OffscreenCanvas path is unhooked.
        compositing = true;
        target.drawImage(source, 0, 0, 64, 64);
      } catch (error) { lastError = `Terrain compositing failed: ${String(error)}`; }
      finally { compositing = false; }
    });
  } catch (error) { hookError = `Terrain observation unavailable: ${String(error)}`; }

  async function tick() {
    if (stopped || sending) return;
    sending = true;
    const startedAt = Date.now();
    let failed = false;
    try {
      const current = state();
      const world = current.data?.world;
      const identity = JSON.stringify([current.hash, world?.centerX, world?.centerY]);
      if (identity !== lastWorld || current.status !== 'live') {
        pending.clear(); sent.clear(); knownMaterials.clear(); tileScheduler.clear(); lastWorld = identity;
      }
      const tiles = Array.from(pending.values());
      pending.clear();
      const frame: MapFrame = {
        version: 1, source: fixture ? 'fixture' : 'game', status: current.status,
        message: [current.message, hookError, lastError].filter(Boolean).join(' '),
        buildHash: current.hash, capturedAt: new Date().toISOString(),
        ...(current.status === 'live' ? current.data ?? {} : {}), tiles: current.status === 'live' ? tiles : [],
        ...(game ? { terrainMode: 'materials-v1' as const } : {})
      };
      await api.report('map-frame', frame);
    } catch (error) {
      // Retry all visible tiles after a disconnect; do not accumulate network work.
      sent.clear();
      failed = true;
      api.log(`Map stream pending: ${String(error)}`);
    } finally {
      sending = false;
      if (!stopped) {
        scheduleFrame();
        // Network time counts toward the requested cadence; never overlap sends
        // or accumulate a timer queue when the bridge is slow or offline.
        const delay = failed ? Math.max(1000, updateIntervalMs) : Math.max(0, updateIntervalMs - (Date.now() - startedAt));
        nextScan = window.setTimeout(() => void tick(), delay);
      }
    }
  }
  nextScan = window.setTimeout(() => void tick(), 0);
  return () => {
    stopped = true;
    clearTimeout(nextScan);
    if (frameTimer !== undefined) clearTimeout(frameTimer);
    if (animationFrame !== undefined && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(animationFrame);
    unsubscribe();
    resolution?.dispose();
    pending.clear(); sent.clear(); knownMaterials.clear(); tileScheduler.clear(); composites.clear(); frameMaterials.clear();
    spareSurfaces.length = 0; spareMaterials.length = 0;
  };
}
