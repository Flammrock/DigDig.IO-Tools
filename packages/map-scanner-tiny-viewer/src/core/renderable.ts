/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import RenderContext from './render-context'

/**
 *
 */
export interface Renderable {
  render(context: RenderContext): void
}

export default Renderable
