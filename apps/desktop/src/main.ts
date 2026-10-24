import { invoke, isTauri } from '@tauri-apps/api/core';
import { materialPalette, createChunksDocument, parseChunksDocument, stringifyChunksDocument, validateMapMarker,
  renderChunksPng, getChunksWorldBounds } from '@digdig/terrain';
import type { ChunksDocument, MapMarker } from '@digdig/terrain';
import type { MapFrame, Telemetry, TelemetryClient, Tile } from './telemetry.ts';
import { TelemetryCache } from './telemetry-cache.ts';
import { archiveClient, compatiblePreview, previewWithLivePosition } from './archive-source.ts';
import { emptySelection, hitMap, selectMapRectangle, toggleSelection } from './map-selection.ts';
import { fitMap, MIN_VIEW_SCALE, screenToWorld, worldToScreen, zoomAt } from './viewport.ts';
import type { Point, Viewport } from './viewport.ts';
import { workspaceMarkup } from './workspace-shell.ts';
import { setupUserscriptControls } from './userscript-controls.ts';
import { setupStorageControls } from './storage-controls.ts';
import { startLayoutAnalysis } from './layout-analysis.ts';
import { chooseSession, withMapMetadata } from './session-selection.ts';
import { sameMapAppearance } from './render-state.ts';
import { WindowOpacityController } from './window-opacity.ts';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = workspaceMarkup;
const userscriptControls = setupUserscriptControls();
const storageControls = setupStorageControls();
const layoutAnalysis = startLayoutAnalysis();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const context = canvas.getContext('2d', { alpha: false })!;
const selector = $<HTMLSelectElement>('source');
const clearDialog = $<HTMLDialogElement>('clear-dialog');
const text = (id: string, value: string) => { const element = $(id); if (element.textContent !== value) element.textContent = value; };
const number = (value: number | undefined, decimals = 1) => value === undefined ? '—'
  : value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
let telemetry: Telemetry = { serverId: '', clients: [] };
const telemetryCache = new TelemetryCache();
type Archive = { name: string; document: ChunksDocument; client: TelemetryClient; liveClientId?: string };
const archives = new Map<string, Archive>();
let updateIntervalMs = 100;
interface ViewerSettings { updateIntervalMs: number; showNotifications: boolean; autoReconnect: boolean; alwaysOnTop: boolean; windowOpacity: number }
let showNotifications = false;
let autoReconnect = true;
let alwaysOnTop = false;
let windowOpacity = 1;
let opacitySupported = false;
let opacityEditEpoch = 0;
const opacityController = new WindowOpacityController(opacity => invoke('set_window_opacity', { opacity }));
const opacitySupport = isTauri() ? invoke<boolean>('window_opacity_supported').catch(() => false) : Promise.resolve(false);
let settingsSaving = false;
let spacePan = false;
let settingsLoaded = false;
let settingsLoading = false;
let settingsRetryAt = 0;
let settingsEpoch = 0;
let actionBusy = false;
let pollEpoch = 0;
let selected = '';
let scope = '';
let online = false;
let disposed = false;
let follow = true;
let showTileGrid = false;
let showMarkers = true;
let interactionMode: 'pan' | 'select' = 'pan';
const panels = ['files', 'markers', 'userscript', 'settings', 'info'] as const;
type Panel = typeof panels[number];
let openPanel: Panel | undefined;
let toolsOpen = false;
let selection = emptySelection();
let markerListSignature = '';
let menuPoint: Point = { x: 0, y: 0 };
let markerDraft: { point: Point; sourceId: string } | undefined;
let pendingFileMode: 'merge' | 'preview' = 'merge';
let pendingClear: { sourceId: string; serverId: string | null; identity: string } | undefined;
let view: Viewport = { x: 0, y: 0, scale: 1 };
let viewInitialized = false;
let size = { width: 1, height: 1 };
let pointer: Point | undefined;
let dragging: { start: Point; last: Point; current: Point; worldStart: Point; box: boolean; moved: boolean; additive: boolean } | undefined;
let pollTimer: ReturnType<typeof setTimeout>;
let animation = 0;
let drawNeeded = true;
const renderedTiles = new Map<string, { tile: Tile; canvas: HTMLCanvasElement }>();
let syncedTiles: Tile[] | undefined;
let syncedMarkers: MapMarker[] | undefined;
let knownPixels = 0;
const unknownCanvas = document.createElement('canvas');
unknownCanvas.width = unknownCanvas.height = 32;
const unknownContext = unknownCanvas.getContext('2d')!;
unknownContext.fillStyle = '#101e27';
unknownContext.fillRect(0, 0, 32, 32);
unknownContext.fillStyle = '#14232d';
unknownContext.fillRect(0, 0, 16, 16);
unknownContext.fillRect(16, 16, 16, 16);
const unknownPattern = context.createPattern(unknownCanvas, 'repeat')!;
for (const material of materialPalette) {
  const item = document.createElement('span');
  item.className = 'material-swatch';
  const swatch = document.createElement('i');
  swatch.style.backgroundColor = `rgb(${material.rgb.join(' ')})`;
  swatch.setAttribute('aria-hidden', 'true');
  item.append(swatch, document.createTextNode(material.name));
  $('material-swatches').append(item);
}

text('transport', isTauri() ? 'TAURI DESKTOP' : 'BROWSER PREVIEW');

function activeArchive() { return archives.get(selected); }
function previewLiveClient(archive: Archive) {
  let live = telemetry.clients.find(client => client.clientId === archive.liveClientId && compatiblePreview(archive.document, client));
  if (!live || live.stale || live.frame.status !== 'live') {
    const fresh = telemetry.clients.find(client => !client.stale && client.frame.status === 'live' && compatiblePreview(archive.document, client));
    if (fresh) { live = fresh; archive.liveClientId = fresh.clientId; }
  }
  return live;
}
function activeClient() {
  const archive = activeArchive();
  if (archive) return previewWithLivePosition(archive.client, archive.document, online ? previewLiveClient(archive) : undefined);
  const client = telemetry.clients.find(item => item.clientId === selected);
  return client ? withMapMetadata(client) : undefined;
}
function mergeTarget() {
  const archive = activeArchive();
  const client = archive ? previewLiveClient(archive) : telemetry.clients.find(item => item.clientId === selected);
  return client ? withMapMetadata(client) : undefined;
}
function setFollow(value: boolean) {
  follow = value;
  drawNeeded = true;
  $('follow').setAttribute('aria-pressed', String(value));
}

function setInteractionMode(mode: 'pan' | 'select') {
  interactionMode = mode;
  dragging = undefined;
  spacePan = false;
  updateInteractionHint();
  $('pan-mode').setAttribute('aria-pressed', String(mode === 'pan'));
  $('select-mode').setAttribute('aria-pressed', String(mode === 'select'));
  hideMapMenu();
  drawNeeded = true;
}

