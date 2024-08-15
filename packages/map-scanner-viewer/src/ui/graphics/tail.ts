/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { RecentItems, Vector2, Vector2Like } from 'shared'
import Renderable from '../core/renderable'
import RenderContext from '../core/render-context'

/**
 *
 */
export class Tail implements Renderable {
  private positions: RecentItems<Vector2Like>

  public constructor(maxSize = 30) {
    this.positions = new RecentItems(maxSize)
  }

  public computeLength(): number {
    let length = 0
    const positions = this.positions.list()
    for (let i = 0; i < positions.length - 1; i++) {
      length += Math.hypot(positions[i].x - positions[i + 1].x, positions[i].y - positions[i + 1].y)
    }
    return length
  }

  public insert(position: Vector2Like): void {
    const last = this.positions.last()
    if (last !== null && Vector2.equals(position, last)) return
    this.positions.insert(position)
  }

  public render(context: RenderContext): void {
    if (this.positions.length === 0) return
    const positions = this.positions.list()
    const totalLength = this.computeLength()
    if (totalLength < 0) return
    const ctx = context.ctx
    ctx.save()
    try {
      let currentLength = 0
      for (let i = 0; i < positions.length - 1; i++) {
        const current = positions[i]
        const next = positions[i + 1]
        const gradient = ctx.createLinearGradient(current.x, current.y, next.x, next.y)
        const startAlpha = currentLength / totalLength
        currentLength += Math.hypot(current.x - next.x, current.y - next.y)
        const endAlpha = currentLength / totalLength
        gradient.addColorStop(0, `rgba(255, 0, 0, ${startAlpha})`)
        gradient.addColorStop(1, `rgba(255, 0, 0, ${endAlpha})`)
        ctx.strokeStyle = gradient
        ctx.beginPath()
        ctx.moveTo(current.x, current.y)
        ctx.lineTo(next.x, next.y)
        ctx.stroke()
      }
    } finally {
      ctx.restore()
    }
  }
}

export default Tail
