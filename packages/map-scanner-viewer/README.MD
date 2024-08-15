
# DigDig.IO Map Scanner Viewer
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)


## Description

**DigDig.IO Map Scanner Viewer** is an Electron-based application designed to visualize maps from the game [DigDig.IO](https://digdig.io/). This project works in tandem with a userscript named **DigDig.IO Map Scanner Script**, which is part of this repo (monorepop).

The primary function of this project is to create a WebSocket server that listens on port `8543`. The userscript, when injected into the DigDig.IO game via Tampermonkey or Greasemonkey, connects to this WebSocket server. As the player navigates the map in the game, the userscript captures the map chunks, compresses and simplifies them, and sends this data through the WebSocket connection.

The viewer _(this project)_ then processes the received data, extracting and rendering the simplified map chunks, allowing for real-time visualization of the DigDig.IO map as the player explores it.


## Getting Started

1. Clone the repo

If you haven't already cloned the repository, you can do so by running:
```
git clone https://github.com/Flammrock/digdig-io-tools.git
```

**Note:** All following commands should be run from the project root directory.

2. Install NPM packages

If you haven't already done so, install the necessary dependencies by running:
```
npm install
```

3. Start developement server

```
npm run start:map-scanner-viewer
```

4. Build

```
npm run build:map-scanner-viewer
```

## How to Use

To use **DigDig.IO Map Scanner Viewer**, follow the steps below:

#### 1. Set Up the Userscript

Follow the instructions from the **DigDig.IO Map Scanner Script** project to inject the userscript into your browser. This can be done using Tampermonkey, Greasemonkey, or a similar extension. The script will establish a WebSocket connection with the viewer application.

#### 2. Start the Viewer Application

In the root directory of the project, run the following command to start the viewer:

```bash
npm run start:map-scanner-viewer
```

**Alternatively**, if you prefer to build the application first and then run it, use:

```bash
npm run build:map-scanner-viewer
```

After building, locate the viewer executable. The path depends on your operating system:

- **Windows**: `./packages/map-scanner-viewer/out/Viewer-win32-x64/Viewer.exe`
- **macOs**: `./packages/map-scanner-viewer/out/Viewer-darwin-x64/Viewer.app`
- **Linux**: `./packages/map-scanner-viewer/out/Viewer-linux-x64/Viewer`

Generally: `./packages/map-scanner-viewer/out/Viewer-{PLATFORM}-{ARCHITECTURE}/Viewer{EXTENSION}`

#### 3. Connect to the Viewer

1. Open your browser (Brave, Firefox, Opera, Google Chrome, etc.) and navigate to the [DigDig.IO website](https://digdig.io).
2. Refresh the page (if already opened). The userscript should automatically connect to the viewer.
3. If the connection doesn't establish automatically, please create an issue on the GitHub repository, and I'll work on resolving it.

#### 4. Viewer Controls

Once connected to the viewer, you can interact with the map using the following controls:

- **Pan**: Hold the right mouse button and move the mouse to pan around the map.
- **Zoom**: Use the mouse wheel to zoom in and out of the map.
- **Select Chunk**: Hold the left mouse button and move the mouse to select a chunk on the map.
- **Delete Chunk**: Press the `Del` key to delete the selected chunk.
- **Reset Camera**: Press the `P` key to reset the camera to its default position.
- **Toggle Debug Information**: Press the `H` key to toggle debug information on or off.

## License

Copyright (c) Flammrock. All rights reserved.

Licensed under the MIT license.
