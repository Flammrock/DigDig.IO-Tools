/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Nullable, Transform, Vector2Like } from 'shared'
import { CanvasRenderingContext2D } from 'canvas'
import { Surface } from './surface'
import { MouseButton, MouseEvent } from './mouse'

export interface PanZoomOptions {
  panMouseButton: MouseButton
}

export class PanZoom {
  public readonly transform: Transform
  private ctx: CanvasRenderingContext2D
  private panMouseButton: Nullable<MouseButton>

  public constructor(surface: Surface, options: Partial<PanZoomOptions> = {}) {
    this.ctx = surface.getContext('2d')
    this.panMouseButton = options.panMouseButton ?? null
    this.transform = new Transform()
    let lastPoint: Nullable<Vector2Like> = null
    surface.mouse.on(MouseEvent.Down, (x, y, button) => {
      if (this.panMouseButton !== null && this.panMouseButton !== button) {
        lastPoint = null
        return
      }
      lastPoint = this.transform.screenToWorld(x, y)
    })
    surface.mouse.on(MouseEvent.Move, (x, y) => {
      if (!lastPoint) return
      const currentPoint = this.transform.screenToWorld(x, y)
      this.transform.translate(currentPoint.x - lastPoint.x, currentPoint.y - lastPoint.y)
      lastPoint = this.transform.screenToWorld(x, y)
    })
    surface.mouse.on(MouseEvent.Up, (x, y) => {
      lastPoint = null
    })
    surface.mouse.on(MouseEvent.Wheel, (x, y, deltaY) => {
      const zoomCenter = this.transform.screenToWorld(x, y)
      const factor = Math.sign(deltaY) > 0 ? 1.1 : 0.9
      this.transform.translate(zoomCenter.x, zoomCenter.y)
      this.transform.scale(factor, factor)
      this.transform.translate(-zoomCenter.x, -zoomCenter.y)
    })
  }

  public apply() {
    this.ctx.setTransform(
      this.transform.a,
      this.transform.b,
      this.transform.c,
      this.transform.d,
      this.transform.e,
      this.transform.f
    )
  }
}

export default PanZoom
