/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { WebpackPlugin } from '@electron-forge/plugin-webpack'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import path from 'path'

import { mainConfig } from './webpack.main.config'
import { rendererConfig } from './webpack.renderer.config'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    overwrite: true,
    // https://github.com/electron/forge/issues/709
    executableName: process.platform === 'linux' ? 'electron-app' : 'DigDig.IO Tools',
    name: 'DigDig.IO Tools',
    icon: path.resolve(__dirname, 'src', 'icons', 'icon')
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel(
      {
        setupIcon: path.resolve(__dirname, 'src', 'icons', 'icon.ico')
      },
      ['win32']
    ),
    new MakerZIP({}, ['darwin']),
    new MakerDeb(
      {
        options: {
          icon: path.resolve(__dirname, 'src', 'icons', 'icon.png')
        }
      },
      ['linux']
    ),
    new MakerRpm(
      {
        options: {
          icon: path.resolve(__dirname, 'src', 'icons', 'icon.png')
        }
      },
      ['linux']
    )
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload.ts'
            }
          },
          {
            html: './src/splash/index.html',
            js: './src/splash/splash.ts',
            name: 'splash_window'
          }
        ]
      }
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
}

export default config
