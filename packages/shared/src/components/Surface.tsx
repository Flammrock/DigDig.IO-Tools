import React, { useEffect, useRef } from 'react'
import { PanZoom } from '../rendering/pan-zoom'
import { Nullable } from '../utils/helpers'
import Mouse, { MouseEventType } from '../core/mouse'
import { Scene } from '../rendering/scene'

export interface SurfaceProps {
  scene: Scene
  panZoom?: PanZoom
}

export const Surface: React.FC<SurfaceProps> = ({ scene, panZoom }) => {
  const canvasRef = useRef<Nullable<HTMLCanvasElement>>(null)

  useEffect(() => {
    let cancelled = false

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parentElement = canvas.parentElement
    if (!parentElement) return

    const globalScene = panZoom ?? scene
    if (panZoom) panZoom.add(scene)

    const handleDomEvent = (event: Event) => globalScene.handleEvent(ctx, event)
    canvas.addEventListener('mousedown', handleDomEvent)
    canvas.addEventListener('mouseup', handleDomEvent)
    canvas.addEventListener('mousemove', handleDomEvent)
    canvas.addEventListener('wheel', handleDomEvent)

    const resizeCanvas = () => {
      if (canvas && parentElement) {
        canvas.width = parentElement.clientWidth
        canvas.height = parentElement.clientHeight
      }
    }

    resizeCanvas()

    const render = () => {
      if (cancelled) return
      ////// if (onRender && typeof onRender === 'function') {
      //////   onRender(ctx, canvas)
      ////// }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      resizeCanvas()
      ctx.translate(canvas.width / 2, canvas.height / 2)
      globalScene.render(ctx)
      requestAnimationFrame(render)
    }

    setTimeout(render, 100)

    return () => {
      cancelled = true
      canvas.removeEventListener('mousedown', handleDomEvent)
      canvas.removeEventListener('mouseup', handleDomEvent)
      canvas.removeEventListener('mousemove', handleDomEvent)
      canvas.removeEventListener('wheel', handleDomEvent)
    }
  }, [panZoom, scene])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', boxSizing: 'border-box' }} />
}

export default Surface
