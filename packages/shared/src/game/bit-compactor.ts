/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 *
 */
export interface ChunkElement {
  location: number
  index: number
}
export type CompressedChunkElement = number

/**
 * Combines the color palette index and location (x, y) into a single Uint16 number.
 *
 * We don't want to store all of the full chunks; we only need ore information.
 * Because chunks are 64x64 pixels, the location (x, y) of an ore pixel will never exceed 4095.
 * As a reminder, "location" is the pixel index within the chunk data array, which is a
 * one-dimensional array. So this index is in the range [0, 64*64-1], which simplifies to [0, 4095].
 * Fortunately, 4095 can be coded in 12 bits. The color palette index, representing the ore type,
 * will never exceed 15 because there aren't that many ores, and 15 can be coded in 4 bits.
 * 12 bits + 4 bits fits into a Uint16 number.
 */
export const BitCompactor = {
  compress(data: ChunkElement): CompressedChunkElement {
    return (data.index & 0xf) | ((data.location & 0xfff) << 4)
  },
  extract(compressed: CompressedChunkElement): ChunkElement {
    return {
      index: compressed & 0xf,
      location: (compressed >> 4) & 0xfff
    }
  },
  getLocation(compressed: CompressedChunkElement): number {
    return (compressed >> 4) & 0xfff
  }
}
