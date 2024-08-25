/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'
import {
  HandleChannel,
  CallbackChannel,
  WebSocketBridgeAPI,
  ToolBridgeAPI,
  MenuBridgeAPI,
  FsBridgeAPI,
  DialogBridgeAPI
} from 'shared'

const ipcRendererInvoke = (channel: HandleChannel, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
const ipcRendererOn = (channel: CallbackChannel, callback: (...args: any[]) => any) =>
  ipcRenderer.on(channel, (event, ...args) => callback(...args))
const ipcRendererOff = (channel: CallbackChannel, callback: (...args: any[]) => any) =>
  ipcRenderer.off(channel, (event, ...args) => callback(...args))

const webSocketProvider: WebSocketBridgeAPI = {
  connection: (callback) => ipcRendererOn('websocket.connection', callback),
  removeConnection: (callback) => ipcRendererOff('websocket.connection', callback),
  disconnection: (callback) => ipcRendererOn('websocket.disconnection', callback),
  removeDisconnection: (callback) => ipcRendererOff('websocket.disconnection', callback),
  message: (callback) => ipcRendererOn('websocket.message', callback),
  removeMessage: (callback) => ipcRendererOff('websocket.message', callback),
  close: (id) => ipcRendererInvoke('websocket.close', id),
  send: (id, message) => ipcRendererInvoke('websocket.send', id, message),
  getAll: () => ipcRendererInvoke('websocket.getAll')
}

const toolProvider: ToolBridgeAPI = {
  mount: (name) => ipcRendererInvoke('tool.mount', name),
  unmount: (name) => ipcRendererInvoke('tool.unmount', name),
  is: (name) => ipcRendererInvoke('tool.is', name),
  update: (callback) => ipcRendererOn('tool.update', callback),
  removeUpdate: (callback) => ipcRendererOff('tool.update', callback)
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
contextBridge.exposeInMainWorld('tools', toolProvider)
