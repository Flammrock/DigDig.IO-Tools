/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { ChunkSize, Vector2Like } from 'shared'
import Renderable from '../core/renderable'
import RenderContext from '../core/render-context'

export interface ChunkPlaceholderOptions {
  position: Vector2Like
}

/**
 *
 */
export class ChunkPlaceholder implements Renderable {
  private position: Vector2Like

  public constructor(options: Partial<ChunkPlaceholderOptions> = {}) {
    this.position = options.position ?? { x: 0, y: 0 }
  }

  public render(context: RenderContext): void {
    const ctx = context.ctx
    ctx.beginPath()
    ctx.strokeStyle = 'red'
    ctx.rect(this.position.x * ChunkSize, this.position.y * ChunkSize, ChunkSize, ChunkSize)
    ctx.stroke()
  }
}

export default ChunkPlaceholder
