/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Chunk, ChunkSize, RectangleLike, Writeable } from 'shared'
import Renderable from '../core/renderable'
import RenderContext from '../core/render-context'

/**
 *
 */
export class ChunkImage implements Renderable {
  public readonly chunk: Chunk
  public readonly bounds: RectangleLike
  public readonly isSelected: boolean
  private debugInformation: boolean
  private readonly offscreen: OffscreenCanvasRenderingContext2D

  public constructor(chunk: Chunk) {
    this.chunk = chunk
    this.bounds = {
      x: this.chunk.position.x * ChunkSize,
      y: this.chunk.position.y * ChunkSize,
      width: ChunkSize,
      height: ChunkSize
    }
    this.isSelected = false
    this.debugInformation = true
    this.offscreen = new OffscreenCanvas(ChunkSize, ChunkSize).getContext('2d')
    this.cache()
  }

  private cache(): void {
    const rawImage = this.chunk.toPixels()
    const pixels = new ImageData(rawImage.data, rawImage.width, rawImage.height)
    this.offscreen.clearRect(0, 0, ChunkSize, ChunkSize)
    this.offscreen.putImageData(pixels, 0, 0)
  }

  public debug(value: boolean): void {
    this.debugInformation = value
  }

  public update(chunk: Chunk): void {
    ;(<Writeable<ChunkImage>>this).chunk = chunk
    ;(<Writeable<ChunkImage>>this).bounds = {
      x: this.chunk.position.x * ChunkSize,
      y: this.chunk.position.y * ChunkSize,
      width: ChunkSize,
      height: ChunkSize
    }
    this.cache()
  }

  public prerender(context: RenderContext): void {
    const region = context.selection.region()
    if (!region) return
    ;(<Writeable<ChunkImage>>this).isSelected = context.selection.contains(this.bounds)
  }

  public render(context: RenderContext): void {
    const ctx = context.ctx
    const rect = this.bounds

    const isHovered = context.mouse.isIn(rect)

    ctx.beginPath()
    ctx.fillStyle = isHovered || this.isSelected ? 'rgb(127, 71, 0)' : 'rgb(82, 46, 0)'
    ctx.rect(rect.x, rect.y, rect.width, rect.height)
    ctx.fill()

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.offscreen.canvas, rect.x, rect.y, rect.width, rect.height)

    if (this.debugInformation) {
      ctx.beginPath()
      ctx.strokeStyle = this.isSelected ? 'blue' : 'green'
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.lineWidth = 1

      ctx.fillStyle = 'white'
      ctx.font = 12 + 'px Ubuntu'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        `(${this.chunk.position.x}, ${this.chunk.position.y})`,
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
      )
    } else if (this.isSelected) {
      ctx.beginPath()
      ctx.strokeStyle = 'blue'
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.lineWidth = 1
    }
  }
}

export default ChunkImage
