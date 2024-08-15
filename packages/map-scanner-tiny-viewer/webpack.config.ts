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
import CopyPlugin from 'copy-webpack-plugin'

const isProduction = process.env.NODE_ENV == 'production'

const distFolder = path.resolve(__dirname, 'dist')

const config: Configuration = {
  entry: './src/app.ts',
  mode: isProduction ? 'production' : 'development',
  devtool: 'source-map',
  target: ['node', 'es5'],
  output: {
    path: distFolder,
    filename: 'viewer.js',
    library: 'Viewer',
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
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: path.resolve(__dirname, 'assets'), to: path.resolve(distFolder, 'assets') }]
    })
  ]
}

export default config
