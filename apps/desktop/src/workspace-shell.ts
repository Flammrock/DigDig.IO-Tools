import { appVersion } from './app-version.ts';

// Local SVGs stay crisp at any display scale and work offline.
const paths = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  script: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-17-2 20"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  pan: '<path d="M9 11V5a2 2 0 0 1 4 0v6m0-2V4a2 2 0 0 1 4 0v7m0-2a2 2 0 0 1 4 0v5c0 5-3 8-7 8h-1c-3 0-4-2-6-4l-3-4a2 2 0 0 1 3-3l2 2"/>',
  select: '<path d="M9 3H5a2 2 0 0 0-2 2v4m12-6h4a2 2 0 0 1 2 2v4M3 15v4a2 2 0 0 0 2 2h4m12-6v4a2 2 0 0 1-2 2h-4"/><path d="m9 8 7 5-4 1-1 4-2-10Z"/>',
  follow: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  files: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 7h5l2 3h11l-2 10H3a1 1 0 0 1-1-1L3 7Z"/>',
  marker: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><rect x="7" y="3" width="4" height="6" rx="1"/><rect x="14" y="9" width="4" height="6" rx="1"/><rect x="6" y="15" width="4" height="6" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  save: '<path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
  load: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  preview: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  clear: '<path d="M4 7h16M10 3h4l1 4H9l1-4Zm-4 4 1 14h10l1-14M10 11v6m4-6v6"/>',
};
const icon = (name: keyof typeof paths) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
const tool = (id: string, name: keyof typeof paths, label: string, attributes = '', shortcut = '') => `<div class="tool"><button id="${id}" class="icon-button" type="button" aria-label="${label}" aria-describedby="${id}-tip" ${attributes}>${icon(name)}</button><span id="${id}-tip" class="tool-tip" role="tooltip">${label}${shortcut ? ` <kbd>${shortcut}</kbd>` : ''}</span></div>`;
const panelHeading = (id: string, title: string, eyebrow: string) => `<div class="panel-heading"><div><span class="eyebrow">${eyebrow}</span><h2 id="${id}-title">${title}</h2></div><button type="button" class="panel-close icon-button" data-panel-close="${id}" aria-label="Close ${title.toLowerCase()}">${icon('close')}</button></div>`;
const versionTool = tool('info-toggle', 'info', `Version ${appVersion} · Map information`, 'aria-controls="info-panel" aria-expanded="false"');

