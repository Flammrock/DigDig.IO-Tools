/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { setLoop, clearLoop } from './loop'
import { EventCallbacks, EventEmitter } from 'shared'
import Mouse from './mouse'
import Keyboard from './keyboard'

export enum SurfaceEvent {
  Render,
  Destroy
}

export interface SurfaceEventCallbacks extends EventCallbacks {
  [SurfaceEvent.Render]: (ctx: CanvasRenderingContext2D) => void
  [SurfaceEvent.Destroy]: () => void
}

/**
 *
 */
export class Surface extends EventEmitter<SurfaceEventCallbacks> {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private loop: number
  private isDestroyed: boolean
  public readonly mouse: Mouse
  public readonly keyboard: Keyboard

  public get element(): HTMLCanvasElement {
    return this.canvas
  }

  public constructor() {
    super()
    this.isDestroyed = false
    this.canvas = document.createElement('canvas')
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.ctx = this.canvas.getContext('2d')
    this.mouse = new Mouse(this.ctx)
    this.keyboard = new Keyboard(this.ctx)
    this.loop = setLoop(this.loopCallback.bind(this))
  }

  private loopCallback(): void {
    if (this.isDestroyed) return
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
    this.dispatcher.emit(SurfaceEvent.Render, this.ctx)
  }

  public getContext(contextId: '2d'): CanvasRenderingContext2D {
    return this.canvas.getContext(contextId)
  }

  public clear(): void {
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  public destroy(): void {
    if (this.isDestroyed) return
    this.dispatcher.emit(SurfaceEvent.Destroy)
    this.isDestroyed = true
    clearLoop(this.loop)
  }
}

export default Surface