function updateInteractionHint() {
  canvas.dataset.mode = spacePan ? 'pan' : interactionMode;
  text('mode-hint', spacePan ? 'Temporary pan · Release Space to select' : interactionMode === 'pan'
    ? 'Drag to pan · Scroll to zoom' : 'Click or drag to select · Hold Space to pan');
}

function showNotice(message: string, state: 'busy' | 'success' | 'error' = 'success') {
  text('action-message', message);
  $('action-status').dataset.state = state;
  $('action-status').hidden = !message || (state !== 'error' && !showNotifications);
}
$('dismiss-notification').addEventListener('click', () => { $('action-status').hidden = true; });

function setToolsOpen(open: boolean) {
  toolsOpen = open;
  const items = $('map-tool-items');
  // Keep focus visible when the toolbar is collapsed.
  if (!open && items.contains(document.activeElement)) $('tools-toggle').focus({ preventScroll: true });
  items.hidden = !open;
  $('tools-toggle').setAttribute('aria-expanded', String(open));
  const label = open ? 'Close map tools' : 'Open map tools';
  $('tools-toggle').setAttribute('aria-label', label);
  text('tools-toggle-tip', label);
  if (open) { setPanel(); hideMapMenu(); }
}

function setPanel(panel?: Panel, restoreFocus = false) {
  const previous = openPanel;
  openPanel = panel;
  for (const name of panels) {
    $(`${name}-panel`).hidden = name !== panel;
    $(`${name}-toggle`).setAttribute('aria-expanded', String(name === panel));
  }
  if (panel) {
    hideMapMenu();
    if (panel === 'userscript') void userscriptControls.refresh();
    if (panel === 'info') void storageControls.refresh();
    $(`${panel}-panel`).querySelector<HTMLElement>('select:not(:disabled), input:not([hidden]):not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true });
  } else if (restoreFocus && previous) $(toolsOpen ? `${previous}-toggle` : 'tools-toggle').focus({ preventScroll: true });
}

function tileCanvas(tile: Tile, existing?: HTMLCanvasElement) {
  if (!Number.isInteger(tile.pixelWidth) || !Number.isInteger(tile.pixelHeight)
    || tile.pixelWidth < 1 || tile.pixelWidth > 64 || tile.pixelHeight < 1 || tile.pixelHeight > 64) return;
  const decoded = atob(tile.rgba);
  if (decoded.length !== tile.pixelWidth * tile.pixelHeight * 4) return;
  const pixels = new Uint8ClampedArray(decoded.length);
  for (let index = 0; index < decoded.length; index++) pixels[index] = decoded.charCodeAt(index);
  const result = existing ?? document.createElement('canvas');
  if (result.width !== tile.pixelWidth) result.width = tile.pixelWidth;
  if (result.height !== tile.pixelHeight) result.height = tile.pixelHeight;
  result.getContext('2d')!.putImageData(new ImageData(pixels, tile.pixelWidth, tile.pixelHeight), 0, 0);
  return result;
}

function syncTiles(client: TelemetryClient | undefined) {
  const nextScope = `${activeArchive() ? 'archive' : telemetry.serverId}/${client?.mapId ?? client?.clientId}/${client?.frame.source}/${client?.frame.terrainMode ?? 'raw'}`;
  const scopeChanged = scope !== nextScope;
  if (scopeChanged) {
    scope = nextScope;
    renderedTiles.clear();
    syncedTiles = undefined;
    syncedMarkers = undefined;
    knownPixels = 0;
    view = { x: client?.frame.player?.x ?? 0, y: client?.frame.player?.y ?? 0, scale: 1 };
    viewInitialized = false;
    selection = emptySelection();
    hideMapMenu();
    closeMarkerEditor();
    markerListSignature = '';
    setFollow(true);
    if (activeArchive()) { setFollow(false); fitSelection(); }
  }
  // A waiting frame may arrive before the first camera sample. Initialize only
  // once camera data exists, then preserve the user's zoom across updates.
  if (!viewInitialized && client?.frame.camera && client.frame.player) {
    view = {
      x: client.frame.player.x,
      y: client.frame.player.y,
      scale: Math.max(MIN_VIEW_SCALE, Math.min(20, client.frame.camera.scale)),
    };
    viewInitialized = true;
    drawNeeded = true;
  }
  let changed = scopeChanged;
  // Pose-only deltas retain these arrays in TelemetryCache. Avoid scanning the
  // entire discovered map or touching canvas surfaces at the 20ms pose cadence.
  if (syncedTiles !== client?.tiles) {
    syncedTiles = client?.tiles;
    changed = true;
    knownPixels = 0;
    const keys = new Set<string>();
    for (const tile of client?.tiles ?? []) {
      keys.add(tile.key);
      knownPixels += tile.observedPixels ?? 0;
      const old = renderedTiles.get(tile.key);
      if (old?.tile === tile) continue;
      if (old?.tile.rgba === tile.rgba && old.tile.pixelWidth === tile.pixelWidth && old.tile.pixelHeight === tile.pixelHeight) {
        old.tile = tile;
        continue;
      }
      try {
        const decoded = tileCanvas(tile, old?.canvas);
        if (decoded) renderedTiles.set(tile.key, { tile, canvas: decoded });
      } catch { renderedTiles.delete(tile.key); }
    }
    for (const key of renderedTiles.keys()) if (!keys.has(key)) renderedTiles.delete(key);
    for (const key of selection.tileKeys) if (!keys.has(key)) selection.tileKeys.delete(key);
  }
  if (syncedMarkers !== client?.markers) {
    syncedMarkers = client?.markers;
    changed = true;
    const markerIds = new Set((client?.markers ?? []).map(marker => marker.id));
    for (const id of selection.markerIds) if (!markerIds.has(id)) selection.markerIds.delete(id);
  }
  if (changed) updateSelectionInfo();
}

function updateSources() {
  if (!archives.has(selected)) selected = chooseSession(telemetry.clients, selected, autoReconnect);
  const choices = telemetry.clients.map(client => ({
    value: client.clientId,
    label: client.mapOnly ? 'Shared game map · awaiting a session'
      : `${client.frame.source === 'fixture' ? 'Local fixture' : 'Game'} · ${client.clientId.slice(0, 8)}${client.stale ? ' · inactive' : ''}`,
  }));
  for (const [id, archive] of archives) choices.push({ value: id, label: `Preview · ${archive.name}` });
  if (choices.length === 0) choices.push({ value: '', label: 'Waiting for a userscript…' });
  const signature = JSON.stringify(choices);
  if (selector.dataset.options !== signature) {
    selector.replaceChildren(...choices.map(({ value, label }) => new Option(label, value)));
    selector.dataset.options = signature;
  }
  selector.value = selected;
  syncTiles(activeClient());
}

function updateInfo() {
  const client = activeClient();
  const archive = activeArchive();
  const frame = client?.frame;
  text('userscript-version', archive ? 'Saved preview' : client?.mapOnly || !client ? 'Not connected' : frame?.appVersion ?? 'Not reported');
  const materials = frame?.terrainMode === 'materials-v1';
  const age = client ? Math.max(0, Date.now() - client.lastSeen) : Infinity;
  const stale = !online || age > 5000 || client?.stale;
  const state = archive ? 'SAVED' : !online ? 'OFFLINE' : !frame ? 'WAITING' : stale ? 'STALE' : frame.status.toUpperCase();
  text('frame-state', state);
  $('frame-state').dataset.state = state.toLowerCase();
  $('connection').dataset.state = !online ? 'offline' : frame && !stale ? 'live' : 'waiting';
  $('connection').lastElementChild!.textContent = !online ? 'Bridge offline' : frame && !stale ? 'Receiving data' : 'Bridge connected';
  text('source-kind', archive ? frame?.player ? 'Preview terrain · live player position' : 'Preview terrain · waiting for matching live position' : frame?.source === 'fixture' ? 'Synthetic local fixture · not game data' : frame ? 'digdig.io · browser observation' : 'No source connected');
  text('source-tag', archive ? 'PREVIEW MAP' : frame?.source === 'fixture' ? 'LOCAL FIXTURE' : frame ? stale ? 'GAME · STALE' : 'GAME' : 'NO SIGNAL');
  if (archive || online) text('message', frame?.message ?? 'Install the userscript from the menu, then reload the game.');
  text('player-x', number(frame?.player?.x));
  text('player-y', number(frame?.player?.y));
  text('normalized', frame?.player ? `${number(frame.player.normalizedX, 3)} / ${number(frame.player.normalizedY, 3)}` : '—');
  text('map-size', frame?.world ? `${number(frame.world.radius * 2, 0)} units` : '—');
  text('map-boundary-note', !frame?.world ? '' : frame.source === 'fixture'
    ? 'Synthetic fixture bounds.'
    : archive && !frame.player ? 'Boundary saved with this scan. Connect a matching live session to update it.'
    : stale ? 'Last received boundary. Scanned terrain is retained beyond it.'
    : 'The boundary follows the game as it resizes. Scanned terrain is retained when the boundary shrinks.');
  text('tile-count', number(renderedTiles.size, 0));
  $('known-pixels-row').hidden = !materials;
  text('known-pixels', number(knownPixels, 0));
  text('map-tag', materials ? 'SCANNED TERRAIN' : 'TERRAIN CANVAS');
  text('terrain-legend', materials ? 'Scanned materials' : 'Observed terrain');
  text('scan-hint', materials ? 'Discovered materials stay visible when fog returns.' : 'Terrain appears as it is observed.');
  $('material-key').hidden = !materials;
  text('frame-age', archive && !frame?.player ? 'Saved snapshot' : Number.isFinite(age) ? age < 1000 ? `${Math.round(age)} ms ago` : `${(age / 1000).toFixed(1)} s ago` : '—');
  text('build-hash', frame?.buildHash ? `${frame.buildHash.slice(0, 16)}…` : frame?.source === 'fixture' ? 'Synthetic fixture' : 'Awaiting capture');
  $('build-hash').title = frame?.buildHash ?? '';
  $('empty').hidden = Boolean(frame?.world || renderedTiles.size);
  text('empty-title', archive ? 'This saved map is empty' : !online ? 'Waiting for the bridge' : frame?.status === 'unsupported' ? 'Game build needs analysis' : frame?.status === 'error' ? 'Capture needs attention' : 'Waiting for a map');
  text('empty-copy', archive ? 'Load another .chunks file or select a live session.' : !online
    ? isTauri() && !import.meta.env.DEV ? 'Restart the desktop app to reconnect its local bridge.' : 'Start the development bridge and keep it running.'
    : frame?.message ?? 'Install the userscript from the menu, then reload the game.');
  $<HTMLButtonElement>('save-chunks').disabled = actionBusy || !(client?.tiles.length || client?.markers?.length);
  $<HTMLButtonElement>('export-png').disabled = actionBusy || !client?.tiles.length;
  $<HTMLButtonElement>('clear-chunks').disabled = actionBusy || !client?.tiles.length || (!archive && !online);
  $<HTMLButtonElement>('load-chunks').disabled = actionBusy || !mergeTarget() || !online;
  $<HTMLButtonElement>('preview-chunks').disabled = actionBusy;
  $<HTMLButtonElement>('follow').disabled = !frame?.player;
  $<HTMLButtonElement>('cleanup-sessions').disabled = actionBusy || !online;
  updateMarkerList();
  text('zoom', `${Math.round(view.scale * 100)}%`);
}

async function poll() {
  const started = performance.now();
  const epoch = pollEpoch;
  try {
    let next: Telemetry;
    const cursor = telemetryCache.cursor();
    if (isTauri()) next = await invoke<Telemetry>('read_telemetry', cursor);
    else {
      const query = new URLSearchParams();
      if (cursor.since !== undefined) query.set('since', String(cursor.since));
      if (cursor.serverId) query.set('serverId', cursor.serverId);
      const response = await fetch(`/api/telemetry?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Bridge offline. Start npm run dev or restart the bridge after updating it.');
      next = await response.json() as Telemetry;
    }
    if (disposed || epoch !== pollEpoch) return;
    telemetry = telemetryCache.apply(next);
    online = true;
    updateSources();
    if (!settingsLoaded && !settingsLoading && performance.now() >= settingsRetryAt) void readSettings();
  } catch (error) {
    if (disposed) return;
    online = false;
    drawNeeded = true;
    text('message', String(error).replace(/^Error: /, ''));
  } finally {
    if (!disposed) {
      // The animation loop refreshes status text at 250ms; terrain and pose
      // updates remain independent so 20ms mode does not rebuild UI constantly.
      pollTimer = setTimeout(() => void poll(), online ? Math.max(0, updateIntervalMs - (performance.now() - started)) : 1500);
    }
  }
}

async function bridgeAction<T>(command: string, route: string, body?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(command, body);
  const response = await fetch(`/api${route}`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    cache: 'no-store', signal: AbortSignal.timeout(3000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The bridge could not complete this action.');
  return result as T;
}

async function readSettings() {
  const epoch = settingsEpoch;
  settingsLoading = true;
  try {
    const settings = await bridgeAction<ViewerSettings>('read_settings', '/settings');
    if (![20, 100, 250, 500, 1000].includes(settings.updateIntervalMs)) throw new Error('Unsupported update interval.');
    if (disposed || epoch !== settingsEpoch) return;
    if (isTauri()) await invoke('set_window_always_on_top', { enabled: settings.alwaysOnTop ?? false });
    opacitySupported = await opacitySupport;
    if (disposed || epoch !== settingsEpoch) return;
    if (opacitySupported) await opacityController.set(settings.windowOpacity ?? 1);
    if (disposed || epoch !== settingsEpoch) return;
    applySettings(settings);
    settingsLoaded = true;
    updateSettingsControls();
  } catch { settingsRetryAt = performance.now() + 3000; }
  finally { settingsLoading = false; }
}

function applySettings(settings: ViewerSettings) {
  updateIntervalMs = settings.updateIntervalMs;
  showNotifications = settings.showNotifications ?? false;
  autoReconnect = settings.autoReconnect ?? true;
  alwaysOnTop = settings.alwaysOnTop ?? false;
  windowOpacity = settings.windowOpacity ?? 1;
  $<HTMLSelectElement>('update-rate').value = String(updateIntervalMs);
  $<HTMLInputElement>('show-notifications').checked = showNotifications;
  $<HTMLInputElement>('auto-reconnect').checked = autoReconnect;
  $<HTMLInputElement>('always-on-top').checked = alwaysOnTop;
  displayWindowOpacity(windowOpacity);
  if (!showNotifications && $('action-status').dataset.state !== 'error') $('action-status').hidden = true;
  updateSources();
}

function displayWindowOpacity(value: number) {
  const percentage = `${Math.round(value * 100)}%`;
  const slider = $<HTMLInputElement>('window-opacity');
  slider.value = String(value);
  slider.setAttribute('aria-valuetext', percentage);
  text('window-opacity-value', percentage);
}

function updateSettingsControls() {
  for (const id of ['update-rate', 'show-notifications', 'auto-reconnect', 'always-on-top', 'window-opacity']) {
    $<HTMLInputElement>(id).disabled = settingsSaving
      || (id === 'always-on-top' && !isTauri())
      || (id === 'window-opacity' && (!opacitySupported || !settingsLoaded));
  }
  text('window-opacity-help', opacitySupported
    ? 'Applies to the whole window, including the title bar.'
    : 'Available in the Windows desktop app.');
}

async function saveSettings(patch: Partial<ViewerSettings>) {
  if (settingsSaving) return;
  const previous = { updateIntervalMs, showNotifications, autoReconnect, alwaysOnTop, windowOpacity };
  settingsSaving = true;
  settingsEpoch++;
  opacityEditEpoch++;
  updateSettingsControls();
  try {
    if (patch.alwaysOnTop !== undefined && isTauri()) await invoke('set_window_always_on_top', { enabled: patch.alwaysOnTop });
    // Tauri can rebuild native window styles when changing always-on-top.
    if (opacitySupported && (patch.windowOpacity !== undefined || patch.alwaysOnTop !== undefined)) {
      await opacityController.set(patch.windowOpacity ?? windowOpacity);
    }
    const settings = await bridgeAction<ViewerSettings>('update_settings', '/settings', patch);
    if (disposed) return;
    applySettings(settings);
    settingsLoaded = true;
    showNotice(patch.updateIntervalMs !== undefined ? `Update interval set to ${updateIntervalMs} ms.` : 'Settings saved.');
  } catch (error) {
    if (patch.alwaysOnTop !== undefined && isTauri()) {
      await invoke('set_window_always_on_top', { enabled: previous.alwaysOnTop }).catch(() => {});
    }
    if (opacitySupported && (patch.windowOpacity !== undefined || patch.alwaysOnTop !== undefined)) {
      await opacityController.set(previous.windowOpacity).catch(() => {});
    }
    if (disposed) return;
    applySettings(previous);
    showNotice(String(error).replace(/^Error: /, ''), 'error');
  } finally {
    settingsSaving = false;
    if (!disposed) updateSettingsControls();
  }
}

async function action(message: string, operation: () => Promise<string>) {
  if (actionBusy) return;
  actionBusy = true;
  showNotice(message, 'busy');
  updateInfo();
  try {
    const result = await operation();
    if (disposed) return;
    showNotice(result);
  } catch (error) {
    if (disposed) return;
    showNotice(String(error).replace(/^Error: /, ''), 'error');
  } finally { actionBusy = false; if (!disposed) updateInfo(); }
}

function documentForSelection() {
  const client = activeClient();
  if (!(client?.tiles.length || client?.markers?.length)) throw new Error('There are no chunks or markers to save.');
  const archive = activeArchive();
  if (archive) return { ...archive.document, savedAt: new Date().toISOString() };
  if (!client) throw new Error('Choose a map first.');
  return createChunksDocument(client, (activeArchive()?.name ?? (client.frame.source === 'fixture' ? 'Local fixture' : 'DigDig map')).slice(0, 160));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function openArchive(contents: string, name: string) {
  // Validate the entire file before replacing any existing view.
  const parsed = parseChunksDocument(contents);
  if (!parsed.source.world && parsed.tiles.length) getChunksWorldBounds(parsed);
  const id = `archive-${crypto.randomUUID()}`;
  const client = archiveClient(parsed, id);
  const live = mergeTarget();
  const archive: Archive = { document: parsed, client, name,
    ...(live && compatiblePreview(parsed, live) ? { liveClientId: live.clientId } : {}) };
  archives.clear(); // One loaded document at a time bounds local-file memory.
  archives.set(id, archive);
  selected = id;
  updateSources();
  setFollow(false);
  fitSelection();
  return `Previewing ${name} · ${parsed.tiles.length.toLocaleString()} chunks, ${parsed.markers.length} markers. Live terrain is unchanged.`;
}

async function mergeArchive(contents: string, name: string) {
  const target = mergeTarget();
  if (!target || !online) throw new Error('Select a connected live session before loading chunks. Use Preview to view a file separately.');
  const document = parseChunksDocument(contents);
  await bridgeAction('merge_chunks', '/telemetry/merge', { clientId: target.clientId, document });
  pollEpoch++;
  telemetryCache.invalidate();
  selected = target.clientId;
  updateSources();
  return `Merged ${name} into the live session. Current live pixels take priority; saved markers are included.`;
}

function fitSelection() {
  const client = activeClient();
  if (!client) return;
  const fitted = fitMap(client.frame.world, client.tiles, size);
  if (fitted) view = fitted;
  viewInitialized = true;
}

$<HTMLSelectElement>('update-rate').addEventListener('change', event => {
  void saveSettings({ updateIntervalMs: Number((event.target as HTMLSelectElement).value) });
});
for (const [id, field] of [['show-notifications', 'showNotifications'], ['auto-reconnect', 'autoReconnect'], ['always-on-top', 'alwaysOnTop']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', event => { void saveSettings({ [field]: (event.target as HTMLInputElement).checked }); });
}
$<HTMLInputElement>('always-on-top').disabled = !isTauri();
$('always-on-top').title = isTauri() ? 'Keep this window above other windows' : 'Available in the Tauri desktop app';
$<HTMLInputElement>('window-opacity').addEventListener('input', event => {
  if (!opacitySupported || !settingsLoaded || settingsSaving) return;
  const value = Number((event.target as HTMLInputElement).value);
  const epoch = ++opacityEditEpoch;
  displayWindowOpacity(value);
  void opacityController.set(value).catch(async error => {
    if (disposed || epoch !== opacityEditEpoch || settingsSaving) return;
    displayWindowOpacity(windowOpacity);
    await opacityController.set(windowOpacity).catch(() => {});
    if (!disposed && epoch === opacityEditEpoch) showNotice(String(error).replace(/^Error: /, ''), 'error');
  });
});
$<HTMLInputElement>('window-opacity').addEventListener('change', event => {
  if (opacitySupported && settingsLoaded && !settingsSaving) {
    void saveSettings({ windowOpacity: Number((event.target as HTMLInputElement).value) });
  }
});
updateSettingsControls();
$('cleanup-sessions').addEventListener('click', () => void action('Removing inactive game sessions?', async () => {
  const result = await bridgeAction<{ removed: string[] }>('cleanup_sessions', '/telemetry/cleanup', {});
  pollEpoch++;
  telemetryCache.invalidate();
  return result.removed.length ? 'Removed ' + result.removed.length + ' inactive game sessions. The shared map is kept.' : 'No inactive game sessions to remove.';
}));

$('save-chunks').addEventListener('click', () => void action('Saving chunks…', async () => {
  const contents = stringifyChunksDocument(documentForSelection());
  if (isTauri()) {
    const path = await invoke<string | null>('save_chunks_file', { contents });
    return path ? `Saved ${path}` : 'Save cancelled.';
  }
  download(new Blob([contents], { type: 'application/json' }), `digdig-${new Date().toISOString().slice(0, 10)}.chunks`);
  return 'Chunks download started.';
}));

function chooseChunks(mode: 'merge' | 'preview') {
  pendingFileMode = mode;
  if (!isTauri()) { $<HTMLInputElement>('chunks-file').click(); return; }
  void action('Opening chunks…', async () => {
    const file = await invoke<{ path: string; contents: string } | null>('load_chunks_file');
    if (!file) return 'Open cancelled.';
    const name = file.path.split(/[\\/]/).at(-1) ?? 'Saved map';
    return mode === 'preview' ? openArchive(file.contents, name) : mergeArchive(file.contents, name);
  });
}
$('load-chunks').addEventListener('click', () => chooseChunks('merge'));
$('preview-chunks').addEventListener('click', () => chooseChunks('preview'));
$<HTMLInputElement>('chunks-file').addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const mode = pendingFileMode;
  void action('Reading chunks…', async () => {
    if (file.size > 64 * 1024 * 1024) throw new Error('The .chunks file is larger than 64 MiB.');
    const contents = await file.text();
    return mode === 'preview' ? openArchive(contents, file.name) : mergeArchive(contents, file.name);
  });
});

$('export-png').addEventListener('click', () => void action('Rendering terrain PNG…', async () => {
  const snapshot = documentForSelection();
  // Let the busy state paint before allocating the full-resolution PNG pixels.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const blob = await renderChunksPng(snapshot);
  if (blob.size > 64 * 1024 * 1024) throw new Error('The PNG exceeds the 64 MiB export limit. Save the .chunks file instead.');
  if (isTauri()) {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const path = await invoke<string | null>('save_png_file', { bytes });
    return path ? `Exported ${path}` : 'PNG export cancelled.';
  }
  download(blob, `digdig-${new Date().toISOString().slice(0, 10)}.png`);
  return 'Terrain PNG download started. Unknown areas are transparent.';
}));

function clearMap(sourceId = selected) {
  return action('Clearing map chunks…', async () => {
    const archive = archives.get(sourceId);
    const client = archive?.client ?? telemetry.clients.find(item => item.clientId === sourceId);
    if (!client) throw new Error('Choose a map first.');
    if (archive) {
      archive.document = { ...archive.document, tiles: [] };
      archive.client = archiveClient(archive.document, client.clientId);
      if (selected === sourceId) syncTiles(activeClient());
      return 'Cleared the loaded copy.';
    }
    await bridgeAction('clear_chunks', '/telemetry/clear', { clientId: client.clientId });
    pollEpoch++; // Do not apply a response already in flight from before the clear.
    telemetry = telemetryCache.clearTiles(client.clientId);
    if (selected === sourceId) syncTiles(activeClient());
    return 'Cleared this session’s chunks. Visible terrain will be scanned again.';
  });
}
$('clear-chunks').addEventListener('click', () => void clearMap());

function mapIdentity(client: TelemetryClient) {
  const frame = client.frame;
  return JSON.stringify([frame.source, frame.buildHash, frame.terrainMode, frame.world?.centerX, frame.world?.centerY]);
}

function requestClearMap() {
  const client = activeClient();
  if (actionBusy || clearDialog.open || !client?.tiles.length || (!activeArchive() && !online)) return;
  pendingClear = { sourceId: selected, serverId: activeArchive() ? null : telemetry.serverId, identity: mapIdentity(client) };
  const source = activeArchive()?.name ?? selector.selectedOptions[0]?.textContent ?? 'this session';
  text('clear-dialog-description', `Clear all ${client.tiles.length.toLocaleString()} chunks from ${source}? Markers will be kept.${activeArchive() ? ' The original file stays on disk.' : ' Visible terrain can be scanned again.'}`);
  hideMapMenu();
  setPanel();
  clearDialog.showModal();
  // Enter must choose Cancel if the shortcut was pressed accidentally.
  $('cancel-clear').focus();
}

$('cancel-clear').addEventListener('click', () => clearDialog.close());
clearDialog.addEventListener('close', () => { pendingClear = undefined; canvas.focus({ preventScroll: true }); });
$('confirm-clear').addEventListener('click', () => {
  const pending = pendingClear;
  const client = activeClient();
  clearDialog.close();
  pendingClear = undefined;
  if (!pending || !client || selected !== pending.sourceId
    || (pending.serverId !== null && pending.serverId !== telemetry.serverId)
    || mapIdentity(client) !== pending.identity) return;
  void clearMap(pending.sourceId);
});

function updateSelectionInfo() {
  const chunks = selection.tileKeys.size, markers = selection.markerIds.size;
  const hasSelection = chunks + markers > 0;
  text('selection-status', chunks || markers ? `${chunks} chunk${chunks === 1 ? '' : 's'} · ${markers} marker${markers === 1 ? '' : 's'} selected` : 'Nothing selected');
  $('selection-status').hidden = !hasSelection;
  $('menu-add-marker').hidden = hasSelection;
  $('menu-delete').hidden = !hasSelection;
  $('menu-deselect').hidden = !hasSelection;
  text('menu-delete', `Delete selected (${chunks + markers})`);
  $<HTMLButtonElement>('menu-delete').disabled = actionBusy || !(chunks || markers);
  $<HTMLButtonElement>('menu-deselect').disabled = !(chunks || markers);
  drawNeeded = true;
}

function updateMarkerList() {
  const markers = activeClient()?.markers ?? [];
  text('marker-count', String(markers.length));
  const signature = JSON.stringify([selected, markers, [...selection.markerIds]]);
  if (markerListSignature === signature) return;
  markerListSignature = signature;
  const list = $('marker-list');
  list.replaceChildren();
  if (!markers.length) {
    const empty = document.createElement('li');
    empty.className = 'marker-list-empty';
    empty.textContent = 'Right-click the map to leave a note.';
    list.append(empty);
  }
  for (const marker of markers) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.markerId = marker.id;
    button.setAttribute('aria-pressed', String(selection.markerIds.has(marker.id)));
    button.title = 'Select marker. Shift-click to add to the selection; Delete removes selected items.';
    const label = document.createElement('strong');
    label.textContent = marker.label;
    const position = document.createElement('small');
    position.textContent = `X ${number(marker.x, 0)} · Y ${number(marker.y, 0)}`;
    button.append(label, position);
    button.addEventListener('click', event => {
      const next = emptySelection(); next.markerIds.add(marker.id);
      selection = event.shiftKey ? toggleSelection(selection, next) : next;
      updateSelectionInfo(); updateMarkerList();
      canvas.focus({ preventScroll: true });
    });
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!selection.markerIds.has(marker.id)) { selection = emptySelection(); selection.markerIds.add(marker.id); }
      menuPoint = { x: marker.x, y: marker.y };
      // Position list actions beside the pointer on the same full-window map.
      const bounds = canvas.getBoundingClientRect();
      showMapMenu({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    });
    item.append(button); list.append(item);
  }
}

function hideMapMenu() { $('map-menu').hidden = true; }
function showMapMenu(point: Point) {
  setPanel();
  const menu = $('map-menu');
  updateSelectionInfo(); updateMarkerList();
  $<HTMLButtonElement>('menu-add-marker').disabled = actionBusy || !activeClient() || (!activeArchive() && !online);
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(point.x, size.width - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(point.y, size.height - menu.offsetHeight - 48))}px`;
  const first = menu.querySelector<HTMLButtonElement>('button:not([hidden]):not(:disabled)');
  first?.focus({ preventScroll: true });
}
function closeMarkerEditor() { markerDraft = undefined; $('marker-editor').hidden = true; }
function openMarkerEditor(point: Point) {
  if (selection.tileKeys.size || selection.markerIds.size) return;
  hideMapMenu();
  if (!activeClient()) return;
  markerDraft = { point, sourceId: selected };
  $('marker-editor').hidden = false;
  const input = $<HTMLInputElement>('marker-label'); input.value = '';
  text('marker-position', `X ${number(point.x, 0)} · Y ${number(point.y, 0)}`);
  input.focus();
}

async function deleteSelection() {
  hideMapMenu();
  canvas.focus({ preventScroll: true });
  const sourceId = selected;
  const tileKeys = [...selection.tileKeys], markerIds = [...selection.markerIds];
  if (!tileKeys.length && !markerIds.length) return;
  const archive = activeArchive();
  void action('Deleting selected map items…', async () => {
    if (archive) {
      archive.document = { ...archive.document,
        tiles: archive.document.tiles.filter(tile => !tileKeys.includes(tile.key)),
        markers: archive.document.markers.filter(marker => !markerIds.includes(marker.id)) };
      archive.client = archiveClient(archive.document, sourceId);
    } else {
      await bridgeAction('delete_map_items', '/telemetry/delete', { clientId: sourceId, tileKeys, markerIds });
      pollEpoch++;
      telemetry = telemetryCache.deleteItems(sourceId, tileKeys, markerIds);
    }
    if (selected === sourceId) { selection = emptySelection(); syncTiles(activeClient()); }
    return `Deleted ${tileKeys.length} chunks and ${markerIds.length} markers.${archive ? '' : ' Visible terrain can be scanned again.'}`;
  });
}

$('menu-add-marker').addEventListener('click', () => openMarkerEditor(menuPoint));
$('menu-delete').addEventListener('click', () => void deleteSelection());
$('menu-deselect').addEventListener('click', () => {
  selection = emptySelection(); hideMapMenu(); updateSelectionInfo(); updateMarkerList();
  canvas.focus({ preventScroll: true });
});
$('map-menu').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...$('map-menu').querySelectorAll<HTMLButtonElement>('button:not([hidden]):not(:disabled)')];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]!.focus();
});
$('cancel-marker').addEventListener('click', () => { closeMarkerEditor(); canvas.focus({ preventScroll: true }); });
$<HTMLInputElement>('show-markers').addEventListener('change', event => {
  showMarkers = (event.target as HTMLInputElement).checked;
  if (!showMarkers) selection.markerIds.clear();
  updateSelectionInfo(); updateMarkerList();
});
$('marker-editor').addEventListener('submit', event => {
  event.preventDefault();
  const draft = markerDraft;
  const label = $<HTMLInputElement>('marker-label').value.trim();
  if (!draft || !label) return;
  const archive = archives.get(draft.sourceId);
  void action('Saving marker…', async () => {
    const marker: MapMarker = validateMapMarker({ id: crypto.randomUUID(), ...draft.point, label });
    if (archive) {
      if (archive.document.markers.length >= 512) throw new Error('A map can contain at most 512 markers.');
      archive.document = { ...archive.document, markers: [...archive.document.markers, marker] };
      archive.client = archiveClient(archive.document, draft.sourceId);
    } else {
      await bridgeAction('upsert_marker', '/telemetry/markers', { clientId: draft.sourceId, marker });
      pollEpoch++;
      telemetry = telemetryCache.upsertMarker(draft.sourceId, marker);
    }
    closeMarkerEditor();
    canvas.focus({ preventScroll: true });
    if (selected === draft.sourceId) { selection = emptySelection(); selection.markerIds.add(marker.id); syncTiles(activeClient()); }
    return '';
  });
});

