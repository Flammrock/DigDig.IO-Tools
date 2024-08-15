/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { BrowserWindow } from 'electron'
import { WebSocketServer } from 'ws'
import { UniqueIdProvider } from 'shared'
import { WebSocketCallbackChannel } from '../../bridge/channel'
import { WebSocketCallbackChannelMethods } from '../../bridge/api'

export interface WebSocketServerCreateOptions {
  port: number
  window: BrowserWindow
}

const sendWebSocketEvent = <T extends WebSocketCallbackChannel>(
  channel: T,
  window: BrowserWindow,
  ...args: Parameters<WebSocketCallbackChannelMethods[StripPrefix<T, 'websocket.'>]>
): void => {
  window?.webContents.send(channel, ...args)
}

export const createWebSocketServer = (options: WebSocketServerCreateOptions): void => {
  const window = options.window

  // start the websocket server that wait
  // connection from userscript map scanner
  const wss = new WebSocketServer({ port: options.port })
  const uniqueIdProvider = new UniqueIdProvider()
  wss.on('connection', (ws) => {
    // create an unique id for that socket in order to identify it later
    const id = uniqueIdProvider.next()

    // if window is no more there, then abort the operation
    if (!window || window.isDestroyed()) {
      try {
        ws.close()
      } catch (e) {}
      return
    }

    // notify the renderer process of sockets's events
    sendWebSocketEvent('websocket.connection', window, id)
    ws.on('close', () => {
      if (!window || window.isDestroyed()) return
      sendWebSocketEvent('websocket.disconnection', window, id)
    })
    ws.on('message', (buffer) => {
      if (!window || window.isDestroyed()) {
        try {
          ws.close()
        } catch (e) {}
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
}
