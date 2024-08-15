/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import path from 'path'

const assetsFolder = path.resolve(__dirname, 'assets')
const fontsFolder = path.resolve(assetsFolder, 'fonts')

export interface FontResource {
  filePath: string
  name: string
}

export const Fonts: ReadonlyArray<FontResource> = [
  { filePath: path.resolve(fontsFolder, 'Ubuntu.ttf'), name: 'Ubuntu' }
]

export default Fonts
