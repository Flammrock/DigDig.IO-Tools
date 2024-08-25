import React from 'react'
import { ToolRenderer } from 'shared'
import styled from 'styled-components'

interface HomePageProps {
  tools: Array<ToolRenderer>
  onToolSelect: (tool: ToolRenderer) => void
}

const ToolCard = styled.div`
  width: 120px;
  height: 80px;
  background-color: #111;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-5px);
  }
`

const ToolIcon = styled.div`
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background-color: #e0e0e0;
  font-size: 24px;
  font-weight: bold;
  color: #08f;
  user-select: none;
`

const ToolName = styled.span`
  font-size: 14px;
  font-weight: bold;
  color: #e0e0e0;
  text-align: center;
  text-transform: uppercase;
  font-family: Ubuntu;
`

const Container = styled.div`
  margin: 20px;
`

const ToolList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
`

const Instruction = styled.div`
  font-size: 20px;
  color: #bbb;
  text-align: center;
  margin-bottom: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-family: Ubuntu;
  text-transform: uppercase;
  user-select: none;
`

const Emoji = styled.span`
  font-size: 36px;
`

const Blue = styled.span`
  color: #08f;
`

const Bold = styled.span`
  font-weight: bolder;
`

const HomePage: React.FC<HomePageProps> = ({ tools, onToolSelect }) => {
  return (
    <Container>
      <Instruction>
        <Emoji>🛠️</Emoji>
        <div>
          Click on a <Blue>tool</Blue> below to <Bold>use it</Bold>!
        </div>
      </Instruction>
      <ToolList>
        {tools.map((tool, index) => (
          <ToolCard key={index} onClick={() => onToolSelect(tool)}>
            <ToolIcon>{tool.icon}</ToolIcon>
            <ToolName>{tool.name}</ToolName>
          </ToolCard>
        ))}
      </ToolList>
    </Container>
  )
}

export default HomePage
