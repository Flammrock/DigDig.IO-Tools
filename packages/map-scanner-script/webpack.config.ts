/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Configuration } from 'webpack'
import { Configuration as DevServerConfiguration } from 'webpack-dev-server'
import path from 'path'
import UserScriptPlugin from 'userscript-webpack-plugin'

const isProduction = process.env.NODE_ENV == 'production'

const distPath = path.resolve(__dirname, 'dist')

const devServer: DevServerConfiguration = {
  static: {
    directory: distPath
  },
  port: 9000
}

const config: Configuration = {
  entry: './src/script.ts',
  mode: isProduction ? 'production' : 'development',
  devtool: 'source-map',
  target: ['web', 'es5'],
  output: {
    path: distPath,
    filename: isProduction ? 'script.min.user.js' : 'script.user.js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        loader: 'ts-loader',
        options: {
          configFile: 'tsconfig.json'
        },
        exclude: ['/node_modules/']
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx']
  },
  devServer,
  plugins: [
    new UserScriptPlugin({
      configFile: 'userscript.config.json'
    })
  ]
}

export default config
