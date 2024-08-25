/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { BrowserWindow } from 'electron'
import { WebSocket, WebSocketServer } from 'ws'
import { StripPrefix, UniqueIdProvider, WebSocketCallbackChannel, WebSocketCallbackChannelMethods } from 'shared'
import { ipcMainHandle } from '../ipc/utils'

const sendWebSocketEvent = <T extends WebSocketCallbackChannel>(
  channel: T,
  window: BrowserWindow,
  ...args: Parameters<WebSocketCallbackChannelMethods[StripPrefix<T, 'websocket.'>]>
): void => {
  window?.webContents.send(channel, ...args)
}

export interface WebSocketServerCreateOptions {
  window: BrowserWindow
  port: number
}

export const createWebSocketServer = (options: WebSocketServerCreateOptions): void => {
  const window = options.window

  const clients: Record<string, WebSocket> = {}

  ipcMainHandle('websocket.close', (event, id) => {
    if (typeof clients[id] === 'undefined') return
    try {
      clients[id].close()
    } catch (e) {
      // swallow
    }
    delete clients[id]
  })
  ipcMainHandle('websocket.send', async (event, id, message) => {
    if (typeof clients[id] === 'undefined') return
    try {
      clients[id].send(message)
    } catch (e) {
      // swallow
    }
  })
  ipcMainHandle('websocket.getAll', async (event) => {
    return Object.keys(clients)
  })

  // start the websocket server that wait
  // connection from userscript map scanner
  const wss = new WebSocketServer({ port: options.port })
  const uniqueIdProvider = new UniqueIdProvider()
  wss.on('connection', (ws) => {
    // create an unique id for that socket in order to identify it later
    const id = uniqueIdProvider.next()

    clients[id] = ws

    // if window is no more there, then abort the operation
    if (!window || window.isDestroyed()) {
      try {
        ws.close()
      } catch (e) {
        // swallowed
      }
      return
    }

    // notify the renderer process of sockets's events
    sendWebSocketEvent('websocket.connection', window, id)
    ws.on('close', () => {
      delete clients[id]
      if (!window || window.isDestroyed()) return
      sendWebSocketEvent('websocket.disconnection', window, id)
    })
    ws.on('message', (buffer) => {
      if (!window || window.isDestroyed()) {
        try {
          ws.close()
        } catch (e) {
          // swallowed
        }
        return
      }
      if (buffer instanceof Buffer) {
        sendWebSocketEvent(
          'websocket.message',
          window,
          id,
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        )
      } else if (buffer instanceof ArrayBuffer) {
        sendWebSocketEvent('websocket.message', window, id, buffer)
      }
    })
  })

  /*return {
    wss,
    close: () => {
      return new Promise((resolve, reject) => {
        try {
          wss.close((err) => {
            if (err) return reject(err)
            resolve()
          })
        } catch (e) {
          reject(e)
        }
      })
    }
  }*/
}
