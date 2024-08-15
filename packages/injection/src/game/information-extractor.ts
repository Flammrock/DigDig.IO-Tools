/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Nullable, Vector2Like } from 'shared'
import { WasmInjector } from '../core/wasm-injector'

export enum MemoryLocation {
  RELATIVE_MAP_X = 0x1c9078, // 1871992
  RELATIVE_MAP_Y = 0x1c907c, // 1871996
  MAP_SIZE_LOCATION = 0x1c9080, // 1872000
  X_LOCATION = 0x2147f0, // 2181096 + 8
  Y_LOCATION = 0x2147f4, // 2181096 + 12
  SCALE = 0x2147f8, // 2181096 + 16
  VIEW_WIDTH = 0x2147fc, // 2181096 + 20
  VIEW_HEIGHT = 0x214800 // 2181096 + 24
}

export class InformationExtractorInjection {
  private static instance: InformationExtractorInjection

  /**
   * Contains the absolute position scaled of the center of the map
   */
  public get scaledPosition(): Vector2Like {
    if (this.memory === null) return { x: 0, y: 0 }
    const scale = this.scale
    const width = this.memory.getInt32(MemoryLocation.VIEW_WIDTH, true)
    const height = this.memory.getInt32(MemoryLocation.VIEW_HEIGHT, true)
    const relx = this.memory.getFloat32(MemoryLocation.RELATIVE_MAP_X, true)
    const rely = this.memory.getFloat32(MemoryLocation.RELATIVE_MAP_Y, true)
    const x = this.memory.getFloat32(MemoryLocation.X_LOCATION, true)
    const y = this.memory.getFloat32(MemoryLocation.Y_LOCATION, true)
    return {
      x: (relx - x) * scale + width / 2,
      y: (rely - y) * scale + height / 2
    }
  }

  /**
   * Contains the absolute position normalized between [-1, 1] of the player
   * These coordinates are dependent of the map's size
   *
   * ```
   * x = position.x / map.width
   * y = position.y / map.height
   * ```
   *
   * Note: the map of the size is varying according to the number of diggers (players) currently playing
   */
  public get normalizedPosition(): Vector2Like {
    if (this.memory === null) return { x: 0, y: 0 }
    const size = this.memory.getFloat32(MemoryLocation.MAP_SIZE_LOCATION, true)
    const relx = this.memory.getFloat32(MemoryLocation.RELATIVE_MAP_X, true)
    const rely = this.memory.getFloat32(MemoryLocation.RELATIVE_MAP_Y, true)
    const x = this.memory.getFloat32(MemoryLocation.X_LOCATION, true)
    const y = this.memory.getFloat32(MemoryLocation.Y_LOCATION, true)
    return { x: (x - relx) / size, y: (y - rely) / size }
  }

  public get position(): Vector2Like {
    if (this.memory === null) return { x: 0, y: 0 }
    const relx = this.memory.getFloat32(MemoryLocation.RELATIVE_MAP_X, true)
    const rely = this.memory.getFloat32(MemoryLocation.RELATIVE_MAP_Y, true)
    const x = this.memory.getFloat32(MemoryLocation.X_LOCATION, true)
    const y = this.memory.getFloat32(MemoryLocation.Y_LOCATION, true)
    return { x: x - relx, y: y - rely }
  }

  public get scale(): number {
    if (this.memory === null) return 1
    const internalScale = this.memory.getFloat32(MemoryLocation.SCALE, true)
    const width = this.memory.getInt32(MemoryLocation.VIEW_WIDTH, true) * 0.00052083336
    const height = this.memory.getInt32(MemoryLocation.VIEW_HEIGHT, true) * 0.00092592591
    return (width > height ? width : height) * internalScale
  }

  public get mapSize(): number {
    if (this.memory === null) return 9000
    return this.memory.getFloat32(MemoryLocation.MAP_SIZE_LOCATION, true)
  }

  private memory: Nullable<DataView>

  private constructor() {
    this.memory = null

    WasmInjector((instance) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.memory = new DataView((instance.instance.exports as any).Lf.buffer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).memory = this.memory
    })
  }

  public static getInstance(): InformationExtractorInjection {
    if (!InformationExtractorInjection.instance) {
      InformationExtractorInjection.instance = new InformationExtractorInjection()
    }
    return InformationExtractorInjection.instance
  }
}

export const InformationExtractor = {
  inject(): InformationExtractorInjection {
    return InformationExtractorInjection.getInstance()
  }
}
