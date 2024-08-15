/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { EventCallbacks, EventEmitter } from 'shared'

export enum WebSocketProviderEventType {
  Connection
}

export enum WebSocketEventType {
  Disconnection,
  Message
}

export interface WebSocketEventCallbacks extends EventCallbacks {
  [WebSocketEventType.Disconnection]: () => void
  [WebSocketEventType.Message]: (buffer: ArrayBuffer) => void
}

export class WebSocket extends EventEmitter<WebSocketEventCallbacks> {
  public readonly id: string

  public constructor(id: string) {
    super()
    this.id = id
  }

  public close() {
    // TODO
  }
}

export interface WebSocketProviderEventCallbacks extends EventCallbacks {
  [WebSocketProviderEventType.Connection]: (ws: WebSocket) => void
}

export class WebSocketProviderObject extends EventEmitter<WebSocketProviderEventCallbacks> {
  private static instance: WebSocketProviderObject
  private sockets: Record<string, WebSocket>

  private constructor() {
    super()
    this.sockets = {}

    wss.connection((id) => {
      this.sockets[id] = new WebSocket(id)
      this.dispatcher.emit(WebSocketProviderEventType.Connection, this.sockets[id])
    })
    wss.disconnection((id) => {
      const ws = this.sockets[id]
      if (typeof ws === 'undefined') return
      ;(ws as any).dispatcher.emit(WebSocketEventType.Disconnection)
      delete this.sockets[id]
    })
    wss.message((id, buffer) => {
      const ws = this.sockets[id]
      if (typeof ws === 'undefined') return
      ;(ws as any).dispatcher.emit(WebSocketEventType.Message, buffer)
    })
  }

  public static getInstance(): WebSocketProviderObject {
    if (!WebSocketProviderObject.instance) WebSocketProviderObject.instance = new WebSocketProviderObject()
    return WebSocketProviderObject.instance
  }
}

export const WebSocketProvider = WebSocketProviderObject.getInstance()

export default WebSocketProvider
