/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 *
 */
export class Color {
  public readonly red: number
  public readonly green: number
  public readonly blue: number
  public readonly alpha?: number

  public constructor(r: number, g: number, b: number, a?: number) {
    this.red = r
    this.green = g
    this.blue = b
    this.alpha = a
  }

  public isColorSimilarTo(other: Color, tolerance = 40): boolean {
    return Math.hypot(this.red - other.red, this.green - other.green, this.blue - other.blue) < tolerance
  }
}

export function rgb(r: number, g: number, b: number): Color {
  return new Color(r, g, b)
}

export function rgba(r: number, g: number, b: number, a: number): Color {
  return new Color(r, g, b, a)
}
