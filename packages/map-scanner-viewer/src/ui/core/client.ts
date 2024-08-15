/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Chunk, Buffer, EventCallbacks, EventEmitter, Vector2Like, Writeable } from 'shared'
import { MapScannerBridge, ProtocolHandler, ProtocolMessageType } from 'map-scanner-shared'
import { WebSocket, WebSocketEventType } from './websocket-provider'

/*
const AsBuffer = (data: RawData): CustomBuffer => {
  if (data instanceof ArrayBuffer) return new CustomBuffer(data);
  if (data instanceof Buffer)
    return new CustomBuffer(new Uint8Array(data).buffer);
  throw new Error("Unable to convert to buffer.");
};*/

const handshakeBuffer = new Buffer(MapScannerBridge.handshake)

export enum ClientEvent {
  Disconnect,
  ChunkRecieved,
  PositionUpdated
}

export interface ClientEventCallbacks extends EventCallbacks {
  [ClientEvent.Disconnect]: () => void
  [ClientEvent.ChunkRecieved]: (chunk: Chunk) => void
  [ClientEvent.PositionUpdated]: (position: Vector2Like) => void
}

/**
 *
 */
export class Client extends EventEmitter<ClientEventCallbacks> {
  public readonly id: string
  public readonly position: Vector2Like

  private hasHandshaked: boolean
  private handler: ProtocolHandler
  private socket: WebSocket

  public constructor(socket: WebSocket) {
    super()

    this.id = socket.id
    this.position = { x: 0, y: 0 }
    this.handler = new ProtocolHandler()
    this.socket = socket

    this.socket.on(WebSocketEventType.Disconnection, () => {
      this.dispatcher.emit(ClientEvent.Disconnect)
    })
    this.socket.on(WebSocketEventType.Message, (message) => {
      this.feed(message)
    })

    this.hasHandshaked = false

    this.handler.on(ProtocolMessageType.Position, (position) => {
      ;(<Writeable<Client>>this).position = position
      this.dispatcher.emit(ClientEvent.PositionUpdated, position)
    })
    this.handler.on(ProtocolMessageType.Chunk, (chunk) => {
      this.dispatcher.emit(ClientEvent.ChunkRecieved, chunk)
    })
  }

  public close() {
    this.socket.close()
  }

  private feed(data: ArrayBuffer) {
    const message = new Buffer(data)
    if (!this.hasHandshaked) {
      this.hasHandshaked = true
      if (handshakeBuffer.equals(message)) return
      throw new Error('Bad handshake!')
    }
    this.handler.handle(message)
  }
}

export default Client
