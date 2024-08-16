/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import type { ForgeConfig } from '@electron-forge/shared-types'
///////// import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { WebpackPlugin } from '@electron-forge/plugin-webpack'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import fs from 'fs'
import path from 'path'

import { mainConfig } from './webpack.main.config'
import { rendererConfig } from './webpack.renderer.config'

const iconFormat: Record<string, string> = {
  win32: '.ico',
  darwin: '.icns',
  linux: '.png'
}
const iconFileParts =
  typeof iconFormat[process.platform] !== 'undefined' ? [process.platform, 'icon'] : ['png', 'icon-256x256']
const iconPath = path.resolve(__dirname, 'src', 'icons', ...iconFileParts)
const ext = typeof iconFormat[process.platform] !== 'undefined' ? iconFormat[process.platform] : '.png'
if (!fs.existsSync(iconPath + ext)) throw new Error(`Unable to find the icon file '${iconPath + ext}'.`)

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    overwrite: true,
    executableName: 'Viewer',
    name: 'Viewer',
    icon: iconPath
  },
  rebuildConfig: {},
  makers: [/*new MakerSquirrel({}), */ new MakerZIP({}, ['win32', 'darwin']), new MakerDeb({}), new MakerRpm({})],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/ui/index.html',
            js: './src/renderer.ts',
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
