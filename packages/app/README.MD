
# DigDig.IO App
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)


## Description

**DigDig.IO App** is an Electron-based application designed to visualize maps from the game [DigDig.IO](https://digdig.io/). This project works in tandem with a userscript named **DigDig.IO Script**, which is part of this repo (monorepop).

The primary function of this project is to create a WebSocket server that listens on port `8543`. The userscript, when injected into the DigDig.IO game via Tampermonkey or Greasemonkey, connects to this WebSocket server. As the player navigates the map in the game, the userscript captures the map chunks, compresses and simplifies them, and sends this data through the WebSocket connection.

The app _(this project)_ then processes the received data, extracting and rendering the simplified map chunks, allowing for real-time visualization of the DigDig.IO map as the player explores it.


## Getting Started

1. Clone the repo

If you haven't already cloned the repository, you can do so by running:
```bash
git clone https://github.com/Flammrock/DigDig.IO-Tools.git
cd DigDig.IO-Tools
```

**Note:** All following commands should be run from the project root directory.

2. Install NPM packages

If you haven't already done so, install the necessary dependencies by running:
```bash
yarn install
```

3. Start developement server

```bash
yarn run app:run
```

4. Build

```bash
yarn run app:start
```

## How to Use

To use **DigDig.IO App**, follow the steps below:

#### 1. Set Up the Userscript

Follow the instructions from the **DigDig.IO Script** project to inject the userscript into your browser. This can be done using Tampermonkey, Greasemonkey, or a similar extension. The script will establish a WebSocket connection with the viewer application.

#### 2. Start the Application

In the root directory of the project, run the following command to start the Application:

```bash
yarn run app:start
```

**Alternatively**, if you prefer to build the application first and then run it, use:

```bash
yarn run app:build
```

After building, locate the App executable. The path depends on your operating system:

- **Windows**: `./packages/app/out/make/squirrel.windows/x64/DigDig.IO Tools-{VERSION} Setup.exe`
- **macOs**: `./packages/app/out/make/zip/darwin/x64/DigDig.IO Tools-darwin-x64-{VERSION}.zip`
- **Linux**: `./packages/app/out/make/deb/x64/DigDig.IO Tools_{VERSION}_amd64.deb` or `./packages/app/out/make/rpm/x64/DigDig.IO Tools-{VERSION}-1.x86_64.rpm`

Generally in: `./packages/app/out/make/`

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
