
# DigDig.IO Map Scanner Script
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

## Description

**DigDig.IO Map Scanner Script** is a userscript designed to work in conjunction with the **DigDig.IO Map Scanner Remote**. Its primary purpose is to hook into the [DigDig.IO](https://digdig.io/) game, capture map chunks as they are rendered, and send this data to the viewer in real-time for visualization.

This script leverages the **DigDig.IO Injection** and **Shared** packages to hook into the game's core script and efficiently process the data. By running this userscript in your browser, you can connect to the viewer and visualize the map as you explore it in the game.

## Features

- **Real-Time Map Scanning**: Captures map chunks as they are rendered in the game and sends them to the viewer via a WebSocket connection.
- **Integration with DigDig.IO Map Scanner Remote**: Seamlessly connects to the **DigDig.IO Map Scanner Remote** for real-time visualization.
- **Efficient Data Handling**: Utilizes proxying and WASM memory listening to gather and transmit only the necessary data, minimizing impact on game performance.

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
