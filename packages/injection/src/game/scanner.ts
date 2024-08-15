/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/* eslint-disable prefer-spread */

import {
  Dispatcher,
  TimeSpan,
  Chunk,
  ChunkSize,
  Nullable,
  EventEmitter,
  EventCallbacks,
  TransformLike,
  GridVector2,
  Vector2Like
} from 'shared'
import { CTXTracker, CTXTrackerCallback, CTXTrackerMethod } from '../core/ctx-tracker'
import { InformationExtractorInjection } from './information-extractor'

export enum ScannerEvent {
  ChunkRecieved,
  PlayerPosition
}

export interface ScannerEventCallbacks extends EventCallbacks {
  [ScannerEvent.ChunkRecieved]: (chunk: Chunk) => void
  [ScannerEvent.PlayerPosition]: (position: Vector2Like) => void
}

export interface ScannerOptions {
  /**
   * Default: 1 second
   */
  ScanInterval: TimeSpan

  /**
   * Maximum distance around the player for chunk processing.
   *
   * Note: Set to 0 for infinite.
   *
   * Default: 1 chunk, which corresponds to:
   * ```text
   *     ,---,
   *     |   |
   * ,---;---;---,
   * |   |   |   |
   * '---;---;---'
   *     |   |
   *     '---'
   * ```
   */
  processDistance: number
}

export class Scanner extends EventEmitter<ScannerEventCallbacks> {
  private isTakingPicture: boolean
  private lastNow: number
  private scanInterval: number
  private processDistance: number

  public constructor(extractor: InformationExtractorInjection, options?: Partial<ScannerOptions>) {
    super()

    this.isTakingPicture = false
    this.lastNow = 0
    this.scanInterval = options?.ScanInterval?.totalMilliseconds() ?? 1000
    this.processDistance = options?.processDistance ?? 1
    this.dispatcher = new Dispatcher()

    let cache: Record<string, boolean> = {}

    CTXTracker.intercept(CTXTrackerMethod.ClearRect, (ctx, args) => {
      this.isTakingPicture = false
      if (Date.now() - this.lastNow > this.scanInterval) {
        this.lastNow = Date.now()
        this.isTakingPicture = true
        cache = {}
      }

      // We compute the player's position in the grid space
      const px = extractor.position.x / 1026 - 1
      const py = extractor.position.y / 1026 - 1
      this.dispatcher.emit(ScannerEvent.PlayerPosition, { x: px, y: py })
      // We have always this relation : extractor.mapSize * chunkSize.width / (extractor.mapSize * hiddenScale) == 1026
    })

    const chunkInterceptor: CTXTrackerCallback<CTXTrackerMethod.DrawImage> = (ctx, args) => {
      if (this.isTakingPicture) {
        if (Chunk.isChunk(args)) {
          const [image] = args

          const { a, d, e, f } = ctx.getTransform()

          // Because the chunk is being drawn at (0, 0) with (1, 1) dimensions, i.e. :
          //   ctx.drawImage(chunk, 0, 0, 1, 1)
          // It means that the scale is actually the chunk size in pixels
          // (matrix.a for the width and matrix.d for the height)
          const chunkSize = { width: a, height: d }

          // rpx and rpy contain now the position of the player relative to the center of the map
          const rpx = -extractor.scaledPosition.x
          const rpy = -extractor.scaledPosition.y

          // rx and ry contain now the position of the chunk relative to the center of the map
          // (the anchor point is the top left corner of the chunk)
          // (e and f are relative to the player position)
          const rx = e + rpx - chunkSize.width / 2
          const ry = f + rpy - chunkSize.height / 2

          // We can then compute its coordinate in the grid with a width of chunkSize.width
          // and a height of chunkSize.height
          // This is then used to give an unique name for the chunk in such a way that
          // we can now identify the chunk independanlty of the player's position
          const x = Math.round(rx / chunkSize.width)
          const y = Math.round(ry / chunkSize.height)

          // Check if already scanned, if so then abort
          const pos = new GridVector2(x, y).toString()
          if (typeof cache[pos] !== 'undefined') return
          cache[pos] = true

          // Player position in the grid space
          const px = Math.round(extractor.position.x / 1026 - 1)
          const py = Math.round(extractor.position.y / 1026 - 1)

          // We abort the process if this chunk is too far (for performance issues)
          // Maybe send the process to a web worker to not overload the ui thread
          if (this.processDistance > 0 && Math.hypot(x - px, y - py) > this.processDistance) {
            return
          }

          // Note: the chunkSize computed above and the ChunkSize constant declared in chunk.ts
          // must not be confused, ChunkSize is the size of the image 64x64 pixels
          // The chunkSize computed above is the size of the chunk in the world space

          // Build the chunk from the grid space coordinate and the image
          const chunk = new Chunk({ x, y }, image as OffscreenCanvas)

          // Notify the listeners
          this.dispatcher.emit(ScannerEvent.ChunkRecieved, chunk)
        }
      }
    }

    CTXTracker.intercept(CTXTrackerMethod.DrawImage, chunkInterceptor)
  }
}
