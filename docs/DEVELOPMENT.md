# Development

[Back to the project](../README.md) · [Build and release](RELEASING.md)

The workspace uses npm for dependencies, Nx for tasks, TypeScript for the userscript and canvas viewer, and Rust/Tauri for the desktop host. Run the commands below from the repository root.

## Set up Windows development

Install Node.js **24** and npm **11**; the repository pins **npm 11.9.0** in [`package.json`](../package.json). Desktop development also requires Rust with the MSVC toolchain, Microsoft C++ Build Tools with **Desktop development with C++**, and Microsoft Edge WebView2. Follow the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows) for the native dependencies. Windows x64 is the release target configured in this repository.

```powershell
npm install --global npm@11.9.0
npm ci
npm run dev:desktop
```

`dev:desktop` starts the userscript compiler and local Node bridge, or reuses a compatible bridge already running on port **4317**, then opens Tauri. The first Rust build can take a while. Keep this terminal running; Ctrl+C stops the processes it started. A bridge it reused remains running in its original terminal.

## Connect a browser

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser. Disable the release DigDig userscript while using the development one.
2. Open [the development userscript installer](http://127.0.0.1:4317/install.user.js) and install it. Allow its connection to `127.0.0.1` if asked.
3. Open [the local fixture](http://127.0.0.1:4317/fixture), then choose **Local fixture** in the app's Settings. It produces moving synthetic terrain and diagnostic reports without running the game. Reload the fixture if it was open before installation.
4. Open or reload [DigDig.IO](https://digdig.io/), enter a round, and select its session in Settings. The observer needs to be installed before the game starts.

For browser permissions and injection settings, see [userscript troubleshooting](../README.md#troubleshooting). The fixture's later WASM calls test capture correctness separately from startup timing: check a fresh `fixture-probe` report and the actual game capture when changing the bootstrap.

## Userscript injection timing

The observer must run before the game compiles its WASM. If a script connects but misses capture, open Tampermonkey's advanced settings and check **Content Script API**: use **UserScripts API** on Firefox, or **UserScripts API Dynamic** on Brave/Chrome. Tampermonkey documents different startup timing for these modes; Chromium's plain UserScripts API does not provide immediate `document-start`. See the [official injection-mode documentation](https://www.tampermonkey.net/documentation.php?locale=en&q=content_script_api).

Reload the page after changing this setting; a setting change alone does not require reinstalling the script. Verify startup with a fresh fixture report and the actual game loading sequence. Successful delayed fixture calls confirm observation works, but do not prove the initial startup was captured.

## What updates automatically?

| Change | Development behavior |
| --- | --- |
| Desktop frontend | Vite updates the viewer through hot reload. |
| Rust source | Tauri recompiles and restarts the native app. |
| Userscript runtime | Webpack rebuilds it; the installed loader replaces it automatically while keeping the game session and captured instances alive. |
| Early bootstrap, observation hooks, metadata, bridge port, or token | Reinstall `install.user.js`, then reload the game or fixture. |
| Node bridge implementation | Restart the development bridge to load the change. Save the scan as `.chunks` first. |

The development script fetches local runtime builds. The production script is fully bundled and must be reinstalled when a release changes its code. Only enable one DigDig observer per game page.

## Run individual parts

| Command | Result |
| --- | --- |
| `npm run dev` | Userscript watch compiler and Node bridge only. |
| `npm exec -- nx run desktop:web-dev` | Frontend at `http://127.0.0.1:4318`; run `npm run dev` in another terminal for live data. Native-only features are unavailable in browser preview. |
| `npm run build` | Userscript development loader/runtime and desktop frontend under `dist/`. |
| `npm run build:desktop` | Release native executable, including its userscript, without assembling `deploy/`. |
| `npm run deploy` | Shareable app and userscript in `deploy/`; see [build and release](RELEASING.md). |
| `npm exec -- nx show projects` | List the Nx projects. |

Nx uses a local cache for eligible tasks; Nx Cloud is disabled. The development userscript embeds a private local token, so its build output is not cached or suitable for distribution.

## Checks and diagnostics

```powershell
npm run check:versions
npm run typecheck
npm test
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

For a compile-only native check, use `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`. Tests use independently authored synthetic WASM fixtures; tests requiring original game snapshots skip when those files are absent.

With the development bridge running, use a second terminal:

```powershell
npm run clients
npm run report
npm run report -- CLIENT_ID
```

Reports are timestamped `.txt` files containing readable JSON in `reports/live/`. They include the app version, captured WASM hashes and exports, memory information, viewport data, layout validation, and hook errors. Tampermonkey also provides a report command.

`npm run reload` **reloads every connected game/fixture tab**, restarting those sessions. Use `npm run reload -- CLIENT_ID` to target one tab. It is unnecessary for ordinary runtime edits.

For synthetic performance measurements, run `node tools/benchmark-terrain.mjs` and `node apps/dev-server/test/telemetry-performance.mjs`. They measure CPU classification and bridge merging, not actual game FPS or browser pixel readback time.

## Architecture and local data

| Path | Responsibility |
| --- | --- |
| [`apps/userscript`](../apps/userscript) | Early WASM/canvas observation, memory reads, terrain capture, and diagnostic runtime. |
| [`apps/desktop`](../apps/desktop) | Vite canvas viewer and Tauri/Rust desktop host. |
| [`apps/dev-server`](../apps/dev-server) | Development bundle delivery, map state, settings, commands, and reports. |
| [`packages/terrain`](../packages/terrain) | Material classification, `.chunks` files, and pixel-preserving PNG export. |
| [`packages/layout-resolver`](../packages/layout-resolver) | Read-only instruction matching and address recipe discovery. |
| [`packages/userscript-webpack-plugin`](../packages/userscript-webpack-plugin) | Userscript metadata generation. |
| [`tools/wasm-analysis`](../tools/wasm-analysis) | Offline WASM decoding and diagnostic analysis. |

The userscript sends token-authenticated HTTP requests through `GM_xmlhttpRequest`. Development uses the Node bridge at `127.0.0.1:4317`; the release app hosts its own Rust bridge at `127.0.0.1:4319`. Tauri's frontend receives data through native IPC. Vite's development WebSocket handles frontend hot reload only.

| Data | Development | Packaged Windows app |
| --- | --- | --- |
| Base folder | `.local/` in the checkout | `%LOCALAPPDATA%\io.digdig.tools.viewer\` |
| Settings | `viewer-settings.json` | `viewer-settings.json` |
| Pairing credential | `dev-token` | `bridge-token` |
| Validated layout recipes | `layout-cache/` | `layout-cache/` |
| Diagnostic reports | `reports/live/` in the checkout | `reports/` under the base folder |

The app's **Map information** panel shows its actual paths and provides **Open in Explorer**. Terrain lives in bridge memory: save `.chunks` before stopping the bridge or closing the packaged app. Settings and layout caches do not automatically save a scan. Keep pairing credentials and personalized userscripts private; distribute the generic release script instead.

## Read-only game analysis

Read [AGENTS.md](../AGENTS.md) before touching capture or analysis. **Never modify the game's original WASM bytes or instructions**, including copies. Observation hooks must preserve the game's original arguments, results, errors, imports, and execution. Instruction patterns resolve data locations; they never patch code. Any requested linear-memory data access is separate from editing a WASM binary.

To inspect your own original snapshot, replace the input paths below. Derived output must stay separate from the originals:

```powershell
npm run analyze:wasm -- --wasm "C:\snapshots\client.wasm" --js "C:\snapshots\client.js" --out reports/analysis.txt --wat .local/client.wat
```

The analyzer decodes with WABT without running the module. The live resolver uses a known SHA-256 recipe first, then a validated cache entry or decoded instruction matching for supported patterns. Candidates must also pass live memory and rendering checks. Ambiguous or unsupported builds remain unsupported; historical offsets are not valid merely because they worked before. See the [reference report](../reports/reference-snapshot.txt) and [current layout evidence](../reports/current-game-layout.json) for recorded analysis.
