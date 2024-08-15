/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { MapScannerBridge, Protocol } from 'map-scanner-shared'
import { Nullable, Buffer, Chunk, Vector2Like } from 'shared'

const send = (socket: Nullable<WebSocket>, buffer: ArrayBuffer | Buffer): void => {
  if (!socket) return
  try {
    if (socket.readyState === WebSocket.OPEN) {
      if (buffer instanceof Buffer) {
        socket.send(buffer.getArrayBuffer())
      } else {
        socket.send(buffer)
      }
    }
  } catch (e) {
    // swallow exception
  }
}

/**
 *
 */
export class Client {
  private socket: Nullable<WebSocket> = null

  public connect() {
    this.socket = new WebSocket(`ws://127.0.0.1:${MapScannerBridge.port}`)
    this.socket.binaryType = 'arraybuffer'
    this.socket.onclose = () => {
      setTimeout(() => {
        this.connect()
      }, 5000)
    }
    this.socket.onopen = () => {
      this.socket?.send(MapScannerBridge.handshake)
    }
  }

  public updatePosition(position: Vector2Like): void {
    send(this.socket, Protocol.encode.position(position))
  }

  public feedChunk(chunk: Chunk): void {
    send(this.socket, Protocol.encode.chunk(chunk))
  }
}
