/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import type { Configuration } from 'webpack'

import { rules } from './webpack.rules'
import { plugins } from './webpack.plugins'
import { alias } from './webpack.alias'

rules.push(
  {
    test: /\.css$/,
    use: [{ loader: 'style-loader' }, { loader: 'css-loader', options: { importLoaders: 1, modules: true } }],
    include: /\.module\.css$/
  },
  {
    test: /\.css$/,
    use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
    exclude: /\.module\.css$/
  }
)
rules.push({
  test: /\.(png|jpe?g|gif|svg)$/,
  type: 'asset/resource'
})

export const rendererConfig: Configuration = {
  module: {
    rules
  },
  plugins,
  resolve: {
    alias,
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css']
  }
}
