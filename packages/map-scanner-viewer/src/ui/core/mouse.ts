/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { EventCallbacks, EventEmitter, Rectangle, RectangleLike, Vector2Like, Writeable } from 'shared'
import CanvasRenderingContext2DTransformHelper from './ctx-transform-helper'

export enum MouseButton {
  None,
  Left,
  Middle,
  Right,
  Unknow
}

export enum MouseEvent {
  Enter,
  Leave,
  Down,
  Up,
  Move,
  Wheel
}

export interface MouseEventCallbacks extends EventCallbacks {
  [MouseEvent.Enter]: () => void
  [MouseEvent.Leave]: () => void
  [MouseEvent.Down]: (x: number, y: number, button: MouseButton) => void
  [MouseEvent.Up]: (x: number, y: number) => void
  [MouseEvent.Move]: (x: number, y: number) => void
  [MouseEvent.Wheel]: (x: number, y: number, delta: number) => void
}

/**
 *
 */
export class Mouse extends EventEmitter<MouseEventCallbacks> implements Vector2Like {
  private readonly ctx: CanvasRenderingContext2D
  public readonly x: number = 0
  public readonly y: number = 0
  public readonly button: MouseButton = MouseButton.None
  public readonly active: boolean = true

  public constructor(ctx: CanvasRenderingContext2D) {
    super()
    this.ctx = ctx

    ctx.canvas.addEventListener('mouseleave', () => {
      ;(<Writeable<Mouse>>this).active = false
      this.dispatcher.emit(MouseEvent.Leave)
    })
    ctx.canvas.addEventListener('mouseenter', () => {
      ;(<Writeable<Mouse>>this).active = false
      this.dispatcher.emit(MouseEvent.Leave)
    })
    ctx.canvas.addEventListener('mousedown', (e) => {
      switch (e.button) {
        case 0:
          ;(<Writeable<Mouse>>this).button = MouseButton.Left
          break
        case 1:
          ;(<Writeable<Mouse>>this).button = MouseButton.Middle
          break
        case 2:
          ;(<Writeable<Mouse>>this).button = MouseButton.Right
          break
        default:
          ;(<Writeable<Mouse>>this).button = MouseButton.Unknow
          break
      }
      this.dispatcher.emit(MouseEvent.Down, e.x, e.y, this.button)
    })
    ctx.canvas.addEventListener('mouseup', (e) => {
      ;(<Writeable<Mouse>>this).button = MouseButton.None
      this.dispatcher.emit(MouseEvent.Up, e.x, e.y)
    })
    ctx.canvas.addEventListener('mousemove', (e) => {
      ;(<Writeable<Mouse>>this).x = e.x
      ;(<Writeable<Mouse>>this).y = e.y
      this.dispatcher.emit(MouseEvent.Move, e.x, e.y)
    })
    ctx.canvas.addEventListener('wheel', (e) => {
      ;(<Writeable<Mouse>>this).x = e.x
      ;(<Writeable<Mouse>>this).y = e.y
      this.dispatcher.emit(MouseEvent.Wheel, e.x, e.y, e.deltaY)
    })
  }

  public isIn(rectangle: RectangleLike): boolean {
    if (!this.active) return false
    const pt = CanvasRenderingContext2DTransformHelper.screenToWorld(this.ctx, this.x, this.y)
    return Rectangle.intersect(
      {
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0
      },
      rectangle
    )
  }
}

export default Mouse
