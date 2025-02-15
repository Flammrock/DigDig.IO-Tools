/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import React, { useEffect, useImperativeHandle, useRef } from 'react'
import { Container } from '@pixi/react'
import * as PIXI from 'pixi.js'
import ChunkCache, { ChunkCacheEventType } from '../core/chunk-cache'
import ExtractedChunk from '../core/extracted-chunk'

export interface ChunkMapHandle {
  enableSelection: () => void
  disableSelection: () => void
}

interface ChunkMapProps {
  cache: ChunkCache
}

const inject = (
  container: PIXI.Container,
  localCache: Map<string, PIXI.Sprite>,
  chunk: ExtractedChunk,
  onSelect: (id: string) => void
): void => {
  const { id, image, bounds } = chunk
  let sprite = localCache.get(id)

  if (sprite) {
    // Update existing sprite
    sprite.texture.update()
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
    sprite.interactive = true
    sprite.on('pointerdown', () => onSelect(id))
    localContainer.addChild(sprite)
    container.addChild(localContainer)
    localCache.set(id, sprite)
  }
}

const ChunkMap = React.forwardRef<ChunkMapHandle, ChunkMapProps>(({ cache }, ref) => {
  const containerRef = useRef<PIXI.Container>(null)
  const spritesMapRef = useRef<Map<string, PIXI.Sprite>>(new Map())
  const selectionEnabledRef = useRef(false)

  const selectedChunkRef = useRef<string | null>(null)
  // Helper to update visuals (border & tooltip) for selection
  const updateSelectionVisuals = () => {
    const selectedId = selectedChunkRef.current
    spritesMapRef.current.forEach((sprite, spriteId) => {
      // Get the container we added in inject() (which holds the sprite, background, etc.)
      const parentContainer = sprite.parent
      if (!parentContainer) return

      // If the chunk is selected, bring its container to the front.
      if (spriteId === selectedId && containerRef.current) {
        containerRef.current.setChildIndex(parentContainer, containerRef.current.children.length - 1)
      }

      // Look for existing border and tooltip (if any) by name
      let border = parentContainer.getChildByName('border') as PIXI.Graphics
      let tooltip = parentContainer.getChildByName('tooltip') as PIXI.Text

      if (spriteId === selectedId) {
        // Create/update border if selected
        if (!border) {
          border = new PIXI.Graphics()
          border.name = 'border'
          parentContainer.addChild(border)
        }
        border.clear()
        border.lineStyle(2, 0x00ff00) // Green border with thickness 2
        border.drawRect(sprite.x, sprite.y, sprite.width, sprite.height)

        // Create/update tooltip if selected
        if (!tooltip) {
          tooltip = new PIXI.Text('Press suppr to delete this chunk', {
            fontSize: 12,
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 2
          })
          tooltip.name = 'tooltip'
          parentContainer.addChild(tooltip)
        }
        // Position the tooltip above the sprite
        tooltip.x = sprite.x
        tooltip.y = sprite.y - tooltip.height - 5
        tooltip.visible = true
      } else {
        // Remove border and tooltip for unselected chunks
        if (border) {
          parentContainer.removeChild(border)
          border.destroy()
        }
        if (tooltip) {
          parentContainer.removeChild(tooltip)
          tooltip.destroy()
        }
      }
    })
  }
  const handleSelect = (id: string) => {
    if (!selectionEnabledRef.current) return
    if (selectedChunkRef.current === id) {
      selectedChunkRef.current = null
    } else {
      selectedChunkRef.current = id
    }
    updateSelectionVisuals()
  }

  useEffect(() => {
    const container = containerRef.current
    const localCache = spritesMapRef.current
    if (!container) return
    const chunks = Object.values(cache['internal'])
    chunks.forEach((chunk) => inject(container, localCache, chunk, handleSelect))
    const handleCacheUpdate = (chunk: ExtractedChunk) => {
      if (!containerRef.current) return
      if (containerRef.current.destroyed) return
      inject(containerRef.current, localCache, chunk, handleSelect)
    }
    const handleCacheClear = () => {
      localCache.clear()
      if (containerRef.current && !containerRef.current.destroyed) {
        container.children.forEach((child) => child.destroy({ children: true, baseTexture: true, texture: true }))
        container.removeChildren()
      }
    }
    cache.on(ChunkCacheEventType.Update, handleCacheUpdate)
    cache.on(ChunkCacheEventType.Clear, handleCacheClear)
    return () => {
      cache.off(ChunkCacheEventType.Clear, handleCacheClear)
    }
  }, [cache])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectionEnabledRef.current) return
      if (event.key === 'Delete' || event.key === 'Suppr') {
        const selectedId = selectedChunkRef.current
        if (selectedId && containerRef.current) {
          const sprite = spritesMapRef.current.get(selectedId)
          if (sprite) {
            const parentContainer = sprite.parent
            if (parentContainer) {
              containerRef.current.removeChild(parentContainer)
              parentContainer.destroy({ children: true, baseTexture: true, texture: true })
            }
            spritesMapRef.current.delete(selectedId)
          }
          cache.remove(selectedId)
          selectedChunkRef.current = null
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [cache])

  useImperativeHandle(
    ref,
    () => ({
      enableSelection() {
        selectionEnabledRef.current = true
      },
      disableSelection() {
        selectionEnabledRef.current = false
      }
    }),
    []
  )

  return <Container ref={containerRef} />
})

ChunkMap.displayName = 'ChunkMap'

export default ChunkMap
