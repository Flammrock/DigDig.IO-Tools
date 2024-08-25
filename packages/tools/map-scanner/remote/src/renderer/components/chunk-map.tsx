/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import React, { useEffect, useRef } from 'react'
import { Container } from '@pixi/react'
import * as PIXI from 'pixi.js'
import ChunkCache, { ChunkCacheEventType } from '../core/chunk-cache'
import ExtractedChunk from '../core/extracted-chunk'

interface ChunkMapProps {
  cache: ChunkCache
}

const inject = (container: PIXI.Container, localCache: Map<string, PIXI.Sprite>, chunk: ExtractedChunk): void => {
  const { id, image, bounds } = chunk
  let sprite = localCache.get(id)

  if (sprite) {
    // Update existing sprite
    sprite.texture = PIXI.Texture.from(image)
    sprite.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST
    sprite.x = bounds.x
    sprite.y = bounds.y
    sprite.width = bounds.width
    sprite.height = bounds.height
  } else {
    // Create new sprite
    const localContainer = new PIXI.Container()
    const background = new PIXI.Graphics()
    background.beginFill(0x522e00)
    background.drawRect(bounds.x, bounds.y, bounds.width, bounds.height)
    background.endFill()
    localContainer.addChild(background)
    const texture = PIXI.Texture.from(image)
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST
    sprite = new PIXI.Sprite(texture)
    sprite.x = bounds.x
    sprite.y = bounds.y
    sprite.width = bounds.width
    sprite.height = bounds.height
    localContainer.addChild(sprite)
    container.addChild(localContainer)
    localCache.set(id, sprite)
  }
}

const ChunkMap: React.FC<ChunkMapProps> = ({ cache }) => {
  const containerRef = useRef<PIXI.Container>(null)
  const spritesMapRef = useRef<Map<string, PIXI.Sprite>>(new Map())

  useEffect(() => {
    const container = containerRef.current
    const localCache = spritesMapRef.current
    if (!container) return
    const chunks = Object.values(cache['internal'])
    chunks.forEach((chunk) => inject(container, localCache, chunk))
    const handleCacheUpdate = (chunk: ExtractedChunk) => inject(container, localCache, chunk)
    const handleCacheClear = () => {
      localCache.clear()
      container.removeChildren()
    }
    cache.on(ChunkCacheEventType.Update, handleCacheUpdate)
    cache.on(ChunkCacheEventType.Clear, handleCacheClear)
    return () => {
      cache.off(ChunkCacheEventType.Clear, handleCacheClear)
    }
  }, [cache])

  return <Container ref={containerRef} />
}

export default ChunkMap
