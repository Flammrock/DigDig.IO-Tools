# DigDig.IO Tools
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

This is a monorepo containing various packages and tools developed for the [DigDig.IO](https://digdig.io/) game. Please note that this repository is **not affiliated** with the official [DigDig.IO](https://digdig.io/) game or its developers. The tools provided here are intended for fun and experimental purposes only. They are not designed for, nor should they be used in, any form of cheating. These packages do not alter the game’s logic, mechanics, or behavior in any way.

![output](https://github.com/user-attachments/assets/725bc85f-d5a9-436c-84c7-1011bc51b941)

## 📦 Packages

This monorepo is structured into multiple packages, each designed to serve a specific purpose. Below is an overview of the main packages:

### `electron-app`
The `electron-app` package serves as the central hub for all tools included in this monorepo. Built using Electron, this application provides a user-friendly interface that brings together the various functionalities, making it easy to access and manage the different tools. The app establishes a WebSocket connection with the `userscript` to enable real-time communication and coordination between the script and the desktop application.

### `userscript`
The `userscript` package contains all the scripts needed to interact with the [DigDig.IO](https://digdig.io/) game. These scripts are injected into the game's web environment and work in tandem with the `electron-app` via WebSocket communication. This setup allows for seamless integration between the desktop application and the game, ensuring that tools and functionalities can be accessed directly from within the game's interface without altering its core mechanics.

### `custom-font`
A package that generates font files _(such as .ttf and .woff2)_ from SVG files. It centralizes icon management, ensuring that all projects within the monorepo use the same set of icons.

### `injection`
This package contains all the functionalities for injecting and hooking into the core script of the [DigDig.IO](https://digdig.io/) game. It is not intended for cheating purposes and does not modify the game's logic, mechanics, or behavior in any way.

### `shared`
A utility package containing common classes, functions, and resources that are reused across multiple projects within the monorepo. This package ensures consistency and avoids duplication by centralizing shared code.

### `map-scanner/remote`
A package for visualizing map data for [DigDig.IO](https://digdig.io/). This tool allows you to scan and view maps, helping you better understand the game’s terrain and design.

### `map-scanner/script`
This package contains scripts designed to scan and analyze maps within [DigDig.IO](https://digdig.io/). It's the backbone of the map scanning functionality, providing the core logic and processes.

### `map-scanner/shared`
A shared utility package for map scanning-related projects. It includes common resources and utilities that are used across the various map scanner packages, ensuring consistency and reducing duplication.

### `userscript-webpack-plugin`
A webpack plugin tailored for [DigDig.IO](https://digdig.io/) userscripts. It helps automate the bundling process, ensuring that your scripts are packaged correctly and efficiently, with the proper userscript headers injected.

## 🚀 Getting Started

To get started with the **DigDig.IO Tools** monorepo, follow the steps below:

1. **Clone the Repository**: 
```bash
git clone https://github.com/Flammrock/DigDig.IO-Tools.git
cd DigDig.IO-Tools
```

2. **Install Dependencies**:
This monorepo uses npm workspaces to manage dependencies.
```bash
yarn install
```

3. **Building the Packages**:
You can build individual packages or all packages at once.
```bash
yarn run build
```

## 📝 License

This project is licensed under the **MIT** License. See the LICENSE file for details.
