import { Nullable } from '../utils/helpers'
import Mouse, { MouseButton, MouseEventType } from '../core/mouse'
import { Transform } from '../core/transform'
import { Vector2Like } from '../core/vector2'
import {
  RenderingMouseDownEvent,
  RenderingMouseMoveEvent,
  RenderingMouseUpEvent,
  RenderingMouseWheelEvent,
  RenderNode
} from './render-node'

export interface PanZoomOptions {
  panMouseButton: MouseButton
}

export class PanZoom extends RenderNode {
  public readonly transform: Transform
  private panMouseButton: Nullable<MouseButton>
  private lastPoint: Nullable<Vector2Like> = null
  private lastSize: Vector2Like = { x: 0, y: 0 }

  public constructor(options: Partial<PanZoomOptions> = {}) {
    super()
    this.panMouseButton = options.panMouseButton ?? null
    this.transform = new Transform()
  }

  override isPointInside(x: number, y: number): boolean {
    return true
  }

  public override onMouseDown(event: RenderingMouseDownEvent): void {
    this.handleMouseDown(event.localX, event.localY, event.button)
  }

  public override onMouseUp(event: RenderingMouseUpEvent): void {
    this.handleMouseUp()
  }

  public override onMouseMove(event: RenderingMouseMoveEvent): void {
    this.handleMouseMove(event.localX, event.localY)
  }

  public override onMouseWheel(event: RenderingMouseWheelEvent): void {
    this.handleMouseWheel(event.localX, event.localY, event.deltaY)
  }

  private handleMouseDown = (x: number, y: number, button: MouseButton) => {
    if (this.panMouseButton !== null && this.panMouseButton !== button) {
      this.lastPoint = null
      return
    }
    this.lastPoint = this.transform.screenToWorld(x, y)
  }

  private handleMouseMove = (x: number, y: number) => {
    if (!this.lastPoint) return
    const currentPoint = this.transform.screenToWorld(x, y)
    this.transform.translate(currentPoint.x - this.lastPoint.x, currentPoint.y - this.lastPoint.y)
    this.lastPoint = this.transform.screenToWorld(x, y)
  }

  private handleMouseUp = () => {
    this.lastPoint = null
  }

  private handleMouseWheel = (x: number, y: number, deltaY: number) => {
    const zoomCenter = this.transform.screenToWorld(x, y)
    const factor = Math.sign(deltaY) > 0 ? 0.9 : 1.1
    this.transform.translate(zoomCenter.x, zoomCenter.y)
    this.transform.scale(factor, factor)
    this.transform.translate(-zoomCenter.x, -zoomCenter.y)
  }

  protected override draw(ctx: CanvasRenderingContext2D): void {
    this.lastSize = { x: ctx.canvas.width / 2, y: ctx.canvas.height / 2 }
    //ctx.translate(this.lastSize.x, this.lastSize.y)
  }
}
