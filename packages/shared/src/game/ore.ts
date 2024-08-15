/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Color } from '../core/color'
import { KnownOres } from './ore-palette'

export class Ore {
  public readonly name: string
  public readonly color: Color
  public readonly index: number

  constructor(name: string, color: Color, index = -1) {
    this.name = name
    this.color = color
    this.index = index
  }

  static fromColor(color: Color, tolerance?: number) {
    for (let i = 0; i < KnownOres.length; i++) {
      const ore = KnownOres.get(i)
      if (color.isColorSimilarTo(color, tolerance)) {
        return ore
      }
    }
    return null
  }
}
