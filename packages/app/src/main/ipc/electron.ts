/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { BrowserWindow, dialog, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { ipcMainHandle } from './utils'

export function registerElectronHandlers() {
  ipcMainHandle('dialog.show-open', async (event, options: OpenDialogOptions) => {
    const { filePaths, canceled } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), options)
    return { filePaths, canceled }
  })

  ipcMainHandle('dialog.show-save', async (event, options: SaveDialogOptions) => {
    const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), options)
    return { filePath, canceled }
  })
}
