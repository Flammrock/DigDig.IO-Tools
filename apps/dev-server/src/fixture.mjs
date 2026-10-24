import { runMapFixture } from './map-fixture.mjs';

export function renderFixture(nonce) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DigDig userscript smoke test</title>
  <script nonce="${nonce}">
    // Start in the document head so the userscript must capture this at document-start.
    const fixtureModule = WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]));
    const domReady = document.readyState === 'loading'
      ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
      : Promise.resolve();
    Promise.all([fixtureModule, domReady]).then(([{ instance }]) => {
      const memory = instance.exports.memory;
      const status = document.getElementById('status');
      const grow = document.getElementById('grow');
      const update = () => { status.textContent = 'WASM ready: exported memory = ' + memory.buffer.byteLength + ' bytes.'; };
      update();
      grow.disabled = false;
      grow.addEventListener('click', () => {
        memory.grow(1);
        update();
      });
    }).catch(async (error) => {
      await domReady;
      document.getElementById('status').textContent = 'WASM fixture failed: ' + String(error);
    });
  </script>
</head>
<body>
  <h1>DigDig userscript smoke test</h1>
  <p>This page creates a tiny local WASM module with one exported memory. It runs no game code.</p>
  <ol>
    <li><a href="/install.user.js">Install the development userscript</a>, then reload this page.</li>
    <li>Keep the development process running and request a report with <code>npm run report</code>.</li>
    <li>Check the new <code>reports/live/*.txt</code> file for one captured instance and a memory of 65536 bytes.</li>
    <li>Grow the memory below, request another report, and check for 131072 bytes.</li>
  </ol>
  <p id="status" role="status">Creating WASM fixture...</p>
  <button id="grow" type="button" disabled>Grow memory by one page (64 KiB)</button>
  <p>Editing the diagnostic runtime should update it automatically. This page reloads only when requested.</p>
  <h2>Moving terrain test</h2>
  <p>Synthetic 64-by-64 tiles on a 1024-unit grid. Select <strong>Local fixture</strong> in the desktop viewer. The white marker should stay aligned with the same terrain there.</p>
  <button id="pause-map" type="button">Pause camera</button>
  <p><canvas id="terrain" width="960" height="600" style="max-width:100%;background:#151d26"></canvas></p>
  <pre id="map-state" hidden></pre>
  <script nonce="${nonce}">(${runMapFixture.toString()})();</script>
</body>
</html>`;
}
