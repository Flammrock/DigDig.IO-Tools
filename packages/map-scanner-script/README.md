
# DigDig.IO Map Scanner Script
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

## Description

**DigDig.IO Map Scanner Script** is a userscript designed to work in conjunction with the **DigDig.IO Map Scanner Viewer**. Its primary purpose is to hook into the [DigDig.IO](https://digdig.io/) game, capture map chunks as they are rendered, and send this data to the viewer in real-time for visualization.

This script leverages the **DigDig.IO Injection** and **Shared** packages to hook into the game's core script and efficiently process the data. By running this userscript in your browser, you can connect to the viewer and visualize the map as you explore it in the game.

## Features

- **Real-Time Map Scanning**: Captures map chunks as they are rendered in the game and sends them to the viewer via a WebSocket connection.
- **Integration with DigDig.IO Map Scanner Viewer**: Seamlessly connects to the **DigDig.IO Map Scanner Viewer** for real-time visualization.
- **Efficient Data Handling**: Utilizes proxying and WASM memory listening to gather and transmit only the necessary data, minimizing impact on game performance.

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

3. Build

Build the userscript by running:
```bash
yarn run build:map-scanner-script
```

If the build succeeds, the userscript file will be generated at `./packages/map-scanner-script/dist/script.min.user.js`.

## Installation

To use the **DigDig.IO Map Scanner Script**, follow these steps:

1. **Install a Userscript Manager**: Ensure you have a userscript manager installed in your browser, such as [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/).

2. **Add the Userscript**: Install the DigDig.IO Map Scanner Script by creating a new userscript in your userscript manager and pasting in the code from this repository located at `./packages/map-scanner-script/dist/script.min.user.js` (if this file is not present, please refer to the "Getting Started" section of this README).

Alternatively, you can directly install the script here: (this link should trigger the installation process if your browser is running a compatible userscript extension).

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
