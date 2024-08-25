import CanvasRenderingContext2DTransformHelper from '../core/ctx-transform-helper'
import Mouse, { MouseButton } from '../core/mouse'
import { Transform, TransformLike } from '../core/transform'
import { Vector2Like } from '../core/vector2'
import { Nullable, Writeable } from '../utils/helpers'

// TODO: add keyboard event
// TODO: disable mouse when mouse out of canvas???
// TODO: add selection event (configurable to the surface components)
// TODO: add click event
// TODO: add gaphics example in ./shared/rendering/basics/square.ts
// TODO: add transition system
// TODO: add animation system (????)
// TODO: add camera????

export abstract class RenderingEvent {
  public readonly target: Nullable<RenderNode> = null
  private isPropagationStopedInternal: boolean = false
  public constructor(public readonly ctx: CanvasRenderingContext2D) {}
  public stopPropagation(): void {
    this.isPropagationStopedInternal = true
  }
  public isPropagationStoped(): boolean {
    return this.isPropagationStopedInternal
  }
}

export class RenderingMouseEvent extends RenderingEvent {
  public constructor(
    public readonly ctx: CanvasRenderingContext2D,
    public readonly clientX: number,
    public readonly clientY: number,
    public readonly localX: number,
    public readonly localY: number,
    public readonly x: number,
    public readonly y: number
  ) {
    super(ctx)
  }
}

export class RenderingMouseDownEvent extends RenderingMouseEvent {
  public constructor(
    public readonly ctx: CanvasRenderingContext2D,
    public readonly clientX: number,
    public readonly clientY: number,
    public readonly localX: number,
    public readonly localY: number,
    public readonly x: number,
    public readonly y: number,
    public readonly button: MouseButton
  ) {
    super(ctx, clientX, clientY, localX, localY, x, y)
  }
}

export class RenderingMouseUpEvent extends RenderingMouseEvent {
  public constructor(
    public readonly ctx: CanvasRenderingContext2D,
    public readonly clientX: number,
    public readonly clientY: number,
    public readonly localX: number,
    public readonly localY: number,
    public readonly x: number,
    public readonly y: number,
    public readonly button: MouseButton
  ) {
    super(ctx, clientX, clientY, localX, localY, x, y)
  }
}

export class RenderingMouseMoveEvent extends RenderingMouseEvent {}

export class RenderingMouseEnterEvent extends RenderingMouseEvent {}

export class RenderingMouseLeaveEvent extends RenderingMouseEvent {}

export class RenderingMouseWheelEvent extends RenderingMouseEvent {
  public constructor(
    public readonly ctx: CanvasRenderingContext2D,
    public readonly clientX: number,
    public readonly clientY: number,
    public readonly localX: number,
    public readonly localY: number,
    public readonly x: number,
    public readonly y: number,
    public readonly deltaX: number,
    public readonly deltaY: number
  ) {
    super(ctx, clientX, clientY, localX, localY, x, y)
  }
}

type RenderNodeMouseEventName = 'MouseDown' | 'MouseUp' | 'MouseMove' | 'MouseWheel'

export abstract class RenderNode {
  protected tree: Array<RenderNode>
  protected visible: boolean
  protected zIndex: number
  protected parent: Nullable<RenderNode>
  protected mouseIn: boolean
  protected lastMouseEvent: Nullable<RenderingMouseEvent>

  public readonly transform: Transform

  public get children(): ReadonlyArray<RenderNode> {
    return this.tree
  }

  public constructor() {
    this.tree = []
    this.transform = new Transform()
    this.visible = true
    this.zIndex = 0
    this.parent = null
    this.mouseIn = false
    this.lastMouseEvent = null
  }

  public show(): void {
    this.visible = true
  }

  public hide(): void {
    this.visible = false
  }

  public isVisible(): boolean {
    return this.visible
  }

  public add(child: RenderNode): this {
    this.tree.push(child)
    child.parent = this
    // Sort children by zIndex
    this.tree.sort((a, b) => a.zIndex - b.zIndex)
    return this
  }

  public remove(child: RenderNode): this {
    const index = this.tree.indexOf(child)
    if (index > -1) {
      this.tree.splice(index, 1)
      child.parent = null
    }
    return this
  }

  public removeChildren() {
    this.tree = []
  }

  public translate(x: number, y: number): this {
    this.transform.translate(x, y)
    return this
  }

  public scale(sx: number, sy: number): this {
    this.transform.scale(sx, sy)
    return this
  }

  public rotate(angle: number): this {
    this.transform.rotate(angle)
    return this
  }