function grid() {
  const target = 90 / view.scale;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = power * (target / power > 5 ? 10 : target / power > 2 ? 5 : 2);
  const start = screenToWorld({ x: 0, y: 0 }, view, size);
  context.strokeStyle = '#1a2632';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = Math.ceil(start.x / step) * step; x < start.x + size.width / view.scale; x += step) {
    const screen = worldToScreen({ x, y: 0 }, view, size).x;
    context.moveTo(screen, 0); context.lineTo(screen, size.height);
  }
  for (let y = Math.ceil(start.y / step) * step; y < start.y + size.height / view.scale; y += step) {
    const screen = worldToScreen({ x: 0, y }, view, size).y;
    context.moveTo(0, screen); context.lineTo(size.width, screen);
  }
  context.stroke();
}

function traceWorldBoundary(frame: MapFrame) {
  const world = frame.world;
  if (!world) return false;
  context.beginPath();
  if (frame.source === 'game' && frame.terrainMode === 'materials-v1') {
    const center = worldToScreen({ x: world.centerX, y: world.centerY }, view, size);
    context.arc(center.x, center.y, world.radius * view.scale, 0, Math.PI * 2);
  } else {
    const corner = worldToScreen({ x: world.centerX - world.radius, y: world.centerY - world.radius }, view, size);
    const diameter = world.radius * 2 * view.scale;
    context.rect(corner.x, corner.y, diameter, diameter);
  }
  return true;
}

