/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Color, rgb } from '../core/color'
import { Nullable } from '../utils/helpers'
import { Ore } from './ore'

export class OrePalette {
  private internal: Array<Ore>

  public constructor(ores: Array<Ore>) {
    this.internal = ores.slice()
  }

  public get(index: number): Nullable<Ore> {
    return this.internal[index] ?? null
  }

  public get length() {
    return this.internal.length
  }

  public fromColor(color: Color, tolerance?: number): Nullable<number> {
    for (let index = 0; index < this.internal.length; index++) {
      const ore = this.internal[index]
      if (color.isColorSimilarTo(ore.color, tolerance)) {
        return index
      }
    }
    return null
  }
}

export const KnownOres = new OrePalette([
  new Ore('Amethyst', rgb(177, 50, 179) /*rgb(255, 87, 255)*/),
  new Ore('Bedrock', rgb(0, 0, 0)),
  new Ore('Diamond', rgb(48, 163, 155)),
  new Ore('Gold', rgb(163, 156, 21) /*rgb(166, 156, 20)*/),
  new Ore('Lava', rgb(169, 25, 6)),
  new Ore('Quartz', rgb(220, 220, 220)),
  new Ore('Uranium', rgb(51, 167, 49) /*rgb(54, 163, 52)*/)
])
