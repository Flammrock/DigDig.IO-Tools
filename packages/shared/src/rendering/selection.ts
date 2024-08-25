import CanvasRenderingContext2DTransformHelper from '../core/ctx-transform-helper'
import { MouseButton } from '../core/mouse'
import Rectangle, { RectangleLike } from '../core/rectangle'
import { Vector2Like } from '../core/vector2'
import { Nullable, Writeable } from '../utils/helpers'
import {
  RenderingEvent,
  RenderingMouseDownEvent,
  RenderingMouseMoveEvent,
  RenderingMouseUpEvent,
  RenderNode
} from './render-node'

export class RenderingSelectionEvent extends RenderingEvent {
  public constructor(
    public readonly ctx: CanvasRenderingContext2D,
    public readonly startX: number,
    public readonly startY: number,
    public readonly endX: number,
    public readonly endY: number
  ) {
    super(ctx)
  }
}

/**
 * Weird but allow to do package scope
 * @see https://stackoverflow.com/questions/43971951/typescript-equivalent-of-package-scope
 */
interface RenderSelectableNodeUnlocker {
  propagateEvent(event: RenderingSelectionEvent): boolean
}

/*
export class SelectionArea {
  public constructor(
    private ctx: CanvasRenderingContext2D,
    private area: RectangleLike
  ) {}
  public intersect(rect: RectangleLike): boolean {
    const start = CanvasRenderingContext2DTransformHelper.worldToScreen(this.ctx, rect.x, rect.y)
    const end = CanvasRenderingContext2DTransformHelper.worldToScreen(
      this.ctx,
      rect.x + rect.width,
      rect.y + rect.height
    )
    const screenRect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    }
    console.log(this.area, screenRect)
    return Rectangle.intersect(this.area, screenRect)
  }
}
*/
export class RenderSelectableNode extends RenderNode {
  protected isSelectionInside(area: RectangleLike): boolean {
    // Override in subclasses
    return false
  }

  protected onSelect(event: RenderingSelectionEvent): void {
    // Override in subclasses
  }

  protected propagateEvent(event: RenderingSelectionEvent): boolean {
    // apply local transform to the event coordinate
    const oldstart = { x: event.startX, y: event.startY }
    const oldend = { x: event.endX, y: event.endY }
    const newstart = this.transform.applyTo({ x: event.startX, y: event.startY })
    const newend = this.transform.applyTo({ x: event.endX, y: event.endY })
    ;(<Writeable<RenderingSelectionEvent>>event).startX = newstart.x
    ;(<Writeable<RenderingSelectionEvent>>event).startY = newstart.y
    ;(<Writeable<RenderingSelectionEvent>>event).endX = newend.x
    ;(<Writeable<RenderingSelectionEvent>>event).endY = newend.y

    try {
      let notconcerned = false

      ///////////////////////////////////////////////
      /////////////// CAPTURING PHASE ///////////////
      ///////////////////[ START ]///////////////////
      // check if the event hits this node
      const rect: RectangleLike = {
        x: newstart.x,
        y: newstart.y,
        width: newend.x - newstart.x,
        height: newend.y - newstart.y
      }
      const mousein = this.isSelectionInside(rect)
      if (!mousein) {
        notconcerned = true
      }
      ////////////////////[ END ]////////////////////
      /////////////// CAPTURING PHASE ///////////////
      ///////////////////////////////////////////////

      ///////////////////////////////////////////////
      ///////////////// TARGET PHASE ////////////////
      ///////////////////[ START ]///////////////////
      // propagate to children
      const tryToPropagate = (that: RenderNode) => {
        let stopped = false
        for (const child of that.children) {
          if (child instanceof RenderSelectableNode) {
            if (child.propagateEvent(event)) stopped = true
            else if (tryToPropagate(child)) stopped = true
            // TODO: NEED TO APPLY THE CHILD TRANSFORM (BECAUSE THIS IS ACTUALLY SKIPPED)
          }
          return stopped
        }
      }
      const stopped = tryToPropagate(this)

      if (!notconcerned) {
        if (stopped) return true
      }
      ////////////////////[ END ]////////////////////
      ///////////////// TARGET PHASE ////////////////
      ///////////////////////////////////////////////

      ///////////////////////////////////////////////
      /////////////// BUBBLING PHASE ////////////////
      ///////////////////[ START ]///////////////////
      if (!notconcerned) {
        if (mousein) {
          if (this.mouseIn) this.onSelect(event) // custom event handler
        }
        if (event.isPropagationStoped()) return true
      }
      ////////////////////[ END ]////////////////////
      /////////////// BUBBLING PHASE ////////////////
      ///////////////////////////////////////////////
    } finally {
      ;(<Writeable<RenderingSelectionEvent>>event).startX = oldstart.x
      ;(<Writeable<RenderingSelectionEvent>>event).startY = oldstart.y
      ;(<Writeable<RenderingSelectionEvent>>event).endX = oldend.x
      ;(<Writeable<RenderingSelectionEvent>>event).endY = oldend.y
    }

    return false
  }
}

