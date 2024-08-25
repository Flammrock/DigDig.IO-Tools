/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import fs from 'fs'
import { ipcMainHandle } from './utils'

export function registerMainHandlers() {
  ipcMainHandle('io.write-file', (event, filePath, arrayBuffer) => {
    return fs.promises.writeFile(filePath, Buffer.from(arrayBuffer))
  })
  ipcMainHandle('io.read-file', async (event, filePath) => {
    const b = await fs.promises.readFile(filePath)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })
}
