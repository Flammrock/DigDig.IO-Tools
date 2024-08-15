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
  entry: './src/plugin.ts',
  mode: isProduction ? 'production' : 'development',
  devtool: 'inline-source-map',
  target: ['node', 'es6'],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'plugin.js',
    library: 'UserScriptPlugin',
    libraryTarget: 'umd',
    globalObject: 'this',
    clean: true
  },
  externals: [
    nodeExternals(),
    nodeExternals({
      modulesDir: path.resolve(__dirname, '../../node_modules')
    })
  ],
  module: {
    rules: [
      {
        test: /\.(ts)$/i,
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
    extensions: ['.ts']
  },
  optimization: {
    minimize: isProduction,
    minimizer: [new TerserPlugin()]
  }
}

export default config
