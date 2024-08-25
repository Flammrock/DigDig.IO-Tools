/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import {
  Chunk,
  Buffer,
  EventCallbacks,
  EventEmitter,
  Vector2Like,
  Writeable,
  ChannelClient,
  ChannelClientEventType
} from 'shared'
import { ProtocolHandler, ProtocolMessageType } from 'map-scanner-shared'

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

  private handler: ProtocolHandler
  private socket: ChannelClient

  public constructor(socket: ChannelClient) {
    super()

    this.id = socket.id
    this.position = { x: 0, y: 0 }
    this.handler = new ProtocolHandler()
    this.socket = socket

    this.socket.on(ChannelClientEventType.Close, () => {
      this.dispatcher.emit(ClientEvent.Disconnect)
    })
    this.socket.on(ChannelClientEventType.Message, (message) => {
      this.feed(message)
    })

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
    this.handler.handle(new Buffer(data))
  }
}

export default Client
