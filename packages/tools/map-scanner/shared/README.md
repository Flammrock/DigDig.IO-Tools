# DigDig.IO Map Scanner - Shared
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

## Description

The **Map Scanner Shared** package provides the network protocol used by the Map Scanner tools within the [DigDig.IO](https://digdig.io/) ecosystem. This package defines the binary structure for writing and reading data transmitted through WebSocket connections between the **Map Scanner Script** and the **Map Scanner Remote** packages.

By centralizing the protocol handling in this shared package, both the script and remote components can consistently and efficiently communicate, ensuring that data is correctly encoded, transmitted, and decoded across the tools.

## Feature

- **Network Protocol Handling**: Defines and implements the binary protocol for encoding and decoding messages, such as map chunks and player positions, that are sent over WebSocket connections. This ensures that both the **Map Scanner Script** and **Map Scanner Remote** packages can communicate seamlessly and accurately.

## Installation

This package is intended to be used as a dependency within the **DigDig.IO Tools** monorepo. It is not designed to be installed or used independently.

To include the **Map Scanner Shared** package in your project, simply add it as a dependency in the relevant package's configuration.

## Usage

To use the network protocol provided by the **Map Scanner Shared** package, import the required classes and functions into your project:

```typescript
import { ProtocolHandler, Protocol, ProtocolMessageType } from 'map-scanner-shared'

// Example usage
const protocolHandler = new ProtocolHandler()

protocolHandler.on(ProtocolMessageType.Chunk, (chunk) => {
  console.log('Received chunk:', chunk)
})

protocolHandler.on(ProtocolMessageType.Position, (position) => {
  console.log('Received position:', position)
})

// To handle incoming data (data must be an ArrayBuffer)
protocolHandler.handle(data)

// To encode data for transmission
const encodedChunk = Protocol.encode.chunk(chunk)
const encodedPosition = Protocol.encode.position(position)
// retrieve the ArrayBuffer by doing: encodedChunk.getArrayBuffer()
```

This example shows how to handle incoming protocol messages and how to encode data for transmission.

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
