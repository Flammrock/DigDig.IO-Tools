/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Chunk, ChunkAggregator, GridVector2 } from 'shared'
import Renderable from '../core/renderable'
import ChunkImage from './chunk-image'
import RenderContext from '../core/render-context'

/**
 *
 */
export class ChunkMap implements Renderable {
  private internal: Record<string, ChunkImage>
  public readonly aggregator: ChunkAggregator
  private debugInformation: boolean

  public constructor() {
    this.internal = {}
    this.aggregator = new ChunkAggregator()
    this.debugInformation = true
  }

  public debug(value: boolean): void {
    this.debugInformation = value
  }

  public clear(): void {
    this.internal = {}
    this.aggregator.clear()
    this.debugInformation = true
  }

  private update(chunk: Chunk): void {
    const merged = this.aggregator.get(chunk.position)
    if (!merged) return
    const key = merged.position.toString()
    if (typeof this.internal[key] === 'undefined') {
      this.internal[key] = new ChunkImage(merged)
    } else {
      this.internal[key].update(merged)
    }
  }

  public feed(chunk: Chunk): void {
    this.aggregator.feed(chunk)
    this.update(chunk)
  }

  public import(buffer: ArrayBuffer): void {
    this.aggregator.import(buffer)
    for (const chunk of this.aggregator.chunks) {
      this.update(chunk)
    }
  }

  public render(context: RenderContext): void {
    const chunks = Object.values(this.internal)
    for (const chunkImage of chunks) {
      chunkImage.debug(this.debugInformation)
      chunkImage.prerender(context)
    }
    const chunksOrdered = chunks.sort((a, b) =>
      a.isSelected && b.isSelected ? 0 : a.isSelected ? 1 : b.isSelected ? -1 : 0
    )
    for (const chunkImage of chunksOrdered) chunkImage.render(context)
    context.selection.invalidate()
    if (context.keyboard.isDown('Delete')) {
      const positions: Array<GridVector2> = []
      for (const chunkImage of chunks) {
        if (chunkImage.isSelected) positions.push(chunkImage.chunk.position)
      }
      for (const position of positions) {
        this.aggregator.remove(position)
        delete this.internal[position.toString()]
      }
    }
  }
}

export default ChunkMap
