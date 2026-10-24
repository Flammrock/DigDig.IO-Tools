import { installCapture } from './capture.ts';
import { installCanvasObserver } from './canvas-observer.ts';
import { showTroubleshooting } from './troubleshooting.ts';
import type { RuntimeController, RuntimeModule } from './api.ts';

declare const __DEV_URL__: string;
declare const __DEV_TOKEN__: string;
declare const __APP_VERSION__: string;
declare const exportFunction: undefined | ((fn: Function, target: object, options?: { defineAs: string }) => Function);

type PageWindow = Window & typeof globalThis & { wrappedJSObject?: Window & typeof globalThis };
// Firefox Xrays can hide redefined native properties. Use the waived page view
// where available, so installation and cleanup inspect the actual page methods.
const pageWindow = unsafeWindow as PageWindow;
const page = pageWindow.wrappedJSObject ?? pageWindow;
// This runs before any network request. Hooks cannot wait for the development bundle.
const capture = installCapture(page, typeof exportFunction === 'function'
  ? (fn, target = page, key) => exportFunction!(fn, target, key === undefined ? undefined : { defineAs: key })
  : undefined);
const canvasObserver = installCanvasObserver(page, typeof exportFunction === 'function'
  ? (fn, target = page, key) => exportFunction!(fn, target, key === undefined ? undefined : { defineAs: key })
  : undefined);
const clientId = crypto.randomUUID();
const log = (message: string) => console.info(`[DigDig development] ${message}`);
let controller: RuntimeController | undefined;
let revision = '';
let rejectedRevision = '';
let serverId = '';
let cursor = 0;
let stopped = false;
let offline = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function request<T>(route: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: body === undefined ? 'GET' : 'POST',
      url: `${__DEV_URL__}${route}`,
      headers: {
        'X-DigDig-Token': __DEV_TOKEN__,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { data: JSON.stringify(body) }),
      timeout: 5000,
      anonymous: true,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          reject(new Error(`Local server returned HTTP ${response.status} for ${route.split('?')[0]}`));
          return;
        }
        try { resolve(JSON.parse(response.responseText) as T); }
        catch { reject(new Error('Invalid JSON from the local server')); }
      },
      onerror: () => reject(new Error('Local server unavailable or Tampermonkey connection permission denied')),
      ontimeout: () => reject(new Error('Local server request timed out')),
      onabort: () => reject(new Error('Local server request aborted'))
    });
  });
}

async function report(kind: string, payload: unknown): Promise<void> {
  // A hot-reloaded runtime supplies its own version; bootstrap-only reports use
  // the version of the installed loader.
  const versioned = typeof __APP_VERSION__ !== 'undefined'
    && payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? { appVersion: __APP_VERSION__, ...payload } : payload;
  const result = await request<{ filename: string }>('/reports', { clientId, kind, report: versioned });
  if (kind !== 'map-frame') log(`Saved ${result.filename}`);
}

function saveReport(): Promise<void> {
  return controller ? controller.report() : report('bootstrap', {
    hooks: capture.hooks, errors: capture.errors,
    instances: capture.instances.map((entry) => ({
      id: entry.id, source: entry.source, sha256: entry.sha256 ?? null,
      memories: entry.memories.map(({ name, memory }) => ({ name, byteLength: memory.buffer.byteLength }))
    }))
  });
}

function loadRuntime(bundle: { revision: string; code: string }): void {
  if ((bundle.revision === revision && controller) || bundle.revision === rejectedRevision) return;
  try {
    // Development only: trusted, authenticated local build; never install this loader for distribution.
    const module = new Function(`${bundle.code}\nreturn DigDigRuntime;\n//# sourceURL=digdig-runtime.js`)() as RuntimeModule;
    if (typeof module?.activate !== 'function') throw new Error('The runtime does not export activate()');
    // Keep the working runtime if the replacement fails during activation.
    const next = module.activate({ capture, page, clientId, revision: bundle.revision, report, log, requestLayout: request,
      observeDrawImage: (observer) => canvasObserver.subscribe(observer) });
    if (typeof next?.dispose !== 'function' || typeof next?.report !== 'function') {
      throw new Error('activate() must return a runtime controller');
    }
    const previous = controller;
    controller = next;
    revision = bundle.revision;
    rejectedRevision = '';
    try { previous?.dispose(); }
    catch (error) { console.warn('[DigDig development] Previous runtime cleanup failed', error); }
    log(`Loaded runtime ${revision.slice(0, 12)} without reloading the game`);
  } catch (error) {
    rejectedRevision = bundle.revision;
    console.error('[DigDig development] Runtime could not start. Fix the source to retry.', error);
    void report('runtime-error', { message: String(error), revision: bundle.revision }).catch(() => {});
  }
}

async function poll(): Promise<void> {
  if (stopped) return;
  try {
    const bundle = await request<{ revision: string; code: string }>('/bundle');
    if (stopped) return;
    loadRuntime(bundle);
    const events = await request<{
      serverId: string;
      latestId: number;
      commands: Array<{ id: number; type: 'report' | 'reload' | 'ping' }>;
    }>(`/events?clientId=${encodeURIComponent(clientId)}&after=${cursor}`);
    if (stopped) return;
    if (serverId && serverId !== events.serverId) {
      // Read from zero on the next poll; an old cursor must not skip commands after restart.
      cursor = 0;
      serverId = events.serverId;
    } else {
      serverId = events.serverId;
      for (const command of events.commands) {
        if (command.type === 'report') await saveReport();
        else if (command.type === 'ping') await report('pong', { revision, hooks: capture.hooks });
        else if (command.type === 'reload') {
          stopped = true;
          page.location.reload();
          return;
        }
        cursor = command.id;
      }
      cursor = Math.max(cursor, events.latestId);
    }
    if (offline) log('Connected again');
    offline = false;
  } catch (error) {
    if (!offline) console.warn('[DigDig development]', String(error));
    offline = true;
  } finally {
    if (!stopped) timer = setTimeout(() => void poll(), offline ? 3000 : 1000);
  }
}

GM_registerMenuCommand('DigDig: Help / troubleshooting', showTroubleshooting);
GM_registerMenuCommand('DigDig: save diagnostic report', () => {
  void saveReport().catch((error) => console.error('[DigDig development]', error));
});
GM_registerMenuCommand('DigDig: reload game page', () => page.location.reload());
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return; // Back/Forward restores this document without rerunning userscripts.
  stopped = true;
  clearTimeout(timer);
  controller?.dispose();
  capture.dispose();
  canvasObserver.dispose();
});
log(`Early capture installed; connecting to ${__DEV_URL__}`);
void poll();
