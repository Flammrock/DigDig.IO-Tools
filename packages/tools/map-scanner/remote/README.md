# DigDig.IO Map Scanner Remote
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)


## Description

**DigDig.IO Map Scanner Remote** is a tool which is part of an Electron-based application (see the project **DigDig.IO App** within the monorepo) designed to visualize maps from the game [DigDig.IO](https://digdig.io/). This project works in tandem with a userscript named **DigDig.IO Map Scanner Script**, which is part of this repo (monorepop).

The primary function of this project is to create a WebSocket server that listens on port `8543`. The userscript, when injected into the DigDig.IO game via Tampermonkey or Greasemonkey, connects to this WebSocket server. As the player navigates the map in the game, the userscript captures the map chunks, compresses and simplifies them, and sends this data through the WebSocket connection.

The viewer _(this project)_ then processes the received data, extracting and rendering the simplified map chunks, allowing for real-time visualization of the DigDig.IO map as the player explores it.

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
