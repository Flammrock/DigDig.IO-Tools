import { installCapture } from './capture.ts';
import { installCanvasObserver } from './canvas-observer.ts';
import { startMapStream } from './map-stream.ts';
import { showTroubleshooting } from './troubleshooting.ts';

declare const __DESKTOP_URL__: string;
declare const __RELEASE_VERSION__: string;
declare const exportFunction: undefined | ((fn: Function, target: object, options?: { defineAs: string }) => Function);

type PageWindow = Window & typeof globalThis & { wrappedJSObject?: Window & typeof globalThis };
const pageWindow = unsafeWindow as PageWindow;
const page = pageWindow.wrappedJSObject ?? pageWindow;
// Install the same observation hooks synchronously, before any network request.
// The game's module bytes, imports, instructions, and execution stay untouched.
const capture = installCapture(page, typeof exportFunction === 'function'
  ? (fn, target = page, key) => exportFunction!(fn, target, key === undefined ? undefined : { defineAs: key })
  : undefined);
const canvasObserver = installCanvasObserver(page, typeof exportFunction === 'function'
  ? (fn, target = page, key) => exportFunction!(fn, target, key === undefined ? undefined : { defineAs: key })
  : undefined);

// The native app substitutes this one placeholder when installing or exporting.
// The generic deploy file contains no private token or development credentials.
const connection = Object.freeze({ url: __DESKTOP_URL__, token: '__DIGDIG_PAIRING_TOKEN__' });
const paired = /^[a-f0-9]{64}$/.test(connection.token);
const clientId = crypto.randomUUID();
const log = (message: string) => console.info(`[DigDig Tools] ${message}`);
let stopped = false;
let offline = false;
let settingsIdentity = '';
let stopStream: (() => void) | undefined;
let settingsTimer: ReturnType<typeof setTimeout> | undefined;

function request<T>(route: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: body === undefined ? 'GET' : 'POST',
      url: `${connection.url}${route}`,
      headers: { 'X-DigDig-Token': connection.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { data: JSON.stringify(body) }),
      timeout: 5000,
      anonymous: true,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          reject(new Error(response.status === 401 ? 'Pair this userscript with the desktop app again.'
            : `Desktop returned HTTP ${response.status}`));
          return;
        }
        try { resolve(JSON.parse(response.responseText) as T); }
        catch { reject(new Error('Invalid desktop response')); }
      },
      onerror: () => reject(new Error('Open the DigDig desktop app, and allow Tampermonkey to connect to 127.0.0.1.')),
      ontimeout: () => reject(new Error('Desktop connection timed out')),
      onabort: () => reject(new Error('Desktop request cancelled')),
    });
  });
}

async function report(kind: string, payload: unknown): Promise<void> {
  if (stopped) return;
  const versioned = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload, appVersion: __RELEASE_VERSION__ } : payload;
  await request('/reports', { clientId, kind, report: versioned });
}

async function pollSettings(): Promise<void> {
  if (stopped || !paired) return;
  try {
    const settings = await request<{ updateIntervalMs: number; serverId: string; captureEpoch: number }>('/settings');
    if (stopped) return;
    if (![20, 100, 250, 500, 1000].includes(settings.updateIntervalMs)
      || typeof settings.serverId !== 'string' || !settings.serverId || settings.serverId.length > 80
      || !Number.isSafeInteger(settings.captureEpoch) || settings.captureEpoch < 0) {
      throw new Error('Unsupported desktop capture settings');
    }
    // Restart only the observation stream when its cadence changes or the app
    // clears/restarts its cache. Viewer-only preferences do not reset capture.
    const identity = JSON.stringify([settings.serverId, settings.captureEpoch, settings.updateIntervalMs]);
    if (identity !== settingsIdentity) {
      stopStream?.();
      stopStream = startMapStream({ capture, page, clientId, revision: __RELEASE_VERSION__, report, log, requestLayout: request,
        observeDrawImage: observer => canvasObserver.subscribe(observer) }, connection.url, settings);
      settingsIdentity = identity;
    }
    if (offline) log('Connected to the desktop app again.');
    offline = false;
  } catch (error) {
    if (!offline) console.warn('[DigDig Tools]', String(error));
    offline = true;
  } finally {
    if (!stopped) settingsTimer = setTimeout(() => void pollSettings(), offline ? 3000 : 1000);
  }
}

GM_registerMenuCommand('DigDig: Pair with desktop', () => {
  // Opening a normal install URL lets Tampermonkey replace this generic script
  // with the app-personalized copy. No downloaded JavaScript is evaluated here.
  GM_openInTab(`${connection.url}/install.user.js`, { active: true, insert: true });
});
GM_registerMenuCommand('DigDig: Help / troubleshooting', showTroubleshooting);

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  stopped = true;
  clearTimeout(settingsTimer);
  stopStream?.();
  capture.dispose();
  canvasObserver.dispose();
});

if (paired) {
  log('Observation ready. Connecting to the desktop app.');
  void pollSettings();
} else {
  log('Open the DigDig desktop app, then choose “DigDig: Pair with desktop” in Tampermonkey and install its personalized userscript. Reload this game tab afterwards.');
}
