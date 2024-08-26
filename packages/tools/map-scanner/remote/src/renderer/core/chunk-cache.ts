import { Chunk, ChunkAggregator, EventCallbacks, EventEmitter, Nullable, RectangleLike } from 'shared'
import ExtractedChunk from './extracted-chunk'

export enum ChunkCacheEventType {
  Update,
  Clear
}

export enum ChunkCacheExportType {
  PNG
}

export interface ChunkCacheEventCallbacks extends EventCallbacks {
  [ChunkCacheEventType.Update]: (chunk: ExtractedChunk) => void
  [ChunkCacheEventType.Clear]: () => void
}

export class ChunkCache extends EventEmitter<ChunkCacheEventCallbacks> {
  private internal: Record<string, ExtractedChunk>
  public readonly aggregator: ChunkAggregator
  private debugInformation: boolean
  private filePath: Nullable<string>

  public constructor() {
    super()
    this.internal = {}
    this.aggregator = new ChunkAggregator()
    this.filePath = null
    this.debugInformation = true
  }

  public debug(value: boolean): void {
    this.debugInformation = value
  }

  public clear(): void {
    this.internal = {}
    this.aggregator.clear()
    this.debugInformation = true
    this.fire(ChunkCacheEventType.Clear)
  }

  private update(chunk: Chunk): void {
    const merged = this.aggregator.get(chunk.position)
    if (!merged) return
    const key = merged.position.toString()
    if (typeof this.internal[key] === 'undefined') {
      this.internal[key] = new ExtractedChunk(merged)
      this.fire(ChunkCacheEventType.Update, this.internal[key])
    } else {
      this.internal[key].update(merged)
      this.fire(ChunkCacheEventType.Update, this.internal[key])
    }
  }

  has(id: string): boolean
  has(chunk: Chunk): boolean
  has(extractedChunk: ExtractedChunk): boolean
  public has(a: Chunk | ExtractedChunk | string): boolean {
    if (typeof a === 'string') return typeof this.internal[a] !== 'undefined'
    if (a instanceof Chunk) return typeof this.internal[a.position.toString()] !== 'undefined'
    return typeof this.internal[a.chunk.position.toString()] !== 'undefined'
  }

  public feed(chunk: Chunk): void {
    this.aggregator.feed(chunk)
    this.update(chunk)
  }

  public import(buffer: ArrayBuffer): void {
    this.aggregator.import(buffer)
    for (const chunk of this.aggregator.chunks) {
      this.update(chunk)
    }
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
    this.import(await fs.readFile(filePath))
  }

  public async saveTo(filePath: string): Promise<void> {
    // TODO: try catch
    const buffer = this.aggregator.export()
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

  public computeBoundingBox(): RectangleLike {
    let minX: number | null = null,
      minY: number | null = null
    let maxX: number | null = null,
      maxY: number | null = null
    for (const key in this.internal) {
      const chunk = this.internal[key]
      const { x, y, width, height } = chunk.bounds
      if (minX === null || x < minX) minX = x
      if (minY === null || y < minY) minY = y
      if (maxX === null || x + width > maxX) maxX = x + width
      if (maxY === null || y + height > maxY) maxY = y + height
    }
    if (minX === null) minX = 0
    if (minY === null) minY = 0
    if (maxX === null) maxX = 0
    if (maxY === null) maxY = 0
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  public async exportAsPng(): Promise<ArrayBuffer> {
    const bounds = this.computeBoundingBox()
    const canvas = document.createElement('canvas')
    canvas.width = bounds.width
    canvas.height = bounds.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2d canvas context.')
    for (const key in this.internal) {
      const chunk = this.internal[key]
      const { x, y, width, height } = chunk.bounds
      ctx.beginPath()
      ctx.rect(x - bounds.x, y - bounds.y, width, height)
      ctx.fillStyle = '#522e00'
      ctx.fill()
      ctx.drawImage(chunk.image, x - bounds.x, y - bounds.y, width, height)
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (!blob) return reject()
        resolve(blob)
      }, 'image/png')
    )
    const arrayBuffer = await blob.arrayBuffer()
    return arrayBuffer
  }

  public async exportAs(type: ChunkCacheExportType): Promise<void> {
    if (type !== ChunkCacheExportType.PNG) throw new Error('Only PNG export currently supported.')
    const result = await Dialog.showSaveDialog({
      defaultPath: 'digdig.chunks.png',
      filters: [{ name: 'DigDig.IO PNG Chunks', extensions: ['png'] }]
    })
    if (result.canceled) return
    const buffer = await this.exportAsPng()
    await fs.writeFile(result.filePath, buffer)
  }
}

export default ChunkCache
