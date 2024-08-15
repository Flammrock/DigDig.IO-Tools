/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'
import { CallbackChannel, HandleChannel } from './bridge/channel'
import { DialogBridgeAPI, FsBridgeAPI, MenuBridgeAPI, WebSocketBridgeAPI } from './bridge/api'

const ipcRendererInvoke = (channel: HandleChannel, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
const ipcRendererOn = (channel: CallbackChannel, callback: (...args: any[]) => any) =>
  ipcRenderer.on(channel, (event, ...args) => callback(...args))

declare global {
  const wss: WebSocketBridgeAPI
  const Menu: MenuBridgeAPI
  const Dialog: DialogBridgeAPI
  const fs: FsBridgeAPI
}

const webSocketProvider: WebSocketBridgeAPI = {
  connection: (callback) => ipcRendererOn('websocket.connection', callback),
  disconnection: (callback) => ipcRendererOn('websocket.disconnection', callback),
  message: (callback) => ipcRendererOn('websocket.message', callback),
  close: (id) => ipcRendererInvoke('websocket.close', id)
}

const menuProvider: MenuBridgeAPI = {
  on: (type, callback) => {
    switch (type) {
      case 'click':
        ipcRendererOn('menu.click', callback)
        return
    }
    throw new Error(`Menu event '${type}' not supported.`)
  }
}

const fsProvider: FsBridgeAPI = {
  writeFile: (filePath, arrayBuffer) => ipcRendererInvoke('io.write-file', filePath, arrayBuffer),
  readFile: (filePath) => ipcRendererInvoke('io.read-file', filePath)
}

const dialogProvider: DialogBridgeAPI = {
  showSaveDialog: (options) => ipcRendererInvoke('dialog.show-save', options),
  showOpenDialog: (options) => ipcRendererInvoke('dialog.show-open', options)
}

contextBridge.exposeInMainWorld('wss', webSocketProvider)
contextBridge.exposeInMainWorld('Menu', menuProvider)
contextBridge.exposeInMainWorld('Dialog', dialogProvider)
contextBridge.exposeInMainWorld('fs', fsProvider)
