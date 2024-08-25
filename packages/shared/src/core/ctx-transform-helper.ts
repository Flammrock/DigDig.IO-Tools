/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Transform } from './transform'
import { Vector2Like } from './vector2'

/**
 *
 */
export const CanvasRenderingContext2DTransformHelper = {
  screenToWorld(ctx: CanvasRenderingContext2D, x: number, y: number): Vector2Like {
    return new Transform(ctx.getTransform()).screenToWorld(x, y)
  },
  worldToScreen(ctx: CanvasRenderingContext2D, x: number, y: number): Vector2Like {
    return new Transform(ctx.getTransform()).worldToScreen(x, y)
  }
}

export default CanvasRenderingContext2DTransformHelper
