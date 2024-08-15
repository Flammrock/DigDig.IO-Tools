/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import Mouse from './mouse'
import Selection from './selection'
import Keyboard from './keyboard'

/**
 *
 */
export interface RenderContext {
  ctx: CanvasRenderingContext2D
  mouse: Mouse
  keyboard: Keyboard
  selection: Selection
}

export default RenderContext
