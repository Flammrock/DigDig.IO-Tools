/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Chunk, Buffer, ChunkAggregatorProtocol, Vector2Like, EventEmitter, EventCallbacks, BufferLike } from 'shared'

export enum ProtocolMessageType {
  Chunk = 0x1,
  Position = 0x2
}

export interface ProtocolMessageCallbacks extends EventCallbacks {
  [ProtocolMessageType.Chunk]: (chunk: Chunk) => void
  [ProtocolMessageType.Position]: (position: Vector2Like) => void
}

export class ProtocolHandler extends EventEmitter<ProtocolMessageCallbacks> {
  public constructor() {
    super()
  }

  public handle(data: BufferLike): void {
    const buffer = Buffer.from(data)
    const type = buffer.readUint8(0)
    switch (type) {
      case ProtocolMessageType.Chunk:
        return this.dispatcher.emit(ProtocolMessageType.Chunk, Protocol.decode.chunk(buffer))
      case ProtocolMessageType.Position:
        return this.dispatcher.emit(ProtocolMessageType.Position, Protocol.decode.position(buffer))
    }
    throw new Error(`Unsupported protocol message ${type}.`)
  }
}

/**
 *
 */
export const Protocol = {
  encode: {
    chunk(chunk: Chunk): Buffer {
      const buffer = new Buffer(1 + ChunkAggregatorProtocol.sizeOfChunk(chunk))
      buffer.writeUint8(ProtocolMessageType.Chunk)
      ChunkAggregatorProtocol.writeChunk(buffer, chunk)
      return buffer
    },
    position(position: Vector2Like): Buffer {
      const buffer = new Buffer(1 + 8 * 2)
      buffer.writeUint8(ProtocolMessageType.Position)
      buffer.writeFloat64(position.x)
      buffer.writeFloat64(position.y)
      return buffer
    }
  },
  decode: {
    chunk(buffer: Buffer): Chunk {
      if (buffer.readUint8() !== ProtocolMessageType.Chunk) throw new Error('Chunk message type expected.')
      return ChunkAggregatorProtocol.readChunk(buffer)
    },
    position(buffer: Buffer): Vector2Like {
      if (buffer.readUint8() !== ProtocolMessageType.Position) throw new Error('Position message type expected.')
      return { x: buffer.readFloat64(), y: buffer.readFloat64() }
    }
  }
}