function drawWorld(frame: MapFrame) {
  if (traceWorldBoundary(frame)) {
    context.fillStyle = frame.terrainMode === 'materials-v1' ? unknownPattern : '#101e27';
    context.fill();
  }
  context.imageSmoothingEnabled = false;
  for (const { tile, canvas: image } of renderedTiles.values()) {
    const point = worldToScreen(tile, view, size);
    const width = tile.width * view.scale;
    const height = tile.height * view.scale;
    if (point.x > size.width || point.y > size.height || point.x + width < 0 || point.y + height < 0) continue;
    context.drawImage(image, point.x, point.y, width, height);
    if (showTileGrid && width >= 6) {
      context.strokeStyle = '#e9f9df50'; context.lineWidth = 0.5;
      context.strokeRect(point.x, point.y, width, height);
    }
    if (selection.tileKeys.has(tile.key)) {
      context.fillStyle = '#8cc5ff30'; context.fillRect(point.x, point.y, width, height);
      context.strokeStyle = '#a4d4ff'; context.lineWidth = 2;
      context.strokeRect(point.x + 1, point.y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    }
  }
  // Draw the current boundary above the historical scan, without clipping or
  // deleting discoveries made while the world was larger.
  if (traceWorldBoundary(frame)) {
    context.strokeStyle = '#83b49d';
    context.lineWidth = 1.5;
    context.stroke();
  }
  const camera = frame.camera;
  if (camera?.scale && camera.scale > 0) {
    const width = camera.width / camera.scale * view.scale;
    const height = camera.height / camera.scale * view.scale;
    const center = worldToScreen(camera, view, size);
    context.strokeStyle = '#aab9ce55';
    context.setLineDash([5, 6]);
    context.strokeRect(center.x - width / 2, center.y - height / 2, width, height);
    context.setLineDash([]);
  }
  if (frame.player) {
    const point = worldToScreen(frame.player, view, size);
    context.fillStyle = '#b8ef8b20'; context.beginPath(); context.arc(point.x, point.y, 19, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#c4f7a0'; context.strokeStyle = '#0b1118'; context.lineWidth = 3;
    context.beginPath(); context.arc(point.x, point.y, 6, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = '#ddf7d0'; context.font = '11px ui-monospace, Consolas, monospace';
    context.fillText('PLAYER / CAMERA', point.x + 14, point.y - 12);
  }
  if (showMarkers) for (const marker of activeClient()?.markers ?? []) {
    const point = worldToScreen(marker, view, size);
    if (point.x < -220 || point.x > size.width + 20 || point.y < -30 || point.y > size.height + 30) continue;
    const chosen = selection.markerIds.has(marker.id);
    context.fillStyle = chosen ? '#a4d4ff' : '#ffc979';
    context.strokeStyle = '#111a22'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(point.x, point.y - 9); context.lineTo(point.x + 8, point.y);
    context.lineTo(point.x, point.y + 9); context.lineTo(point.x - 8, point.y); context.closePath();
    context.fill(); context.stroke();
    if (chosen) { context.strokeStyle = '#a4d4ff'; context.beginPath(); context.arc(point.x, point.y, 14, 0, Math.PI * 2); context.stroke(); }
    context.font = '11px "Segoe UI", sans-serif';
    const label = marker.label.length > 40 ? `${marker.label.slice(0, 39)}…` : marker.label;
    const width = context.measureText(label).width;
    context.fillStyle = '#101923e8'; context.fillRect(point.x + 12, point.y - 12, width + 10, 21);
    context.fillStyle = chosen ? '#b9ddff' : '#ffd79b'; context.fillText(label, point.x + 17, point.y + 2);
  }
}

let lastInfo = 0;
let lastPaintedFrame: MapFrame | undefined;
function render(time: number) {
  const frame = activeClient()?.frame;
  // Also detects a preview's linked pose aging out between polls. New timestamps
  // and equivalent frame clones do not require repainting an unchanged map.
  if (!sameMapAppearance(frame, lastPaintedFrame)) drawNeeded = true;
  if (follow && frame?.player && !dragging?.box) {
    if (view.x !== frame.player.x || view.y !== frame.player.y) drawNeeded = true;
    view.x = frame.player.x; view.y = frame.player.y;
  }
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    drawNeeded = true;
  }
  size = { width, height };
  if (drawNeeded) {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#0c151e'; context.fillRect(0, 0, width, height);
    grid();
    if (frame) drawWorld(frame);
    if (dragging?.box && dragging.moved) {
      const start = dragging.start, end = dragging.current;
      context.fillStyle = '#8cc5ff20'; context.strokeStyle = '#a4d4ff'; context.lineWidth = 1;
      context.setLineDash([5, 4]);
      context.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
      context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      context.setLineDash([]);
    }
    drawNeeded = false;
    lastPaintedFrame = frame;
  }
  if (pointer) {
    const point = screenToWorld(pointer, view, size);
    text('cursor', `X ${number(point.x, 0)}  ·  Y ${number(point.y, 0)}`);
  }
  if (time - lastInfo > 250) { updateInfo(); lastInfo = time; }
  animation = requestAnimationFrame(render);
}

function zoom(factor: number, point = { x: size.width / 2, y: size.height / 2 }) {
  // Follow keeps its camera-centered anchor; free panning zooms around the mouse.
  if (follow) point = { x: size.width / 2, y: size.height / 2 };
  view = zoomAt(view, point, factor, size);
  drawNeeded = true;
}

selector.addEventListener('change', () => { selected = selector.value; syncTiles(activeClient()); updateInfo(); });
$('tools-toggle').addEventListener('click', () => setToolsOpen(!toolsOpen));
$('pan-mode').addEventListener('click', () => { setInteractionMode('pan'); canvas.focus({ preventScroll: true }); });
$('select-mode').addEventListener('click', () => { setInteractionMode('select'); canvas.focus({ preventScroll: true }); });
for (const panel of panels) {
  $(`${panel}-toggle`).addEventListener('click', () => setPanel(openPanel === panel ? undefined : panel));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-panel-close]')) {
  button.addEventListener('click', () => setPanel(undefined, true));
}
setInteractionMode('pan');
$('follow').addEventListener('click', () => setFollow(!follow));
$('fit').addEventListener('click', () => {
  setFollow(false);
  fitSelection();
});
$<HTMLInputElement>('tile-grid').addEventListener('change', event => { showTileGrid = (event.target as HTMLInputElement).checked; drawNeeded = true; });
$('zoom-in').addEventListener('click', () => zoom(1.4));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.4));
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  hideMapMenu();
  zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), { x: event.offsetX, y: event.offsetY });
}, { passive: false });
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  hideMapMenu();
  canvas.focus({ preventScroll: true });
  const start = { x: event.offsetX, y: event.offsetY };
  dragging = { start, last: start, current: start, worldStart: screenToWorld(start, view, size),
    box: !spacePan && (interactionMode === 'select' || event.shiftKey), moved: false,
    additive: event.ctrlKey || event.metaKey || (interactionMode === 'select' && event.shiftKey) };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  pointer = { x: event.offsetX, y: event.offsetY };
  if (dragging) {
    dragging.current = pointer;
    if (!dragging.moved && Math.hypot(pointer.x - dragging.start.x, pointer.y - dragging.start.y) < 4) return;
    dragging.moved = true;
    if (!dragging.box) {
      setFollow(false);
      view.x -= (pointer.x - dragging.last.x) / view.scale;
      view.y -= (pointer.y - dragging.last.y) / view.scale;
    }
    drawNeeded = true;
    dragging.last = pointer;
  }
});
canvas.addEventListener('pointerup', event => {
  const drag = dragging;
  dragging = undefined;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!drag) return;
  const client = activeClient();
  const markers = showMarkers ? client?.markers ?? [] : [];
  const point = screenToWorld({ x: event.offsetX, y: event.offsetY }, view, size);
  if (drag.box && drag.moved) {
    const next = selectMapRectangle(drag.worldStart, point, client?.tiles ?? [], markers);
    if (drag.additive) {
      for (const key of next.tileKeys) selection.tileKeys.add(key);
      for (const id of next.markerIds) selection.markerIds.add(id);
    } else selection = next;
  } else if (drag.box && !drag.moved) {
    const next = hitMap(point, client?.tiles ?? [], markers, 14 / view.scale);
    selection = event.shiftKey || event.ctrlKey || event.metaKey ? toggleSelection(selection, next) : next;
  }
  updateSelectionInfo(); updateMarkerList();
});
canvas.addEventListener('pointercancel', () => { dragging = undefined; drawNeeded = true; });
canvas.addEventListener('pointerleave', () => { pointer = undefined; text('cursor', '—'); });
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  menuPoint = screenToWorld({ x: event.offsetX, y: event.offsetY }, view, size);
  // Right-click acts on the current selection. With no selection, the clicked
  // world position is available for a marker even when terrain lies beneath it.
  showMapMenu({ x: event.offsetX, y: event.offsetY });
});
function documentPointerDown(event: PointerEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('#map-menu')) hideMapMenu();
  if (event.target instanceof Element && openPanel
    && !event.target.closest(`#${openPanel}-panel, #${openPanel}-toggle`)) setPanel();
}
function documentKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  const target = event.target;
  const editable = target instanceof HTMLElement && (target.isContentEditable
    || Boolean(target.closest('input, textarea, select, [role="textbox"]')));
  const key = event.key.toLowerCase();
  const control = event.ctrlKey && !event.altKey && !event.metaKey;
  const shortcut = control && (key === 's' || (!event.shiftKey && (key === 'o' || key === 'a'))
    || (event.shiftKey && key === 'delete'));

  // Keep native text selection in marker notes and other form fields.
  if (shortcut && !(key === 'a' && editable)) {
    event.preventDefault();
    if (event.repeat || actionBusy || clearDialog.open || markerDraft) return;
    if (key === 's') {
      $<HTMLButtonElement>(event.shiftKey ? 'export-png' : 'save-chunks').click();
    } else if (key === 'o') {
      const live = mergeTarget();
      chooseChunks(online && live?.frame.world && live.frame.status !== 'unsupported' ? 'merge' : 'preview');
    } else if (key === 'a') {
      const client = activeClient();
      selection = {
        tileKeys: new Set(client?.tiles.map(tile => tile.key) ?? []),
        markerIds: new Set(showMarkers ? client?.markers?.map(marker => marker.id) ?? [] : []),
      };
      hideMapMenu(); updateSelectionInfo(); updateMarkerList();
      canvas.focus({ preventScroll: true });
    } else if (!editable) requestClearMap();
    return;
  }
  // Let the modal handle Tab, Enter and Escape. No map action may run behind it.
  if (clearDialog.open) return;
  if (event.key === 'Escape') {
    releaseTemporaryPan();
    const hadPanel = openPanel !== undefined;
    setPanel(undefined, true);
    hideMapMenu(); closeMarkerEditor(); selection = emptySelection(); updateSelectionInfo(); updateMarkerList();
    if (!hadPanel) canvas.focus({ preventScroll: true });
  }
  if (editable) return;
  if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && !markerDraft) {
    if (key === 'f' || event.key === 'Home') {
      event.preventDefault();
      if (!event.repeat) $<HTMLButtonElement>(key === 'f' ? 'follow' : 'fit').click();
      return;
    }
    if ((event.code === 'Space' || event.key === ' ') && interactionMode === 'select'
      && (target === canvas || target === document.body)) {
      event.preventDefault();
      spacePan = true;
      updateInteractionHint();
      return;
    }
  }
  if (event.key === 'Delete' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey
    && !event.repeat && (selection.tileKeys.size || selection.markerIds.size)) {
    event.preventDefault(); void deleteSelection();
  }
  if (event.key === 'ContextMenu' && target === canvas && pointer) {
    event.preventDefault(); menuPoint = screenToWorld(pointer, view, size); showMapMenu(pointer);
  }
}
function releaseTemporaryPan() {
  if (!spacePan) return;
  spacePan = false;
  updateInteractionHint();
}
function documentKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space' || event.key === ' ') releaseTemporaryPan();
}
function windowBlur() {
  releaseTemporaryPan();
  dragging = undefined;
  drawNeeded = true;
}
document.addEventListener('pointerdown', documentPointerDown);
document.addEventListener('keydown', documentKeyDown);
document.addEventListener('keyup', documentKeyUp);
window.addEventListener('blur', windowBlur);
void poll();
animation = requestAnimationFrame(render);
if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true;
  userscriptControls.dispose();
  storageControls.dispose();
  layoutAnalysis.dispose();
  if (clearDialog.open) clearDialog.close();
  clearTimeout(pollTimer);
  cancelAnimationFrame(animation);
  document.removeEventListener('pointerdown', documentPointerDown);
  document.removeEventListener('keydown', documentKeyDown);
  document.removeEventListener('keyup', documentKeyUp);
  window.removeEventListener('blur', windowBlur);
});
