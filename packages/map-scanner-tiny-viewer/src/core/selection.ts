/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { CanvasRenderingContext2D } from 'canvas'
import { EventCallbacks, EventEmitter, Nullable, Rectangle, RectangleLike, Vector2Like } from 'shared'
import { MouseButton, MouseEvent } from './mouse'
import Surface from './surface'
import CanvasRenderingContext2DTransformHelper from './ctx-transform-helper'
import RenderContext from './render-context'

export enum SelectionEvent {
  Begin,
  Intermediate,
  End,
  Cancelled
}

export interface SelectionEventCallbacks extends EventCallbacks {
  [SelectionEvent.Begin]: (start: Vector2Like) => void
  [SelectionEvent.Intermediate]: (intermediate: Vector2Like) => void
  [SelectionEvent.End]: (end: Vector2Like) => void
  [SelectionEvent.Cancelled]: () => void
}

export interface SelectionOptions {
  mouseButton: MouseButton
}

/**
 *
 */
export class Selection extends EventEmitter<SelectionEventCallbacks> {
  private readonly surface: Surface
  private ctx: CanvasRenderingContext2D

  private start: Nullable<Vector2Like>
  private end: Nullable<Vector2Like>
  private intermediate: Nullable<Vector2Like>

  private mouseButton: Nullable<MouseButton>

  public constructor(surface: Surface, options: Partial<SelectionOptions> = {}) {
    super()

    this.surface = surface
    this.ctx = this.surface.getContext('2d')
    this.start = null
    this.end = null
    this.intermediate = null
    this.mouseButton = options.mouseButton ?? null

    this.surface.mouse.on(MouseEvent.Down, (x, y, button) => {
      if (this.mouseButton !== null && this.mouseButton !== button) {
        if (this.start !== null && (this.intermediate !== null || this.end !== null)) {
          this.dispatcher.emit(SelectionEvent.Cancelled)
        }
        this.start = null
        this.end = null
        this.intermediate = null
        return
      }
      this.end = null
      this.intermediate = null
      this.start = CanvasRenderingContext2DTransformHelper.screenToWorld(this.ctx, x, y)
      this.dispatcher.emit(SelectionEvent.Begin, { x: this.start.x, y: this.start.y })
    })

    this.surface.mouse.on(MouseEvent.Move, (x, y) => {
      if (this.start === null || this.end !== null) return
      this.intermediate = CanvasRenderingContext2DTransformHelper.screenToWorld(this.ctx, x, y)
      this.dispatcher.emit(SelectionEvent.Intermediate, { x: this.intermediate.x, y: this.intermediate.y })
    })

    this.surface.mouse.on(MouseEvent.Up, (x, y) => {
      if (this.start === null) return
      this.intermediate = null
      this.end = CanvasRenderingContext2DTransformHelper.screenToWorld(this.ctx, x, y)
      this.dispatcher.emit(SelectionEvent.Intermediate, { x: this.end.x, y: this.end.y })
    })
  }

  contains(point: Vector2Like): boolean
  contains(rectangle: RectangleLike): boolean
  public contains(coord: RectangleLike | Vector2Like): boolean {
    const data = {
      x: coord.x,
      y: coord.y,
      width: (coord as RectangleLike).width ?? 0,
      height: (coord as RectangleLike).height ?? 0
    }
    const region = this.region()
    if (!region) return false
    return Rectangle.intersect(region, data)
  }

  private computeRegion(start: Nullable<Vector2Like>, end: Nullable<Vector2Like>): Nullable<RectangleLike> {
    if (!start || !end) return null
    const sx = Math.min(start.x, end.x)
    const sy = Math.min(start.y, end.y)
    const ex = Math.max(start.x, end.x)
    const ey = Math.max(start.y, end.y)
    return { x: sx, y: sy, width: ex - sx, height: ey - sy }
  }

  public region(): Nullable<RectangleLike> {
    return this.computeRegion(this.start, this.end)
  }

  public invalidate(): void {
    if (!this.end) return
    this.start = null
    this.intermediate = null
    this.end = null
  }

  public render(context: RenderContext): void {
    const ctx = context.ctx
    const rect = this.computeRegion(this.start, this.intermediate)
    if (!rect) return
    ctx.save()
    const a = CanvasRenderingContext2DTransformHelper.worldToScreen(ctx, rect.x, rect.y)
    const b = CanvasRenderingContext2DTransformHelper.worldToScreen(ctx, rect.x + rect.width, rect.y + rect.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.fillStyle = 'rgba(0,199,248,0.4)'
    ctx.fill()
    ctx.beginPath()
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.strokeStyle = 'rgb(0,199,248)'
    ctx.stroke()
    ctx.restore()
  }
}

export default Selection
