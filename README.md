# DigDig.IO Tools
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

This is a monorepo containing various packages and tools developed for the [DigDig.IO](https://digdig.io/) game. Please note that this repository is **not affiliated** with the official [DigDig.IO](https://digdig.io/) game or its developers. The tools provided here are intended for fun and experimental purposes only. They are not designed for, nor should they be used in, any form of cheating. These packages do not alter the game’s logic, mechanics, or behavior in any way.

## 📦 Packages

This monorepo is structured into multiple packages, each designed to serve a specific purpose. Below is an overview of the main packages:

### `custom-font`
A package that generates font files _(such as .ttf and .woff2)_ from SVG files. It centralizes icon management, ensuring that all projects within the monorepo use the same set of icons.

### `injection`
This package contains all the functionalities for injecting and hooking into the core script of the [DigDig.IO](https://digdig.io/) game. It is not intended for cheating purposes and does not modify the game's logic, mechanics, or behavior in any way.

### `shared`
A utility package containing common classes, functions, and resources that are reused across multiple projects within the monorepo. This package ensures consistency and avoids duplication by centralizing shared code.

### `map-scanner-viewer`
A package for visualizing map data for [DigDig.IO](https://digdig.io/). This tool allows you to scan and view maps, helping you better understand the game’s terrain and design.

### `map-scanner-tiny-viewer`
A lightweight version of the `map-scanner-viewer` package, optimized for performance and minimal resource usage. Ideal for scenarios where you need a faster, more efficient map scanning tool.

### `map-scanner-script`
This package contains scripts designed to scan and analyze maps within [DigDig.IO](https://digdig.io/). It's the backbone of the map scanning functionality, providing the core logic and processes.

### `map-scanner-shared`
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
