/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Vector2Like } from './vector2'

/**
 *
 */
export interface TransformLike {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const TransformIdentity: TransformLike = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export class Transform implements TransformLike {
  public a: number
  public b: number
  public c: number
  public d: number
  public e: number
  public f: number

  public static get Identity(): Transform {
    return new Transform()
  }

  constructor()
  constructor(t: TransformLike)
  constructor(a: number, b: number, c: number, d: number, e: number, f: number)
  public constructor(a?: number | TransformLike, b?: number, c?: number, d?: number, e?: number, f?: number) {
    if (typeof a === 'number') {
      this.a = a ?? TransformIdentity.a
      this.b = b ?? TransformIdentity.b
      this.c = c ?? TransformIdentity.c
      this.d = d ?? TransformIdentity.d
      this.e = e ?? TransformIdentity.e
      this.f = f ?? TransformIdentity.f
    } else if (typeof a === 'object' && a !== null) {
      this.a = a.a ?? TransformIdentity.a
      this.b = a.b ?? TransformIdentity.b
      this.c = a.c ?? TransformIdentity.c
      this.d = a.d ?? TransformIdentity.d
      this.e = a.e ?? TransformIdentity.e
      this.f = a.f ?? TransformIdentity.f
    } else {
      this.a = TransformIdentity.a
      this.b = TransformIdentity.b
      this.c = TransformIdentity.c
      this.d = TransformIdentity.d
      this.e = TransformIdentity.e
      this.f = TransformIdentity.f
    }
  }

  set(t: TransformLike): void
  set(a: number, b: number, c: number, d: number, e: number, f: number): void
  public set(a: number | TransformLike, b?: number, c?: number, d?: number, e?: number, f?: number) {
    let t = Transform.Identity
    if (typeof a === 'number') {
      t = new Transform(a ?? t.a, b ?? t.b, c ?? t.c, d ?? t.d, e ?? t.e, f ?? t.f)
    } else if (typeof a === 'object' && a !== null) {
      t = new Transform(a)
    }
    this.a = t.a
    this.b = t.b
    this.c = t.c
    this.d = t.d
    this.e = t.e
    this.f = t.f
  }

  public translate(tx: number, ty: number): void {
    this.e += this.a * tx + this.c * ty
    this.f += this.b * tx + this.d * ty
  }

  public scale(sx: number, sy: number): void {
    this.a *= sx
    this.b *= sx
    this.c *= sy
    this.d *= sy
  }

  public rotate(angle: number): void {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    const a = this.a * cos + this.c * sin
    const b = this.b * cos + this.d * sin
    const c = this.c * cos - this.a * sin
    const d = this.d * cos - this.b * sin

    this.a = a
    this.b = b
    this.c = c
    this.d = d
  }

  public invert(): Transform {
    const det = this.a * this.d - this.b * this.c
    const a = this.d / det
    const b = -this.b / det
    const c = -this.c / det
    const d = this.a / det
    const e = (this.c * this.f - this.d * this.e) / det
    const f = (this.b * this.e - this.a * this.f) / det
    return new Transform(a, b, c, d, e, f)
  }

  screenToWorld(v: Vector2Like): Vector2Like
  screenToWorld(x: number, y: number): Vector2Like
  public screenToWorld(a: Vector2Like | number, b?: number): Vector2Like {
    const t = this.invert()
    let x = 0
    let y = 0
    if (typeof a === 'number') {
      x = a
      y = b ?? 0
    } else {
      x = a.x
      y = a.y
    }
    return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f }
  }

  worldToScreen(v: Vector2Like): Vector2Like
  worldToScreen(x: number, y: number): Vector2Like
  public worldToScreen(a: Vector2Like | number, b?: number): Vector2Like {
    let x = 0
    let y = 0
    if (typeof a === 'number') {
      x = a
      y = b ?? 0
    } else {
      x = a.x
      y = a.y
    }
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f }
  }

  public raw(): TransformLike {
    return {
      a: this.a,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.e,
      f: this.f
    }
  }
}
