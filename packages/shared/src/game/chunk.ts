/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { rgb } from '../core/color'
import { RawImage, RawImageFormat } from '../core/raw-image'
import { GridVector2, Vector2, Vector2Like } from '../core/vector2'
import { Nullable } from '../utils/helpers'
import { BitCompactor } from './bit-compactor'
import { KnownOres } from './ore-palette'

/**
 * In digdig.io, a chunk is 64x64 pixels
 */
export const ChunkSize = 64

/**
 * In digdig.io, the game map consists of chunks, each measuring 64x64 pixels.
 *
 *                       64              64               64             64
 *                <---------------><--------------><--------------><-------------->
 *                .               .               .               .               .
 *                .               .               .               .               .
 *                |               |               |               |               |
 *     ^  ...-----;---------------;---------------;---------------;---------------;-----...
 *     |          |               |               |               |               |
 *     |          |               |               |               |               |
 * 64  |          |               |               |               |               |
 *     |          |               |               |               |               |
 *     |          |               |               |               |               |
 *     v  ...-----;---------------;---------------;---------------;---------------'-----...
 *     ^          |               |               |               |               |
 *     |          |               |               |               |               |
 * 64  |          |               |               |               |               |
 *     |          |               |               |               |               |
 *     |          |               |               |               |               |
 *     v  ...-----;---------------;---------------;---------------;---------------'-----...
 *     ^          |               |               |               |               |
 *     |          |               |               |               |               |
 * 64  |          |               |               |               |               |
 *     |          |               |               |               |               |
 *     |          |               |               |               |               |
 *     v  ...-----;---------------;---------------;---------------;---------------'-----...
 *                .               .               .               .               .
 *                .               .               .               .               .
 *                |               |               |               |               |
 *
 * Each chunk is basically a tiny image 64 pixels by 64 pixels.
 * Each pixel of a chunk is a color in rgba format.
 * For example, if the pixel is yellow, then the pixel is a gold ore.
 * This class is designed to extract meaningful information from raw chunk data
 * especially the ores information.
 */
export class Chunk {
  public readonly position: GridVector2
  private data: Uint16Array

  public get buffer(): Uint16Array {
    return this.data
  }

  constructor(position: Vector2Like, data: Uint16Array)
  constructor(position: Vector2Like, canvas: OffscreenCanvas)
  constructor(position: Vector2Like, dataOrCanvas: Uint16Array | OffscreenCanvas) {
    this.position = GridVector2.from(position)

    if (dataOrCanvas instanceof Uint16Array) {
      this.data = dataOrCanvas.slice()
    } else {
      const canvas = dataOrCanvas

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx === null) throw new Error('Unable to retrieve 2d context of chunk offscreen canvas.')

      if (canvas.width !== ChunkSize || canvas.height !== ChunkSize)
        throw new Error(`The provided canvas is not ${ChunkSize}x${ChunkSize} pixels.`)
      const imageData = ctx.getImageData(0, 0, ChunkSize, ChunkSize)
      const pixels = imageData.data

      // Extract ores information and compress
      const data = new Uint16Array(ChunkSize * ChunkSize)
      let k = 0
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] !== 0xff) continue
        pixels[index + 3] = 0
        const paletteIndex = KnownOres.fromColor(rgb(pixels[index], pixels[index + 1], pixels[index + 2]))
        if (paletteIndex === null) continue
        pixels[index + 3] = 0xff
        data[k++] = BitCompactor.compress({ location: index >> 2, index: paletteIndex })
      }

      this.data = data.slice(0, k)
    }
  }

  public toPixels(): RawImage {
    const pixels = new Uint8ClampedArray(ChunkSize * ChunkSize * 4)
    for (let i = 0; i < this.data.length; i++) {
      const element = BitCompactor.extract(this.data[i])
      const index = element.location << 2
      const ore = KnownOres.get(element.index)
      if (ore === null) throw new Error('Invalid ore palette index.')
      pixels[index] = ore.color.red
      pixels[index + 1] = ore.color.green
      pixels[index + 2] = ore.color.blue
      pixels[index + 3] = 0xff
    }
    return { data: pixels, width: ChunkSize, height: ChunkSize, format: RawImageFormat.RGBA }
  }

  public eat(other: Chunk) {
    if (!Vector2.equals(this.position, other.position))
      throw new Error(
        'Unable to merge chunk that comes from different location (The unique name provider failed due to a bug or an update).'
      )

    if (other.data.length === 0) return
    if (this.data.length === 0) {
      this.data = other.data.slice()
      return
    }

    let k = 0
    let i = 0
    let j = 0
    let ci = BitCompactor.getLocation(this.data[i])
    let cj = BitCompactor.getLocation(other.data[j])

    const data = new Uint16Array(ChunkSize * ChunkSize)

    while (true) {
      if (i >= this.data.length || j >= other.data.length) break
      if (ci < cj) {
        data[k++] = this.data[i]
        ci = BitCompactor.getLocation(this.data[++i])
      } else if (ci === cj) {
        data[k++] = other.data[j]
        ci = BitCompactor.getLocation(this.data[++i])
        cj = BitCompactor.getLocation(other.data[++j])
      } else if (ci > cj) {
        data[k++] = other.data[j]
        cj = BitCompactor.getLocation(other.data[++j])
      } else {
        throw new Error('Something goes wrong during the chunk merge step.')
      }
    }

    if (i < this.data.length) {
      for (; i < this.data.length; i++) data[k++] = this.data[i]
    } else if (j < other.data.length) {
      for (; j < other.data.length; j++) data[k++] = other.data[j]
    }

    this.data = data.slice(0, k)
  }

  public static isChunk(
    args: [image: CanvasImageSource, x: number, y: number, w: number, h: number] | [CanvasImageSource, ...number[]]
  ): boolean {
    if (args.length !== 5) return false
    const [image, dx, dy, dWidth, dHeight] = args
    if (image instanceof VideoFrame) return false
    return (
      image.width === ChunkSize && image.height === ChunkSize && dx === 0 && dy === 0 && dWidth === 1 && dHeight === 1
    )
  }

  public static from(position: Vector2Like, data: Uint16Array) {
    return new Chunk(position, data)
  }
}
