/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import { ToolCallbackChannel, ToolHandleChannel, WebSocketCallbackChannel, WebSocketHandleChannel } from './channel'
import { StripPrefix } from '../../utils/helpers'

/**
 *  WebSocket API Main to Renderer
 */
export interface WebSocketCallbackChannelMethods {
  connection: (id: string) => Promise<void>
  disconnection: (id: string) => Promise<void>
  message: (id: string, message: ArrayBuffer) => Promise<void>
}

/**
 *  WebSocket API Renderer to Main
 */
export interface WebSocketHandleChannelMethods {
  close: (id: string) => Promise<void>
  send: (id: string, message: ArrayBuffer) => Promise<void>
  getAll: () => Promise<Array<string>>
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
} & {
  [K in WebSocketCallbackChannel as `remove${Capitalize<StripPrefix<K, 'websocket.'>>}`]: (
    callback: (...args: Parameters<WebSocketCallbackChannelMethods[StripPrefix<K, 'websocket.'>]>) => void
  ) => void
}

/**
 *  Tool API Main to Renderer
 */
export interface ToolCallbackChannelMethods {
  update: (name: string, isMounted: boolean) => Promise<void>
}

/**
 *  Tool API Renderer to Main
 */
export interface ToolHandleChannelMethods {
  mount: (name: string) => Promise<void>
  unmount: (name: string) => Promise<void>
  is: (name: string) => Promise<boolean>
}

/**
 * Tool API exposed to the Renderer
 */
export type ToolBridgeAPI = {
  [K in ToolHandleChannel as StripPrefix<K, 'tool.'>]: ToolHandleChannelMethods[StripPrefix<K, 'tool.'>]
} & {
  [K in ToolCallbackChannel as StripPrefix<K, 'tool.'>]: (
    callback: (...args: Parameters<ToolCallbackChannelMethods[StripPrefix<K, 'tool.'>]>) => void
  ) => void
} & {
  [K in ToolCallbackChannel as `remove${Capitalize<StripPrefix<K, 'tool.'>>}`]: (
    callback: (...args: Parameters<ToolCallbackChannelMethods[StripPrefix<K, 'tool.'>]>) => void
  ) => void
}

export interface MenuEvent {
  name: string
}

export interface MenuEventCallbacks {
  click: (event: MenuEvent) => Promise<void>
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
