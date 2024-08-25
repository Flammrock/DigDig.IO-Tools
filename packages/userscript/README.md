
# DigDig.IO Script
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

## Description

**DigDig.IO Userscript** is a comprehensive userscript package designed to bundle all the tools' scripts developed for the [DigDig.IO](https://digdig.io/) game into a single, easy-to-use script. This userscript acts as a gateway to various functionalities, allowing players to access multiple tools through a single installation in a userscript manager like [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/).

This script integrates with the **DigDig.IO App** via a WebSocket connection, enabling real-time communication between the game and the desktop application. By running this userscript in your browser, you can seamlessly access all the tools provided by the **DigDig.IO Tools** monorepo without needing to install multiple scripts.

## Features

- **Unified Script Hub**: Combines all the scripts from the various tools into a single userscript, simplifying installation and management.
- **Real-Time Communication**: Connects with the **DigDig.IO App** for real-time data exchange and tool interaction via WebSocket.
- **Modular Design**: Each tool's script is modularly included, ensuring that the userscript remains efficient and focused on necessary tasks.

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
yarn run userscript:build
```

If the build succeeds, the userscript file will be generated at `./packages/userscript/dist/script.min.user.js`.

## Installation

To use the **DigDig.IO Script**, follow these steps:

1. **Install a Userscript Manager**: Ensure you have a userscript manager installed in your browser, such as [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/).

2. **Add the Userscript**: Install the **DigDig.IO Script** by creating a new userscript in your userscript manager and pasting in the code from this repository located at `./packages/userscript/dist/script.min.user.js` (if this file is not present, please refer to the "Getting Started" section of this README).

Alternatively, you can directly install the script here: (this link should trigger the installation process if your browser is running a compatible userscript extension).

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
