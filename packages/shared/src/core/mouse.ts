/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Writeable } from '../utils/helpers'
import CanvasRenderingContext2DTransformHelper from './ctx-transform-helper'
import { Destroyable } from './destroyable'
import EventEmitter, { EventCallbacks } from './event-emitter'
import Rectangle, { RectangleLike } from './rectangle'
import { Vector2Like } from './vector2'

export enum MouseButton {
  None,
  Left,
  Middle,
  Right,
  Unknown
}

export enum MouseEventType {
  Enter,
  Leave,
  Down,
  Up,
  Move,
  Wheel
}

export interface MouseEventCallbacks extends EventCallbacks {
  [MouseEventType.Enter]: () => void
  [MouseEventType.Leave]: () => void
  [MouseEventType.Down]: (x: number, y: number, button: MouseButton) => void
  [MouseEventType.Up]: (x: number, y: number) => void
  [MouseEventType.Move]: (x: number, y: number) => void
  [MouseEventType.Wheel]: (x: number, y: number, delta: number) => void
}

/**
 *
 */
export class Mouse extends EventEmitter<MouseEventCallbacks> implements Destroyable, Vector2Like {
  private readonly ctx: CanvasRenderingContext2D
  public readonly x: number = 0
  public readonly y: number = 0
  public readonly button: MouseButton = MouseButton.None
  public readonly active: boolean = true

  private mouseLeaveListener: () => void
  private mouseEnterListener: () => void
  private mouseDownListener: (e: MouseEvent) => void
  private mouseUpListener: (e: MouseEvent) => void
  private mouseMoveListener: (e: MouseEvent) => void
  private wheelListener: (e: WheelEvent) => void

  public static convertDOMMouseButton(button: number): MouseButton {
    switch (button) {
      case 0:
        return MouseButton.Left
      case 1:
        return MouseButton.Middle
      case 2:
        return MouseButton.Right
      default:
        return MouseButton.Unknown
    }
  }

  public constructor(ctx: CanvasRenderingContext2D) {
    super()
    this.ctx = ctx

    this.mouseLeaveListener = () => {
      ;(<Writeable<Mouse>>this).active = false
      this.dispatcher.emit(MouseEventType.Leave)
    }

    this.mouseEnterListener = () => {
      ;(<Writeable<Mouse>>this).active = true
      this.dispatcher.emit(MouseEventType.Enter)
    }

    this.mouseDownListener = (e: MouseEvent) => {
      ;(<Writeable<Mouse>>this).button = Mouse.convertDOMMouseButton(e.button)
      const rect = this.ctx.canvas.getBoundingClientRect()
      ;(<Writeable<Mouse>>this).x = e.clientX - rect.left
      ;(<Writeable<Mouse>>this).y = e.clientY - rect.top
      this.dispatcher.emit(MouseEventType.Down, this.x, this.y, this.button)
    }

    this.mouseUpListener = (e: MouseEvent) => {
      ;(<Writeable<Mouse>>this).button = MouseButton.None
      const rect = this.ctx.canvas.getBoundingClientRect()
      ;(<Writeable<Mouse>>this).x = e.clientX - rect.left
      ;(<Writeable<Mouse>>this).y = e.clientY - rect.top
      this.dispatcher.emit(MouseEventType.Up, this.x, this.y)
    }

    this.mouseMoveListener = (e: MouseEvent) => {
      const rect = this.ctx.canvas.getBoundingClientRect()
      ;(<Writeable<Mouse>>this).x = e.clientX - rect.left
      ;(<Writeable<Mouse>>this).y = e.clientY - rect.top
      this.dispatcher.emit(MouseEventType.Move, this.x, this.y)
    }

    this.wheelListener = (e: WheelEvent) => {
      const rect = this.ctx.canvas.getBoundingClientRect()
      ;(<Writeable<Mouse>>this).x = e.clientX - rect.left
      ;(<Writeable<Mouse>>this).y = e.clientY - rect.top
      this.dispatcher.emit(MouseEventType.Wheel, this.x, this.y, e.deltaY)
    }

    this.ctx.canvas.addEventListener('mouseleave', this.mouseLeaveListener)
    this.ctx.canvas.addEventListener('mouseenter', this.mouseEnterListener)
    this.ctx.canvas.addEventListener('mousedown', this.mouseDownListener)
    this.ctx.canvas.addEventListener('mouseup', this.mouseUpListener)
    this.ctx.canvas.addEventListener('mousemove', this.mouseMoveListener)
    this.ctx.canvas.addEventListener('wheel', this.wheelListener)
  }

  public destroy(): void {
    this.ctx.canvas.removeEventListener('mouseleave', this.mouseLeaveListener)
    this.ctx.canvas.removeEventListener('mouseenter', this.mouseEnterListener)
    this.ctx.canvas.removeEventListener('mousedown', this.mouseDownListener)
    this.ctx.canvas.removeEventListener('mouseup', this.mouseUpListener)
    this.ctx.canvas.removeEventListener('mousemove', this.mouseMoveListener)
    this.ctx.canvas.removeEventListener('wheel', this.wheelListener)
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
