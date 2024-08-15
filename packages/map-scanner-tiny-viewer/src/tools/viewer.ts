/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Chunk, ChunkSize, EventCallbacks, EventEmitter, Nullable, Vector2Like } from 'shared'
import Surface, { SurfaceEvent } from '../core/surface'
import PanZoom from '../core/pan-zoom'
import ClientManager from '../core/client-manager'
import Client, { ClientEvent } from '../core/client'
import Tail from '../graphics/tail'
import ChunkPlaceholder from '../graphics/chunk-placeholder'
import Selection from '../core/selection'
import ChunkMap from '../graphics/chunk-map'
import { MouseButton } from '../core/mouse'
import { KeyboardEvent, Scancodes } from '../core/keyboard'

export enum ViewerEvent {
  Close
}

export interface ViewerEventCallbacks extends EventCallbacks {
  [ViewerEvent.Close]: () => void
}

/**
 *
 */
export class Viewer extends EventEmitter<ViewerEventCallbacks> {
  private surface: Surface
  private panZoom: PanZoom
  private clients: ClientManager
  private selection: Selection
  private chunkMap: ChunkMap
  private debug: boolean

  private selectedClient: Nullable<Client>
  private position: Vector2Like
  private tail: Tail

  public constructor() {
    super()

    this.debug = true
    this.surface = new Surface({ title: 'DigDig.IO Viewer' })
    this.panZoom = new PanZoom(this.surface, { panMouseButton: MouseButton.Right })
    this.selection = new Selection(this.surface, { mouseButton: MouseButton.Left })
    this.clients = new ClientManager()
    this.chunkMap = new ChunkMap()

    this.chunkMap.debug(this.debug)
    this.selectedClient = null
    this.position = { x: ChunkSize / 2, y: ChunkSize / 2 }
    this.tail = new Tail()
    const chunkPlaceholderOrigin = new ChunkPlaceholder({ position: { x: 0, y: 0 } })

    this.surface.keyboard.on(KeyboardEvent.KeyDown, (e) => {
      if (e.scancode === Scancodes.H && !e.repeat) {
        this.debug = !this.debug
        this.chunkMap.debug(this.debug)
      }
    })

    this.surface.on(SurfaceEvent.Render, (ctx) => {
      const context = { ctx, mouse: this.surface.mouse, keyboard: this.surface.keyboard, selection: this.selection }

      this.surface.clear()
      this.panZoom.apply()
      ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2)
      ctx.scale(6, 6)

      const pushPos = (position: Vector2Like) => {
        this.position = { x: (position.x + 0.5) * ChunkSize, y: (position.y + 0.5) * ChunkSize }
        this.tail.insert(this.position)
      }

      const clientList = this.clients.list()
      if (clientList.length > 0 && this.selectedClient == null) {
        this.selectedClient = clientList[0]
        this.selectedClient.on(ClientEvent.PositionUpdated, pushPos)
      } else if (this.selectedClient != null && !this.clients.has(this.selectedClient)) {
        this.selectedClient.off(ClientEvent.PositionUpdated, pushPos)
        this.selectedClient = null
      }

      ctx.translate(-this.position.x, -this.position.y)

      chunkPlaceholderOrigin.render(context)
      this.chunkMap.render(context)
      this.tail.render(context)
      this.selection.render(context)
    })
    this.surface.on(SurfaceEvent.Close, () => {
      const clients = this.clients.list()
      for (const client of clients) {
        client.close()
      }
      this.dispatcher.emit(ViewerEvent.Close)
    })
  }

  public take(client: Client) {
    this.clients.add(client)
    const onChunk = (chunk: Chunk) => this.chunkMap.feed(chunk)
    const onDisconnect = () => {
      client.off(ClientEvent.ChunkRecieved, onChunk)
      client.off(ClientEvent.Disconnect, onDisconnect)
      this.clients.remove(client)
    }
    client.on(ClientEvent.ChunkRecieved, onChunk)
    client.on(ClientEvent.Disconnect, onDisconnect)
  }
}

export default Viewer
