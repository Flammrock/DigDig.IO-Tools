/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Chunk, ChunkSize, Nullable, Transform, Vector2Like } from 'shared'
import Surface, { SurfaceEvent } from '../core/surface'
import PanZoom from '../core/pan-zoom'
import ClientManager from '../core/client-manager'
import Client, { ClientEvent } from '../core/client'
import Tail from '../graphics/tail'
import ChunkPlaceholder from '../graphics/chunk-placeholder'
import Selection from '../core/selection'
import ChunkMap from '../graphics/chunk-map'
import { MouseButton } from '../core/mouse'
import { KeyboardEventType } from '../core/keyboard'

/**
 *
 */
export class Viewer {
  private surface: Surface
  private panZoom: PanZoom
  private clients: ClientManager
  private selection: Selection
  private chunkMap: ChunkMap
  private debug: boolean

  private selectedClient: Nullable<Client>
  private position: Vector2Like
  private tail: Tail

  private filePath: Nullable<string>

  public get element(): HTMLCanvasElement {
    return this.surface.element
  }

  public constructor() {
    this.debug = true
    this.filePath = null
    this.surface = new Surface()
    this.panZoom = new PanZoom(this.surface, {
      panMouseButton: MouseButton.Right
    })
    this.selection = new Selection(this.surface, {
      mouseButton: MouseButton.Left
    })
    this.clients = new ClientManager()
    this.chunkMap = new ChunkMap()

    this.chunkMap.debug(this.debug)
    this.selectedClient = null
    this.position = { x: ChunkSize / 2, y: ChunkSize / 2 }
    this.tail = new Tail()
    const chunkPlaceholderOrigin = new ChunkPlaceholder({
      position: { x: 0, y: 0 }
    })

    this.surface.keyboard.on(KeyboardEventType.KeyUp, (e) => {
      if (e.key === 'h') {
        this.debug = !this.debug
        this.chunkMap.debug(this.debug)
      } else if (e.key === 'p') {
        this.panZoom.transform.set(Transform.Identity)
      }
    })

    this.surface.on(SurfaceEvent.Render, (ctx) => {
      const context = {
        ctx,
        mouse: this.surface.mouse,
        keyboard: this.surface.keyboard,
        selection: this.selection
      }

      this.surface.clear()
      this.panZoom.apply()
      ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2)
      ctx.scale(6, 6)

      const pushPos = (position: Vector2Like) => {
        this.position = {
          x: (position.x + 0.5) * ChunkSize,
          y: (position.y + 0.5) * ChunkSize
        }
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

  public clear(): void {
    this.chunkMap.clear()
    this.panZoom.transform.set(Transform.Identity)
    // TODO: disconnecct all clients
  }

  public async new(): Promise<void> {
    // TODO: try catch
    this.clear()
  }

  public async open(): Promise<void> {
    // TODO: try catch
    const result = await Dialog.showOpenDialog({
      defaultPath: 'digdig.chunks',
      filters: [{ name: 'DigDig.IO Chunks', extensions: ['chunks'] }]
    })
    if (result.canceled) return
    if (result.filePaths.length === 0) return
    this.filePath = result.filePaths[0]
    await this.importFrom(this.filePath)
  }

  public async importFrom(filePath: string): Promise<void> {
    // TODO: try catch
    this.chunkMap.import(await fs.readFile(filePath))
  }

  public async saveTo(filePath: string): Promise<void> {
    // TODO: try catch
    const buffer = this.chunkMap.aggregator.export()
    await fs.writeFile(filePath, buffer)
  }

  public async save(): Promise<void> {
    // TODO: try catch
    if (this.filePath === null) {
      await this.saveAs()
      return
    }
    await this.saveTo(this.filePath)
  }

  public async saveAs(): Promise<void> {
    // TODO: try catch
    const result = await Dialog.showSaveDialog({
      defaultPath: 'digdig.chunks',
      filters: [{ name: 'DigDig.IO Chunks', extensions: ['chunks'] }]
    })
    if (result.canceled) return
    this.filePath = result.filePath
    await this.saveTo(this.filePath)
  }

  public showControls(): void {
    document.getElementById('viewer-controls-ok').onclick = () => this.hideControls()
    document.getElementById('viewer-controls').classList.remove('hide')
  }

  public hideControls(): void {
    document.getElementById('viewer-controls').classList.add('hide')
  }
}

export default Viewer