export const workspaceMarkup = `
<main class="map-pane" aria-label="Map Observatory">
  <canvas id="map" tabindex="0" data-mode="pan" aria-label="Captured terrain and player position. Use Pan or Select from the map tools. Right-click for actions."></canvas>
  <nav class="map-tools" aria-label="Map tools">
    ${tool('tools-toggle', 'menu', 'Open map tools', 'aria-controls="map-tool-items" aria-expanded="false"')}
    <div id="map-tool-items" class="map-tool-items" hidden>
    <div class="tool-group" role="group" aria-label="Interaction mode">${tool('pan-mode', 'pan', 'Pan map', 'aria-pressed="true"')}${tool('select-mode', 'select', 'Select chunks and markers', 'aria-pressed="false"')}</div>
    <div class="tool-group" role="group" aria-label="Map view">${tool('follow', 'follow', 'Follow player / camera', 'aria-pressed="true" aria-keyshortcuts="f"', 'F')}${tool('fit', 'fit', 'Fit entire map', 'aria-keyshortcuts="Home"', 'Home')}</div>
    <div class="tool-group" role="group" aria-label="Map panels">${tool('files-toggle', 'files', 'Map files', 'aria-controls="files-panel" aria-expanded="false"')}${tool('markers-toggle', 'marker', 'Saved markers', 'aria-controls="markers-panel" aria-expanded="false"')}${tool('userscript-toggle', 'script', 'Install userscript', 'aria-controls="userscript-panel" aria-expanded="false"')}${tool('settings-toggle', 'settings', 'Session and settings', 'aria-controls="settings-panel" aria-expanded="false"')}${versionTool}</div>
    </div>
  </nav>

  <section id="files-panel" class="map-panel" role="dialog" aria-labelledby="files-panel-title" tabindex="-1" hidden>
    ${panelHeading('files-panel', 'Map files', 'YOUR EXPLORATION')}
    <div class="file-actions">
      <button id="save-chunks" type="button" aria-keyshortcuts="Control+s" disabled>${icon('save')}<span><strong>Save .chunks <kbd>Ctrl+S</kbd></strong><small>Keep terrain and markers</small></span></button>
      <button id="load-chunks" type="button" aria-keyshortcuts="Control+o">${icon('load')}<span><strong>Load .chunks <kbd>Ctrl+O</kbd></strong><small>Merge into the live session</small></span></button>
      <button id="preview-chunks" type="button">${icon('preview')}<span><strong>Preview .chunks</strong><small>View a separate saved map</small></span></button>
      <button id="export-png" type="button" aria-keyshortcuts="Control+Shift+s" disabled>${icon('image')}<span><strong>Export PNG <kbd>Ctrl+Shift+S</kbd></strong><small>Original terrain pixels, uncompressed</small></span></button>
      <button id="clear-chunks" class="danger-action" type="button" aria-keyshortcuts="Control+Shift+Delete" disabled>${icon('clear')}<span><strong>Clear chunks</strong><small>Keep markers; visible terrain rescans</small><small><kbd>Ctrl+Shift+Delete</kbd> asks first</small></span></button>
    </div><input id="chunks-file" type="file" accept=".chunks,application/json" hidden />
  </section>

  <section id="userscript-panel" class="map-panel" role="dialog" aria-labelledby="userscript-panel-title" tabindex="-1" hidden>
    ${panelHeading('userscript-panel', 'Userscript', 'CONNECT YOUR BROWSER')}
    <p class="control-note">Install Tampermonkey in your browser, then install this app’s userscript. Keep the app open while playing.</p>
    <p class="control-note"><strong>Brave / Chrome:</strong> enable <strong>Allow User Scripts</strong> in Tampermonkey’s extension settings. This can be off by default.</p>
    <div class="file-actions userscript-actions">
      <button id="install-userscript" type="button">${icon('script')}<span><strong>Install userscript</strong><small>Open the installer in your browser</small></span></button>
      <button id="copy-userscript" type="button">${icon('copy')}<span><strong>Copy to clipboard</strong><small>Paste into Tampermonkey’s script editor</small></span></button>
      <button id="export-userscript" type="button">${icon('save')}<span><strong>Export .user.js</strong><small>Save the script to a file</small></span></button>
    </div>
    <p id="userscript-details" class="control-note"></p>
    <p class="control-note">Reload the game after installing. Enable only one DigDig userscript at a time.</p>
    <div class="divider"></div>
    <details class="browser-help">
      <summary>Userscript troubleshooting</summary>
      <ol>
        <li>In Brave, open <strong>brave://extensions</strong> (Chrome: <strong>chrome://extensions</strong>), choose <strong>Tampermonkey → Details</strong>, enable <strong>Allow User Scripts</strong>, then reload the game.</li>
        <li>Keep this app open. Install its paired userscript and enable only one DigDig script. For the generic file, use Tampermonkey’s <strong>DigDig: Pair with desktop</strong> menu.</li>
        <li>Allow this userscript to connect to <strong>127.0.0.1</strong> if Tampermonkey asks.</li>
        <li>If connected but still waiting for WASM, try <strong>Content Script API → UserScripts API Dynamic</strong> in Tampermonkey’s advanced settings on Brave/Chrome, then reload the game.</li>
      </ol>
      <p>The installed script also has a <strong>DigDig: Help / troubleshooting</strong> menu. If the browser prevents scripts from running, read the guide here or at the top of the script source instead.</p>
    </details>
    <p id="userscript-result" class="control-note" role="status" aria-live="polite" hidden></p>
  </section>

  <section id="markers-panel" class="map-panel" role="dialog" aria-labelledby="markers-panel-title" tabindex="-1" hidden>
    ${panelHeading('markers-panel', 'Saved markers', 'PLACES TO RETURN TO')}
    <div class="panel-section-heading"><span class="panel-caption">On this map</span><span id="marker-count" class="badge">0</span></div>
    <label class="checkbox"><input id="show-markers" type="checkbox" checked /> Show markers on map</label>
    <p class="control-note">Right-click with nothing selected to add a marker at that spot.</p>
    <ul id="marker-list" class="marker-list" aria-label="Saved markers"></ul>
  </section>

  <section id="settings-panel" class="map-panel" role="dialog" aria-labelledby="settings-panel-title" tabindex="-1" hidden>
    ${panelHeading('settings-panel', 'Session & settings', 'LIVE CAPTURE')}
    <label class="select-label" for="source">Live session or saved map</label>
    <select id="source"><option value="">Waiting for a userscript…</option></select>
    <div id="source-kind" class="source-kind">No source connected</div>
    <p class="control-note">Game tabs and reloads share one map. Fixtures and saved previews stay separate.</p>
    <label class="checkbox"><input id="auto-reconnect" type="checkbox" checked /> Automatically reconnect</label>
    <p class="control-note">Switch to a new game when the selected session stops. Remove the inactive session and keep the shared map.</p>
    <button id="cleanup-sessions" class="settings-action" type="button">${icon('clear')}<span>Remove inactive game sessions</span></button>
    <div class="divider"></div>
    <label class="select-label" for="update-rate">Update interval</label>
    <select id="update-rate"><option value="20">20 ms · Live</option><option value="100" selected>100 ms · Responsive</option><option value="250">250 ms · Balanced</option><option value="500">500 ms · Low activity</option><option value="1000">1 second · Minimal activity</option></select>
    <p class="control-note">Applies to capture and the live viewer.</p>
    <label class="checkbox"><input id="tile-grid" type="checkbox" /> Show chunk boundaries</label>
    <label class="checkbox"><input id="always-on-top" type="checkbox" /> Always on top</label>
    <p class="control-note">Keep the desktop window above other apps.</p>
    <label class="opacity-label select-label" for="window-opacity"><span>Window opacity</span><output id="window-opacity-value" for="window-opacity">100%</output></label>
    <input id="window-opacity" class="opacity-slider" type="range" min="0.2" max="1" step="0.01" value="1" aria-valuetext="100%" aria-describedby="window-opacity-help" disabled />
    <p id="window-opacity-help" class="control-note">Available in the Windows desktop app.</p>
    <label class="checkbox"><input id="show-notifications" type="checkbox" /> Show action notifications</label>
    <p class="control-note">Show progress and success messages. Errors are always shown.</p>
    <div class="divider"></div>
    <p class="interaction-guide"><strong>Pan</strong> Drag to move around.<br /><strong>Select</strong> Click a chunk or drag over an area.<br /><strong>Hold Space</strong> Temporarily pan while in Select mode.<br /><strong>Shift-click</strong> Add or remove a selection.<br /><strong>Scroll</strong> Zoom while keeping Follow active.<br /><strong>Right-click</strong> Open actions at the cursor.</p>
    <div class="divider"></div>
    <h3 class="shortcuts-title">Keyboard shortcuts</h3>
    <dl class="shortcut-list">
      <div><dt>Toggle Follow</dt><dd><kbd>F</kbd></dd></div>
      <div><dt>Fit entire map</dt><dd><kbd>Home</kbd></dd></div>
      <div><dt>Temporarily pan in Select mode</dt><dd><kbd>Hold Space</kbd></dd></div>
      <div><dt>Save .chunks</dt><dd><kbd>Ctrl+S</kbd></dd></div>
      <div><dt>Export PNG</dt><dd><kbd>Ctrl+Shift+S</kbd></dd></div>
      <div><dt>Open .chunks</dt><dd><kbd>Ctrl+O</kbd></dd></div>
      <div><dt>Select all map items</dt><dd><kbd>Ctrl+A</kbd></dd></div>
      <div><dt>Clear map, with confirmation</dt><dd><kbd>Ctrl+Shift+Delete</kbd></dd></div>
    </dl>
    <p class="control-note">Select all includes every chunk and visible marker. In a text field, Ctrl+A selects its text.</p>
  </section>

  <section id="info-panel" class="map-panel" role="dialog" aria-labelledby="info-panel-title" tabindex="-1" hidden>
    ${panelHeading('info-panel', 'Map Observatory', 'DIGDIG TOOLS')}
    <div class="app-version-card"><div><span class="eyebrow">APP VERSION</span><strong id="app-version">${appVersion}</strong></div><span>Flammrock</span></div>
    <dl class="metrics"><div><dt>Selected userscript</dt><dd id="userscript-version">Not connected</dd></div></dl>
    <div class="divider"></div>
    <section class="app-storage" aria-label="App data">
      <span class="panel-caption">APP DATA</span>
      <code id="app-data-path" class="storage-path" hidden></code>
      <p id="app-storage-note" class="control-note">Loading the app data location…</p>
      <button id="open-app-data" class="settings-action" type="button" disabled>${icon('files')}<span id="open-app-data-label">Open in Explorer</span></button>
      <details id="app-storage-locations" class="storage-locations" hidden>
        <summary>File locations</summary>
        <dl><div><dt>Settings</dt><dd><code id="app-settings-path" class="storage-path"></code></dd></div><div><dt>Layout cache</dt><dd><code id="app-cache-path" class="storage-path"></code></dd></div><div><dt>Reports</dt><dd><code id="app-reports-path" class="storage-path"></code></dd></div></dl>
      </details>
      <p id="app-storage-result" class="control-note" role="status" aria-live="polite" hidden></p>
    </section>
    <div class="divider"></div>
    <div class="panel-section-heading"><span id="map-tag" class="panel-caption">TERRAIN CANVAS</span><span id="frame-state" class="badge">WAITING</span></div>
    <p id="message" class="message">Keep this app open and load the game with the userscript installed.</p>
    <dl class="metrics">
      <div><dt>Player / camera X</dt><dd id="player-x">—</dd></div><div><dt>Player / camera Y</dt><dd id="player-y">—</dd></div>
      <div><dt>Normalized X / Y</dt><dd id="normalized">—</dd></div><div><dt>Map diameter</dt><dd id="map-size">—</dd></div>
      <div><dt>Captured chunks</dt><dd id="tile-count">0</dd></div><div id="known-pixels-row" hidden><dt>Known pixels</dt><dd id="known-pixels">0</dd></div>
      <div><dt>Last frame</dt><dd id="frame-age">—</dd></div>
    </dl>
    <p id="map-boundary-note" class="control-note"></p>
    <div class="divider"></div>
    <div class="terrain-legend"><i class="legend-dot"></i> Player / camera <i class="legend-square"></i><span id="terrain-legend">Observed terrain</span></div>
    <p id="scan-hint" class="control-note">Terrain appears as it is observed.</p>
    <details id="material-key" class="material-key" hidden><summary>Material key</summary><div id="material-swatches" class="material-swatches"></div><p>Patterned areas have not been identified.</p></details>
    <div class="build-info"><span class="eyebrow">BUILD FINGERPRINT</span><code id="build-hash">Awaiting capture</code><span id="transport" class="transport"></span></div>
  </section>

  <div class="map-status"><span id="source-tag" class="source-tag">NO SIGNAL</span><span id="connection" class="connection" role="status"><i></i><span>Connecting</span></span></div>
  <div id="empty" class="empty"><div class="empty-reticle" aria-hidden="true">${icon('follow')}</div><h1 id="empty-title">Waiting for a map</h1><p id="empty-copy">Your captured terrain will appear here.<br />No game data has arrived yet.</p></div>
  <div class="map-readout"><span id="mode-hint">Pan · Drag to move</span><span id="selection-status" aria-live="polite">Nothing selected</span></div>
  <div id="action-status" class="action-status" role="status" aria-live="polite" hidden><span id="action-message"></span><button id="dismiss-notification" class="icon-button" type="button" aria-label="Dismiss notification">${icon('close')}</button></div>
  <div class="zoom-cluster"><span id="cursor" class="cursor-readout">—</span><div class="zoom-controls">${tool('zoom-out', 'minus', 'Zoom out')}<span id="zoom">100%</span>${tool('zoom-in', 'plus', 'Zoom in')}</div></div>
  <div id="map-menu" class="map-menu" role="menu" aria-label="Map actions" hidden>
    <button id="menu-add-marker" type="button" role="menuitem">Add marker here</button><button id="menu-delete" type="button" role="menuitem">Delete selected items</button><button id="menu-deselect" type="button" role="menuitem">Deselect all</button>
  </div>
  <form id="marker-editor" class="marker-editor" hidden>
    <span class="eyebrow">A PLACE TO REMEMBER</span><label for="marker-label">Marker note</label>
    <input id="marker-label" maxlength="240" required placeholder="Explore here when this ore respawns" autocomplete="off" />
    <p id="marker-position"></p><div><button type="submit">Save marker</button><button id="cancel-marker" type="button">Cancel</button></div>
  </form>
  <dialog id="clear-dialog" class="confirm-dialog" aria-labelledby="clear-dialog-title" aria-describedby="clear-dialog-description">
    <span class="eyebrow">CLEAR CAPTURED TERRAIN</span>
    <h2 id="clear-dialog-title">Clear map?</h2>
    <p id="clear-dialog-description">Clear the chunks from this map? Your markers will be kept.</p>
    <div class="confirm-actions"><button id="cancel-clear" type="button" autofocus>Cancel</button><button id="confirm-clear" type="button" class="confirm-danger">Clear chunks</button></div>
  </dialog>
</main>`;
