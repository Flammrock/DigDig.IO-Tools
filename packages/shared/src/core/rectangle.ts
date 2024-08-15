/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 *
 */
export interface RectangleLike {
  x: number
  y: number
  width: number
  height: number
}

export class Rectangle implements RectangleLike {
  public readonly x: number
  public readonly y: number
  public readonly width: number
  public readonly height: number

  constructor()
  constructor(x: number, y: number, width: number, height: number)
  constructor(rectangle: RectangleLike)
  public constructor(x?: number | RectangleLike, y?: number, width?: number, height?: number) {
    if (typeof x === 'number') {
      this.x = x ?? 0
      this.y = y ?? 0
      this.width = width ?? 0
      this.height = height ?? 0
    } else if (typeof x === 'object' && x !== null) {
      this.x = x.x ?? 0
      this.y = x.y ?? 0
      this.width = x.width ?? 0
      this.height = x.height ?? 0
    } else {
      this.x = 0
      this.y = 0
      this.width = 0
      this.height = 0
    }
  }

  public intersect(other: RectangleLike): boolean {
    return Rectangle.intersect(this, other)
  }

  public static intersect(a: RectangleLike, b: RectangleLike): boolean {
    if (!a || !b) return false
    return b.x <= a.x + a.width && b.x + b.width >= a.x && b.y <= a.y + a.height && b.y + b.height >= a.y
  }
}

export default Rectangle
