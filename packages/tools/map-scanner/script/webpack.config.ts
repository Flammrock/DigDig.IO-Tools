/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Configuration } from 'webpack'
import path from 'path'
import TerserPlugin from 'terser-webpack-plugin'
import nodeExternals from 'webpack-node-externals'

const isProduction = process.env.NODE_ENV == 'production'

const config: Configuration = {
  entry: './src/script.ts',
  mode: isProduction ? 'production' : 'development',
  devtool: 'source-map',
  target: ['web', 'es5'],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'script.js',
    library: 'Script',
    libraryTarget: 'umd',
    globalObject: 'this',
    clean: true
  },
  externals: [
    nodeExternals(),
    nodeExternals({
      modulesDir: path.resolve(__dirname, '../../../../node_modules')
    })
  ],
  module: {
    rules: [
      {
        test: /\.(tsx?)$/i,
        loader: 'ts-loader',
        options: {
          configFile: 'tsconfig.json'
        },
        exclude: ['/node_modules/']
      }
    ]
  },
  resolve: {
    modules: [path.resolve(__dirname, '../../node_modules'), 'node_modules'],
    extensions: ['.ts', '.tsx']
  },
  optimization: {
    minimize: isProduction,
    minimizer: [new TerserPlugin()]
  }
}

export default config