export interface SelectionOptions {
  mouseButton: MouseButton
}

export class Selection extends RenderNode {
  private start: Nullable<Vector2Like>
  private end: Nullable<Vector2Like>
  private intermediate: Nullable<Vector2Like>

  private mouseButton: Nullable<MouseButton>

  public constructor(options: Partial<SelectionOptions> = {}) {
    super()
    this.start = null
    this.end = null
    this.intermediate = null
    this.mouseButton = options.mouseButton ?? null
  }

  public override isPointInside(x: number, y: number): boolean {
    return true
  }

  protected propagateEvent(event: RenderingSelectionEvent): void {
    const tryToPropagate = (that: RenderNode) => {
      for (const child of that.children) {
        if (child instanceof RenderSelectableNode) {
          ;(<RenderSelectableNodeUnlocker>(<unknown>child)).propagateEvent(event)
        } else {
          tryToPropagate(child)
        }
      }
    }
    tryToPropagate(this)
  }

  protected override onMouseDown(event: RenderingMouseDownEvent): void {
    if (this.mouseButton !== null && this.mouseButton !== event.button) {
      if (this.start !== null && (this.intermediate !== null || this.end !== null)) {
        // selection aborted
        //this.dispatcher.emit(SelectionEvent.Cancelled)
      }
      this.start = null
      this.end = null
      this.intermediate = null
      return
    }
    this.end = null
    this.intermediate = null
    this.start = { x: event.clientX, y: event.clientY }
    /*this.dispatcher.emit(SelectionEvent.Begin, {
      x: this.start.x,
      y: this.start.y
    })*/
  }

  protected override onMouseMove(event: RenderingMouseMoveEvent): void {
    if (this.start === null || this.end !== null) return
    this.intermediate = { x: event.clientX, y: event.clientY }
    /*this.dispatcher.emit(SelectionEvent.Intermediate, {
      x: this.intermediate.x,
      y: this.intermediate.y
    })*/
  }

  protected override onMouseUp(event: RenderingMouseUpEvent): void {
    if (this.start === null) return
    this.intermediate = null
    this.end = { x: event.clientX, y: event.clientY }
    const area = this.computeRegion(this.start, this.end)
    if (area)
      this.propagateEvent(
        new RenderingSelectionEvent(event.ctx, area.x, area.y, area.x + area.width, area.y + area.height)
      )
    /*this.dispatcher.emit(SelectionEvent.End, {
      x: this.end.x,
      y: this.end.y
    })*/
  }

  /**
   * **Note:** Coordinate must be provided in the screen space.
   * So use CanvasRenderingContext2DTransformHelper.worldToScreen before.
   *
   * @param point
   */
  contains(point: Vector2Like): boolean
  /**
   * **Note:** Coordinate must be provided in the screen space.
   * So use CanvasRenderingContext2DTransformHelper.worldToScreen before.
   *
   * @param rectangle
   */
  contains(rectangle: RectangleLike): boolean
  public contains(coord: RectangleLike | Vector2Like): boolean {
    // TODO: retrieve selection area in the screen space
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

  public draw(ctx: CanvasRenderingContext2D): void {
    const rect = this.computeRegion(this.start, this.intermediate)
    if (!rect) return
    ctx.save()
    const a = { x: rect.x, y: rect.y }
    const b = { x: rect.x + rect.width, y: rect.y + rect.height }
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
