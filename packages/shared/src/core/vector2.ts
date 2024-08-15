/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 *
 */
const DefaultTolerance = 0.001

export interface Vector2Like {
  x: number
  y: number
}

/**
 *
 */
export class Vector2 implements Vector2Like {
  public readonly x: number
  public readonly y: number

  public constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }

  public equals(other: Vector2, tolerance = DefaultTolerance): boolean {
    return Vector2.equals(this, other, tolerance)
  }

  public static equals(v1: Vector2Like, v2: Vector2Like, tolerance = DefaultTolerance) {
    if (v1 === v2) return true
    if (!v1 || !v2) return false
    if (v1?.x === v2?.x && v1?.y === v2?.y) return true
    if (Math.abs(v1?.x - v2?.x) < tolerance && Math.abs(v1?.y - v2?.y) < tolerance) return true
    return false
  }
}

export class GridVector2 extends Vector2 {
  public constructor(x = 0, y = 0) {
    super(x | 0, y | 0)
  }

  public toString(): string {
    return `${this.x},${this.y}`
  }

  public static from(vector: Vector2Like) {
    return new GridVector2(vector.x, vector.y)
  }
}