  setTransform(transform: TransformLike): this
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): this
  public setTransform(a: number | TransformLike, b?: number, c?: number, d?: number, e?: number, f?: number): this {
    this.transform.set(
      a as unknown as number,
      b as unknown as number,
      c as unknown as number,
      d as unknown as number,
      e as unknown as number,
      f as unknown as number
    )
    return this
  }

  // TODO: transform method
  // TODO: save method???
  // TODO: restore method???

  public isPointInside(x: number, y: number): boolean {
    // Override in subclasses
    return false
  }

  private handleMouseEnter(event: RenderingMouseEnterEvent): void {
    const oldpos = { x: event.x, y: event.y }
    const oldlocalpos = { x: event.localX, y: event.localY }
    const newpos = this.transform.applyTo(event)
    ;(<Writeable<RenderingMouseEnterEvent>>event).x = newpos.x
    ;(<Writeable<RenderingMouseEnterEvent>>event).y = newpos.y
    ;(<Writeable<RenderingMouseEnterEvent>>event).localX = oldpos.x
    ;(<Writeable<RenderingMouseEnterEvent>>event).localY = oldpos.y
    try {
      const mousein = this.isPointInside(newpos.x, newpos.y)
      let mouseenter = false
      if (mousein && !this.mouseIn) {
        this.mouseIn = true
        mouseenter = true
      }
      for (const child of this.tree) {
        child.handleMouseEnter(event)
      }
      if (mousein && mouseenter) {
        this.onMouseEnter(event) // custom event handler
      }
    } finally {
      ;(<Writeable<RenderingMouseEnterEvent>>event).x = oldpos.x
      ;(<Writeable<RenderingMouseEnterEvent>>event).y = oldpos.y
      ;(<Writeable<RenderingMouseEnterEvent>>event).localX = oldlocalpos.x
      ;(<Writeable<RenderingMouseEnterEvent>>event).localY = oldlocalpos.y
    }
  }

  private handleMouseLeave(event: RenderingMouseLeaveEvent): void {
    const oldpos = { x: event.x, y: event.y }
    const newpos = this.transform.applyTo(event)
    ;(<Writeable<RenderingMouseLeaveEvent>>event).x = newpos.x
    ;(<Writeable<RenderingMouseLeaveEvent>>event).y = newpos.y
    try {
      const mousein = this.isPointInside(newpos.x, newpos.y)
      let mouseleave = false
      if (!mousein && this.mouseIn) {
        this.mouseIn = false
        mouseleave = true
        // this.onMouseLeave(event) // custom event handler
      }
      for (const child of this.tree) {
        child.handleMouseLeave(event)
      }
      if (!mousein && mouseleave) {
        this.onMouseLeave(event) // custom event handler
      }
    } finally {
      ;(<Writeable<RenderingMouseLeaveEvent>>event).x = oldpos.x
      ;(<Writeable<RenderingMouseLeaveEvent>>event).y = oldpos.y
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return

    if (this.parent === null && this.lastMouseEvent) {
      this.handleMouseEnter(
        new RenderingMouseEnterEvent(
          ctx,
          this.lastMouseEvent.clientX,
          this.lastMouseEvent.clientY,
          this.lastMouseEvent.localX,
          this.lastMouseEvent.localY,
          this.lastMouseEvent.x,
          this.lastMouseEvent.y
        )
      )
      this.handleMouseLeave(
        new RenderingMouseLeaveEvent(
          ctx,
          this.lastMouseEvent.clientX,
          this.lastMouseEvent.clientY,
          this.lastMouseEvent.localX,
          this.lastMouseEvent.localY,
          this.lastMouseEvent.x,
          this.lastMouseEvent.y
        )
      )
    }

    ctx.save()

    try {
      // Apply transformations
      const { a, b, c, d, e, f } = this.transform
      ctx.transform(a, b, c, d, e, f)

      this.draw(ctx)

      // Render children
      for (const child of this.tree) {
        child.render(ctx)
      }
    } finally {
      ctx.restore()
    }
  }

  /**
   * Propagates the given DOM event through the rendering tree.
   *
   * @param event - Any DOM Event to propagate in this rendering tree.
   * @throws Throws an error if the provided event object is malformed or if the event is being propagated from a non-root node.
   */
  public handleEvent(ctx: CanvasRenderingContext2D, event: Event): void {
    if (this.parent !== null) throw new Error('A DOM Event should only be propagated from the root of the tree.')

    // ignore if the provided event is not actually an event
    if (!event || typeof event !== 'object' || !event.type) return

    const computeMouseCoordinateLocalSpace = (event: MouseEvent | WheelEvent): Vector2Like => {
      const rect = ctx.canvas.getBoundingClientRect()
      // no use of offsetX/offsetY to be more general (should work with any dom event)
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      }
    }

    const computeMouseCoordinateWorldSpace = (pt: Vector2Like): Vector2Like => {
      return CanvasRenderingContext2DTransformHelper.screenToWorld(ctx, pt.x, pt.y)
    }

    switch (event.type) {
      case 'mousedown':
        {
          const mouseEvent = event as MouseEvent
          const pt = computeMouseCoordinateLocalSpace(mouseEvent)
          const pos = computeMouseCoordinateWorldSpace(pt)
          this.handleMouseDownEvent(
            new RenderingMouseDownEvent(
              ctx,
              pt.x,
              pt.y,
              pos.x,
              pos.y,
              pos.x,
              pos.y,
              Mouse.convertDOMMouseButton(mouseEvent.button)
            )
          )
        }
        break
      case 'mouseup':
        {
          const mouseEvent = event as MouseEvent
          const pt = computeMouseCoordinateLocalSpace(mouseEvent)
          const pos = computeMouseCoordinateWorldSpace(pt)
          this.handleMouseUpEvent(
            new RenderingMouseUpEvent(
              ctx,
              pt.x,
              pt.y,
              pos.x,
              pos.y,
              pos.x,
              pos.y,
              Mouse.convertDOMMouseButton(mouseEvent.button)
            )
          )
        }
        break
      case 'mousemove':
        {
          const mouseEvent = event as MouseEvent
          const pt = computeMouseCoordinateLocalSpace(mouseEvent)
          const pos = computeMouseCoordinateWorldSpace(pt)
          this.handleMouseMoveEvent(new RenderingMouseMoveEvent(ctx, pt.x, pt.y, pos.x, pos.y, pos.x, pos.y))
        }
        break
      case 'wheel': // 'mousewheel' is deprecated in favor of 'wheel'
        {
          const mouseWheelEvent = event as WheelEvent
          const pt = computeMouseCoordinateLocalSpace(mouseWheelEvent)
          const pos = computeMouseCoordinateWorldSpace(pt)
          this.handleMouseWheelEvent(
            new RenderingMouseWheelEvent(
              ctx,
              pt.x,
              pt.y,
              pos.x,
              pos.y,
              pos.x,
              pos.y,
              mouseWheelEvent.deltaX,
              mouseWheelEvent.deltaY
            )
          )
        }
        break
    }
  }

  protected handleMouseEvent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
    onMethodName: `on${RenderNodeMouseEventName}`
  ): boolean {
    if (!this.visible) return false

    this.lastMouseEvent = event

    // apply local transform to the event coordinate
    const oldpos = { x: event.x, y: event.y }
    const oldlocalpos = { x: event.localX, y: event.localY }
    const newpos = this.transform.applyTo(event)
    ;(<Writeable<RenderingMouseMoveEvent>>event).x = newpos.x
    ;(<Writeable<RenderingMouseMoveEvent>>event).y = newpos.y
    ;(<Writeable<RenderingMouseMoveEvent>>event).localX = oldpos.x
    ;(<Writeable<RenderingMouseMoveEvent>>event).localY = oldpos.y

    try {
      let notconcerned = false

      ///////////////////////////////////////////////
      /////////////// CAPTURING PHASE ///////////////
      ///////////////////[ START ]///////////////////
      // check if the event hits this node
      const mousein = this.isPointInside(newpos.x, newpos.y)
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
      let stopped = false
      for (const child of this.tree) {
        if (child.handleMouseEvent(event, onMethodName)) stopped = true
      }
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
          if (this.mouseIn) this[onMethodName](event) // custom event handler
        }
        if (event.isPropagationStoped()) return true
      }
      ////////////////////[ END ]////////////////////
      /////////////// BUBBLING PHASE ////////////////
      ///////////////////////////////////////////////
    } finally {
      ;(<Writeable<RenderingMouseMoveEvent>>event).x = oldpos.x
      ;(<Writeable<RenderingMouseMoveEvent>>event).y = oldpos.y
      ;(<Writeable<RenderingMouseMoveEvent>>event).localX = oldlocalpos.x
      ;(<Writeable<RenderingMouseMoveEvent>>event).localY = oldlocalpos.y
    }

    return false
  }

  private handleMouseDownEvent(event: RenderingMouseDownEvent): boolean {
    return this.handleMouseEvent(event, 'onMouseDown')
  }

  protected onMouseDown(event: RenderingMouseDownEvent) {
    // Override in subclasses
  }

  private handleMouseUpEvent(event: RenderingMouseUpEvent): boolean {
    return this.handleMouseEvent(event, 'onMouseUp')
  }

  protected onMouseUp(event: RenderingMouseUpEvent): void {
    // Override in subclasses
  }

  private handleMouseMoveEvent(event: RenderingMouseMoveEvent): boolean {
    return this.handleMouseEvent(event, 'onMouseMove')
  }

  protected onMouseEnter(event: RenderingMouseEnterEvent): void {
    // Override in subclasses
  }

  protected onMouseMove(event: RenderingMouseMoveEvent): void {
    // Override in subclasses
  }

  protected onMouseLeave(event: RenderingMouseLeaveEvent): void {
    // Override in subclasses
  }

  private handleMouseWheelEvent(event: RenderingMouseWheelEvent): boolean {
    return this.handleMouseEvent(event, 'onMouseWheel')
  }

  protected onMouseWheel(event: RenderingMouseWheelEvent): void {
    // Override in subclasses
  }

  protected draw(ctx: CanvasRenderingContext2D): void {
    // Override in subclasses to render specific content
  }
}
