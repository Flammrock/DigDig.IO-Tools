/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { HandleChannel } from 'shared'

export const ipcMainHandle = (
  channel: HandleChannel,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<void> | any
) => ipcMain.handle(channel, listener)
