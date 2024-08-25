/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import path from 'path'

export const alias = {
  resources: path.resolve(__dirname, 'src', 'resources'),
  common: path.resolve(__dirname, 'src', 'common'),

  // https://github.com/pixijs/pixi-react/issues/452
  // https://github.com/pixijs/pixijs/issues/8467
  // https://github.com/bigtimebuddy/webpack-esm-cjs-mix-example
  // TODO: document this in README.MD
  'pixi.js': path.resolve(__dirname, '../../node_modules/pixi.js/lib/index.mjs')
}
