/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Protocol } from 'map-scanner-shared'
import { Chunk, Vector2Like, Connection, Channel } from 'shared'

/**
 *
 */
export class Client {
  public channel: Channel

  public constructor() {
    this.channel = Connection.createChannel('viewer').connect()
  }

  public updatePosition(position: Vector2Like): void {
    this.channel.isOpened() && this.channel.send(Protocol.encode.position(position))
  }

  public feedChunk(chunk: Chunk): void {
    this.channel.isOpened() && this.channel.send(Protocol.encode.chunk(chunk))
  }
}
