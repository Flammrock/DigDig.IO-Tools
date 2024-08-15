
# Shared
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

## Description

**Shared** is a utility package containing common classes, functions, and resources that are reused across multiple projects within the monorepo. This package ensures consistency and avoids duplication by centralizing shared code.

This package includes a variety of classes and utilities related to the game [DigDig.IO](https://digdig.io/), among other shared components. By consolidating these shared elements, we aim to reduce duplication and ensure consistency across different projects.

## Features

- **Centralized Classes**: Contains essential classes related to DigDig.IO, such as `Ore`, `Color`, `Vector2`, `Transform`, `Chunk`, etc.
- **Reusability**: Provides a common set of utilities that can be used across multiple projects, enhancing maintainability and reducing code duplication.
- **Consistency**: Ensures that shared elements are updated in one place, promoting consistency across all dependent packages.

## Usage

To use **Shared** in another package of this monorepo, first install the dependency via npm (at the root of the repo):

```bash
npm install shared -w your_package
```

### Example Usage

Here is a basic example of how you might use this package:

```typescript
import { Chunk, ChunkSize, ChunkAggregator } from 'shared'

const aggregator = new ChunkAggregator()
const offscreen = new OffScreen(ChunkSize, ChunkSize)

aggregator.feed(new Chunk({ x:0, y:0 }, offscreen))

const arrayBuffer = aggregator.export()

// You can then use file-saver.js to save the aggregator in a file


// you can also import it later
const myNewAggregator = ChunkAggregator.import(arrayBuffer)
```

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
