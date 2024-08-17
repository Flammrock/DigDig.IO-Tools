
# DigDig.IO Injection
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)


## Description

**DigDig.IO Injection** is an npm dependency designed to simplify the process of injecting and hooking into the core script of the game [DigDig.IO](https://digdig.io/). This package is specifically built to work with the **DigDig.IO Map Scanner Script** project, but can be used in any context where injection into the DigDig.IO game is needed.

The primary purpose of **DigDig.IO Injection** is to centralize and streamline all functionality related to injection. This includes providing functions, objects, and classes that make it easier to hook into the game, allowing for non-intrusive listening to game events.

## Key Features

- **CanvasRenderingContext2D Proxying**: Proxies methods in the `CanvasRenderingContext2D` to capture chunk images as they are rendered by the game.
- **WASM Memory Listening**: Hooks into the WebAssembly (WASM) memory to retrieve the player's location in real-time.
- **Non-Intrusive**: This package is designed solely for listening to game events, without altering the game logic or behavior. It does not facilitate or support cheating in any form.
- **Centralized Injection Logic**: All injection-related code is maintained in one place, making it easier to manage and extend.

## Usage

To use **DigDig.IO Injection** in another package of this monorepo, first install the dependency via yarn (at the root of the repo):

```bash
yarn workspace your_package add injection
```

### Example Usage

Here is a basic example of how you might use this package in a userscript:

```typescript
import { Chunk, Vector2Like } from 'shared'
import { InformationExtractor, Scanner, ScannerEvent } from 'injection'

const extractor = InformationExtractor.inject()
new Scanner(extractor)
  .on(ScannerEvent.ChunkRecieved, (chunk) => {
    // chunk is a Chunk object
  })
  .on(ScannerEvent.PlayerPosition, (position) => {
    // position is a Vector2Like object
  })
```

## Purpose and Ethical Use

The **DigDig.IO Injection** package is strictly intended for non-intrusive listening to game events for the purpose of visualization and analysis, such as in the **DigDig.IO Map Scanner Script**. It is not designed for, nor should it be used in, any form of cheating. The package does not alter the game’s logic, mechanics, or behavior—its sole function is to monitor what is rendered on the screen.

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
