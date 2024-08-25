import { Chunk, RectangleLike, ChunkSize, Writeable } from 'shared'

class ExtractedChunk {
  public readonly chunk: Chunk
  public readonly bounds: RectangleLike
  public readonly isSelected: boolean
  private debugInformation: boolean
  private readonly offscreen: OffscreenCanvasRenderingContext2D

  public get image(): OffscreenCanvas {
    return this.offscreen.canvas
  }

  public get id(): string {
    return this.chunk.position.toString()
  }

  public constructor(chunk: Chunk) {
    this.chunk = chunk
    this.bounds = {
      x: this.chunk.position.x * ChunkSize,
      y: this.chunk.position.y * ChunkSize,
      width: ChunkSize,
      height: ChunkSize
    }
    this.isSelected = false
    this.debugInformation = true
    const canvas = new OffscreenCanvas(ChunkSize, ChunkSize)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to retrieve 2d context.')
    this.offscreen = ctx
    this.cache()
  }

  private cache(): void {
    const rawImage = this.chunk.toPixels()
    const pixels = new ImageData(rawImage.data, rawImage.width, rawImage.height)
    this.offscreen.clearRect(0, 0, ChunkSize, ChunkSize)
    this.offscreen.putImageData(pixels, 0, 0)
  }

  public debug(value: boolean): void {
    this.debugInformation = value
  }

  public update(chunk: Chunk): void {
    ;(<Writeable<ExtractedChunk>>this).chunk = chunk
    ;(<Writeable<ExtractedChunk>>this).bounds = {
      x: this.chunk.position.x * ChunkSize,
      y: this.chunk.position.y * ChunkSize,
      width: ChunkSize,
      height: ChunkSize
    }
    this.cache()
  }
}

export default ExtractedChunk
