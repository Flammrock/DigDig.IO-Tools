/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import 'canvas'

/**
 *
 */
declare module 'canvas' {
  interface CanvasRenderingContext2D {
    // https://github.com/Automattic/node-canvas/issues/2196
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  }
}
