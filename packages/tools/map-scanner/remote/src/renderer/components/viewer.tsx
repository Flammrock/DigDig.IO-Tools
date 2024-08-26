import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import {
  ChannelClient,
  ChannelClientEventType,
  ChannelClientManagerEventType,
  ChunkSize,
  useChannel,
  Vector2Like
} from 'shared'
import * as PIXI from 'pixi.js'
import { Container, useApp, useTick } from '@pixi/react'
import { Viewport as InternalViewport } from 'pixi-viewport'
import Viewport from './viewport'
import ChunkMap from './chunk-map'
import { State } from '../state'
import { ClientManager } from '../core/client-manager'
import { ClientEvent } from '../core/client'

export interface ViewerHandle {
  follow: () => void
  panZoom: () => void
}

const Viewer = React.forwardRef<ViewerHandle, { state: State }>(({ state }, ref) => {
  const app = useApp()
  const viewportRef = useRef<InternalViewport>(null)
  const channel = useChannel('viewer')
  const manager = useMemo(() => new ClientManager(), [channel])
  const followModeRef = useRef(true)
  const lastPositionRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<PIXI.Container>(null)
  const clientsMapRef = useRef<Map<string, PIXI.Graphics>>(new Map())
  const borderAnimationRef = useRef<Record<string, number>>({})

  const handleSprite = (clientId: string, position: Vector2Like) => {
    if (!containerRef.current) return
    if (clientsMapRef.current.has(clientId)) {
      const sprite = clientsMapRef.current.get(clientId)
      if (sprite) {
        sprite.x = (position.x + 0.5) * ChunkSize
        sprite.y = (position.y + 0.5) * ChunkSize
      }
      return
    }
    const sprite = new PIXI.Graphics()
    sprite.beginFill(0x888888)
    sprite.lineStyle(2, 0xffffff)
    sprite.drawCircle(0, 0, 10)
    sprite.endFill()
    sprite.x = position.x
    sprite.y = position.y
    containerRef.current.addChild(sprite)
    clientsMapRef.current.set(clientId, sprite)
  }
  const removeSprite = (clientId: string) => {
    if (clientsMapRef.current.has(clientId)) {
      const sprite = clientsMapRef.current.get(clientId)
      if (sprite) {
        if (containerRef.current) {
          containerRef.current.removeChild(sprite)
        }
        if (!sprite.destroyed) sprite.destroy(true)
      }
      clientsMapRef.current.delete(clientId)
    }
    delete borderAnimationRef.current[clientId]
  }

  useEffect(() => {
    const handleInComing = (cc: ChannelClient) => {
      manager.add(cc).on(ClientEvent.ChunkRecieved, (chunk) => state.cache.feed(chunk))
      manager.add(cc).on(ClientEvent.PositionUpdated, (position) => handleSprite(cc.id, position))
      cc.on(ChannelClientEventType.Close, () => removeSprite(cc.id))
    }
    channel.on(ChannelClientManagerEventType.InComing, handleInComing)
    return () => {
      channel.off(ChannelClientManagerEventType.InComing, handleInComing)
    }
  }, [manager, channel])

  useEffect(() => {
    const handleResize = () => {
      if (!viewportRef.current) return
      const viewport = viewportRef.current
      const preResizeWorldCenter = viewport.center
      viewport.resize(app.screen.width, app.screen.height)
      const newCenterX = app.screen.width / 2
      const newCenterY = app.screen.height / 2
      viewport.moveCenter(preResizeWorldCenter.x, preResizeWorldCenter.y)
      const offsetX = newCenterX - viewport.toScreen(preResizeWorldCenter.x, preResizeWorldCenter.y).x
      const offsetY = newCenterY - viewport.toScreen(preResizeWorldCenter.x, preResizeWorldCenter.y).y
      viewport.position.set(viewport.position.x + offsetX, viewport.position.y + offsetY)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      follow() {
        followModeRef.current = true
      },
      panZoom() {
        followModeRef.current = false
      }
    }),
    []
  )

  useTick((delta) => {
    if (!viewportRef.current) return
    clientsMapRef.current.forEach((sprite, clientId) => {
      const amplitude = 5
      const speed = 0.1
      if (typeof borderAnimationRef.current[clientId] === 'undefined') borderAnimationRef.current[clientId] = 0
      borderAnimationRef.current[clientId] += delta * speed
      const bounce = Math.sin(borderAnimationRef.current[clientId]) * amplitude
      sprite.clear()
      sprite.lineStyle(2 + bounce, 0xffffff)
      sprite.beginFill(0x888888)
      sprite.drawCircle(0, 0, 10)
      sprite.endFill()
    })
    if (followModeRef.current) {
      const clients = manager.list()
      if (clients.length > 0) {
        lastPositionRef.current = {
          x: (clients[0].position.x + 0.5) * ChunkSize,
          y: (clients[0].position.y + 0.5) * ChunkSize
        }
      }
      viewportRef.current.moveCenter(lastPositionRef.current.x, lastPositionRef.current.y)
    } else {
      lastPositionRef.current = {
        x: viewportRef.current.center.x,
        y: viewportRef.current.center.y
      }
    }
  })

  return (
    <Viewport ref={viewportRef}>
      <ChunkMap cache={state.cache} />
      <Container ref={containerRef} />
    </Viewport>
  )
})

Viewer.displayName = 'Viewer'

export default Viewer
