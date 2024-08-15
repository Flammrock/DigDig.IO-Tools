/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import { WebSocketCallbackChannel, WebSocketHandleChannel } from './channel'

/**
 *  WebSocket API Main to Renderer
 */
export interface WebSocketCallbackChannelMethods {
  connection: (id: string) => void
  disconnection: (id: string) => void
  message: (id: string, message: ArrayBuffer) => void
}

/**
 *  WebSocket API Renderer to Main
 */
export interface WebSocketHandleChannelMethods {
  close: (id: string) => void
}

/**
 * WebSocket API exposed to the Renderer
 */
export type WebSocketBridgeAPI = {
  [K in WebSocketHandleChannel as StripPrefix<K, 'websocket.'>]: WebSocketHandleChannelMethods[StripPrefix<
    K,
    'websocket.'
  >]
} & {
  [K in WebSocketCallbackChannel as StripPrefix<K, 'websocket.'>]: (
    callback: (...args: Parameters<WebSocketCallbackChannelMethods[StripPrefix<K, 'websocket.'>]>) => void
  ) => void
}

export interface MenuEvent {
  name: string
}

export interface MenuEventCallbacks {
  click: (event: MenuEvent) => void
}

export interface MenuBridgeAPI {
  on<T extends keyof MenuEventCallbacks>(eventType: T, callback: MenuEventCallbacks[T]): void
}

export interface DialogBridgeAPI {
  showSaveDialog: (options?: SaveDialogOptions) => Promise<SaveDialogReturnValue>
  showOpenDialog: (options?: OpenDialogOptions) => Promise<OpenDialogReturnValue>
}

export interface FsBridgeAPI {
  writeFile: (filePath: string, arrayBuffer: ArrayBuffer) => Promise<void>
  readFile: (filePath: string) => Promise<ArrayBuffer>
}
