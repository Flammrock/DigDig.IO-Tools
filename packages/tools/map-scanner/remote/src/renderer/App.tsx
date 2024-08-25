import React, { useEffect, useRef, useState } from 'react'
import { State } from './state'
import { Nullable } from 'shared'
import { Stage } from '@pixi/react'
import Viewer, { ViewerHandle } from './components/viewer'
import Button, { ButtonFeedback } from './components/button'
import Menu from './components/menu'
import IconSave from './components/icons/icon-save'
import IconSaveAs from './components/icons/icon-save-as'
import IconNew from './components/icons/icon-new'
import IconOpen from './components/icons/icon-open'
import IconClose from './components/icons/icon-close'
import { ActionBar, ActionOptions } from './components/action'
import IconPan from './components/icons/icon-pan'
import IconFollow from './components/icons/icon-follow'

interface AppProps {
  state: State
}

// ╭═────═⌘═────═╮
// | Entry  Point |
// ╰═────═⌘═────═╯
export const App: React.FC<AppProps> = ({ state }) => {
  const parentRef = useRef<Nullable<HTMLDivElement>>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const viewerRef = useRef<ViewerHandle>(null)

  useEffect(() => {
    const handleResize = () => {
      if (parentRef.current) {
        const { width, height } = parentRef.current.getBoundingClientRect()
        setDimensions({ width, height })
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const handleOnNew = async () => await state.cache.new()
  const handleOnOpen = async () => {
    await state.cache.open()
    return ButtonFeedback.Success
  }
  const handleOnSave = async () => {
    await state.cache.save()
    return ButtonFeedback.Success
  }
  const handleOnSaveAs = async () => {
    await state.cache.saveAs()
    return ButtonFeedback.Success
  }

  const actions: ActionOptions = [
    {
      name: 'Follow',
      icon: <IconFollow />,
      onSelect: () => {
        if (viewerRef.current) viewerRef.current.follow()
      }
    },
    {
      name: 'Pan',
      icon: <IconPan />,
      onSelect: () => {
        if (viewerRef.current) viewerRef.current.panZoom()
      }
    }
  ]

  return (
    <>
      <Menu>
        <Button icon={<IconNew />} name={'New'} onClick={handleOnNew} />
        <Button icon={<IconOpen />} name={'Open'} onClick={handleOnOpen} />
        <Button icon={<IconSave />} name={'Save'} onClick={handleOnSave} />
        <Button icon={<IconSaveAs />} name={'Save As...'} onClick={handleOnSaveAs} />
        <Button icon={<IconClose />} name={'Close this tool'} />
      </Menu>
      <ActionBar actions={actions} />
      <div ref={parentRef} style={{ display: 'block', width: '100%', height: '100%', boxSizing: 'border-box' }}>
        {dimensions.width === 0 || dimensions.height === 0 ? (
          <></>
        ) : (
          <Stage
            style={{
              position: 'absolute',
              display: 'block',
              left: '0px',
              top: '0px',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box'
            }}
            width={dimensions.width}
            height={dimensions.height}
            options={{ background: 0, backgroundAlpha: 0 }}
          >
            <Viewer ref={viewerRef} state={state} />
          </Stage>
        )}
      </div>
    </>
  )
}

/*const handleRender = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const mouse = new Mouse(ctx)

    const clients = manager.list()
    if (clients.length > 0) {
      position.x = (clients[0].position.x + 0.5) * ChunkSize
      position.y = (clients[0].position.y + 0.5) * ChunkSize
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    state.panZoom.apply(ctx)
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2)
    ctx.scale(6, 6)

    ctx.translate(-position.x, -position.y)
    state.chunkMap.render({ ctx, mouse })

    mouse.destroy()
  }*/

export default App
