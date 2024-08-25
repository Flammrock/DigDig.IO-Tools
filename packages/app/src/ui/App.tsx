import React, { useState, Fragment } from 'react'
import styled from 'styled-components'

import { toolRenderer as scannerTool } from 'map-scanner-remote'
import useTool from './hooks/use-tool'
import { Nullable, ToolRenderer } from 'shared'
import HomePage from './pages/HomePage'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  width: 100vw;
  height: 100vh;
`

const ToolPanel = styled.div`
  width: 64px;
  background: #2a2a2a;
  border-right: 1px solid #444;
  display: flex;
  flex-direction: column;
  align-items: center;
  user-select: none;
`

const MainContent = styled.div`
  position: relative;
  flex: 1;
`

const ToolIcon = styled.div<{ active?: boolean }>`
  position: relative;
  margin-top: 1px;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: bold;
  color: #08f;
  background-color: ${(props) => (props.active ? '#222222' : 'transparent')};
  border-right: ${(props) => (props.active ? '2px solid #222222' : '1px solid #444')};
  user-select: none;
  &:hover {
    background-color: ${(props) => (props.active ? '#222222' : '#333')};
  }
`

const ToolDivider = styled.div`
  width: 64px;
  height: 1px;
  background: #3a3a3a;
`

export function App() {
  const [list, is, mount, unmount] = useTool([scannerTool])
  const [activeTool, setActiveTool] = useState<Nullable<ToolRenderer>>(null)

  const handleSelect = async (tool: ToolRenderer) => {
    await mount(tool.name)
    setActiveTool(tool)
  }

  return (
    <Container>
      <ToolPanel>
        <ToolIcon onClick={() => setActiveTool(null)} active={!activeTool}>
          <span>
            <i className="cf-regular cf-home"></i>
          </span>
        </ToolIcon>
        {list.map(
          (tool, index) =>
            is(tool.name) && (
              <Fragment key={index}>
                <ToolDivider />
                <ToolIcon onClick={() => setActiveTool(tool)} active={activeTool === tool}>
                  {tool.icon}
                </ToolIcon>
              </Fragment>
            )
        )}
      </ToolPanel>
      <MainContent>
        {activeTool ? activeTool.render() : <HomePage tools={list} onToolSelect={handleSelect} />}
      </MainContent>
    </Container>
  )
}

export default App
