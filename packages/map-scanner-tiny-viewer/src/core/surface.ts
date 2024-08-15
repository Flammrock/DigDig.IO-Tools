/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import sdl from '@kmamal/sdl'
import { Canvas, CanvasRenderingContext2D, createCanvas, registerFont } from 'canvas'
import { setLoop, clearLoop } from './loop'
import { EventCallbacks, EventEmitter } from 'shared'
import Fonts from './fonts'
import Mouse, { MouseButton } from './mouse'
import Keyboard from './keyboard'

for (const font of Fonts) {
  registerFont(font.filePath, { family: font.name })
}

export interface SurfaceOptions {
  title: string
}

export enum SurfaceEvent {
  Render,
  Close
}

export interface SurfaceEventCallbacks extends EventCallbacks {
  [SurfaceEvent.Render]: (ctx: CanvasRenderingContext2D) => void
  [SurfaceEvent.Close]: () => void
}

/**
 * @example
 * ```
 * let mouse: Vector2Like = { x: 0, y: 0 }
 * const surface = new Surface()
 * const panZoom = new PanZoom(surface)
 * surface.on(SurfaceEvent.MouseMove, (x, y) => {
 *   mouse = { x, y }
 * })
 * surface.on(SurfaceEvent.Render, (ctx) => {
 *   surface.clear()
 *   panZoom.apply()
 *
 *   const m = panZoom.transform.screenToWorld(mouse)
 *
 *   ctx.beginPath()
 *   ctx.fillStyle = 'red'
 *   ctx.rect(-32, -32, 64, 64)
 *   ctx.fill()
 *
 *   ctx.beginPath()
 *   ctx.fillStyle = 'white'
 *   ctx.rect(m.x - 32, m.y - 32, 64, 64)
 *   ctx.fill()
 * })
 * ```
 */
export class Surface extends EventEmitter<SurfaceEventCallbacks> {
  private window: sdl.Sdl.Video.Window
  private canvas: Canvas
  private ctx: CanvasRenderingContext2D
  private loop: number
  private isDestroyed: boolean
  private isWindowDestroyed: boolean
  public readonly mouse: Mouse
  public readonly keyboard: Keyboard

  public constructor(options: Partial<SurfaceOptions> = {}) {
    super()
    this.isDestroyed = false
    this.isWindowDestroyed = false
    this.window = sdl.video.createWindow({
      title: options.title ?? 'Unnamed Window',
      vsync: true,
      accelerated: true,
      resizable: true
    })
    this.window.on('resize', (e) => {
      this.canvas.width = e.pixelWidth
      this.canvas.height = e.pixelHeight
    })
    this.window.on('beforeClose', () => {
      this.isWindowDestroyed = true
      this.destroy()
    })
    const { pixelWidth: width, pixelHeight: height } = this.window
    this.canvas = createCanvas(width, height)
    this.ctx = this.canvas.getContext('2d')
    this.mouse = new Mouse(this.window, this.ctx)
    this.keyboard = new Keyboard(this.window)
    this.loop = setLoop(this.loopCallback.bind(this))
  }

  private loopCallback(): void {
    if (this.isDestroyed) return
    if (this.window.destroyed) {
      this.isWindowDestroyed = true
      this.destroy()
      return
    }
    this.dispatcher.emit(SurfaceEvent.Render, this.ctx)
    const buffer = this.canvas.toBuffer('raw')
    this.window.render(this.canvas.width, this.canvas.height, this.canvas.width * 4, 'bgra32', buffer)
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
    this.dispatcher.emit(SurfaceEvent.Close)
    this.isDestroyed = true
    clearLoop(this.loop)
    if (!this.isWindowDestroyed) {
      this.isWindowDestroyed = true
      this.window.destroy()
    }
  }
}

export default Surface
