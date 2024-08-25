/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Buffer } from '../core/buffer'
import { GridVector2 } from '../core/vector2'
import { Nullable } from '../utils/helpers'
import { Chunk } from './chunk'

export enum ChunkAggregatorMagicByte {
  Init = 0xb4,
  ChunkStartSection = 0x12,
  ChunkEndSection = 0xcf,
  ChunkListStartSection = 0x7c,
  ChunkListEndSection = 0xe5
}

export const ChunkAggregatorProtocol = {
  sizeOfChunk(chunk: Chunk): number {
    // content:
    //   + 1 byte  for starting magic byte
    //   + 4 bytes for x position
    //   + 4 bytes for y position
    //   + 4 bytes for chunk buffer size
    //   + n bytes for chunk buffer
    //   + 1 byte  for ending magic byte
    // total: 1 + 4 + 4 + 4 + 1 + n
    // which simplify to: 14 + n
    // @see the method ChunkAggregatorProtocol.writeChunk for confirmation
    return 14 + chunk.buffer.byteLength
  },
  sizeOfChunkList(chunks: ReadonlyArray<Chunk>): number {
    // content:
    //   + 1 byte  for starting magic byte
    //   + 4 bytes for chunk list length
    //   + m bytes for chunk list buffer
    //   + 1 byte  for ending magic byte
    // total: 1 + 4 + 1 + m
    // which simplify to: 6 + m
    // @see the method ChunkAggregatorProtocol.writeChunkList for confirmation
    return 6 + chunks.reduce((acc, chunk) => acc + this.sizeOfChunk(chunk), 0)
  },
  writeChunk(buffer: Buffer, chunk: Chunk): void {
    buffer.writeUint8(ChunkAggregatorMagicByte.ChunkStartSection)
    buffer.writeInt32(chunk.position.x)
    buffer.writeInt32(chunk.position.y)
    buffer.writeUint32(chunk.buffer.length)
    for (let i = 0; i < chunk.buffer.length; i++) {
      buffer.writeUint16(chunk.buffer[i])
    }
    buffer.writeUint8(ChunkAggregatorMagicByte.ChunkEndSection)
  },
  writeChunkList(buffer: Buffer, chunks: ReadonlyArray<Chunk>): void {
    buffer.writeUint8(ChunkAggregatorMagicByte.ChunkListStartSection)
    buffer.writeUint32(chunks.length)
    for (const chunk of chunks) {
      this.writeChunk(buffer, chunk)
    }
    buffer.writeUint8(ChunkAggregatorMagicByte.ChunkListEndSection)
  },
  readChunk(buffer: Buffer): Chunk {
    if (buffer.readUint8() !== ChunkAggregatorMagicByte.ChunkStartSection)
      throw new Error('Chunk start section expected.')
    const x = buffer.readInt32()
    const y = buffer.readInt32()
    const chunkLength = buffer.readUint32()
    const chunkData = new Uint16Array(chunkLength)
    for (let i = 0; i < chunkLength; i++) {
      chunkData[i] = buffer.readUint16()
    }
    if (buffer.readUint8() !== ChunkAggregatorMagicByte.ChunkEndSection) throw new Error('Chunk end section expected.')
    return Chunk.from({ x, y }, chunkData)
  },
  readChunkList(buffer: Buffer): Array<Chunk> {
    if (buffer.readUint8() !== ChunkAggregatorMagicByte.ChunkListStartSection)
      throw new Error('Chunk List start section expected.')
    const chunks: Array<Chunk> = []
    const chunksLength = buffer.readUint32()
    for (let i = 0; i < chunksLength; i++) {
      chunks.push(this.readChunk(buffer))
    }
    if (buffer.readUint8() !== ChunkAggregatorMagicByte.ChunkListEndSection)
      throw new Error('Chunk List end section expected.')
    return chunks
  }
}

/**
 *
 */
export class ChunkAggregator {
  private internal: Record<string, Chunk> = {}

  public get chunks(): ReadonlyArray<Chunk> {
    return Object.values(this.internal)
  }

  public feed(chunk: Chunk): void {
    const key = chunk.position.toString()
    if (typeof this.internal[key] === 'undefined') {
      this.internal[key] = chunk
    } else {
      this.internal[key].eat(chunk)
    }
  }

  public has(position: GridVector2): boolean {
    return typeof this.internal[position.toString()] !== 'undefined'
  }

  public get(position: GridVector2): Nullable<Chunk> {
    const chunk = this.internal[position.toString()]
    return chunk ?? null
  }

  public remove(position: GridVector2): void {
    delete this.internal[position.toString()]
  }

  public clear(): void {
    this.internal = {}
  }

  private computeSize(): number {
    return 1 + ChunkAggregatorProtocol.sizeOfChunkList(this.chunks)
  }

  public export(): ArrayBuffer {
    const buffer = new Buffer(this.computeSize())

    buffer.writeUint8(ChunkAggregatorMagicByte.Init)
    ChunkAggregatorProtocol.writeChunkList(buffer, this.chunks)

    return buffer.getArrayBuffer()
  }

  public import(data: ArrayBuffer): void {
    const buffer = new Buffer(data)

    if (buffer.readUint8() !== ChunkAggregatorMagicByte.Init) throw new Error('Buffer provided is not valid.')
    const chunks = ChunkAggregatorProtocol.readChunkList(buffer)

    for (const chunk of chunks) {
      this.feed(chunk)
    }
  }

  public static import(data: ArrayBuffer): ChunkAggregator {
    const aggregator = new ChunkAggregator()
    aggregator.import(data)
    return aggregator
  }
}
