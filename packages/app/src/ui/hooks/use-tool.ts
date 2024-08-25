import { useState, useEffect, useCallback } from 'react'
import { ToolRenderer } from 'shared'

function useTool(list: Array<ToolRenderer>): [
  Array<ToolRenderer>,
  (toolName: string) => boolean, // Synchronous check
  (toolName: string) => void, // Mount (async but sync in use)
  (toolName: string) => void // Unmount (async but sync in use)
] {
  // Create a state to store tool states
  const [toolStates, setToolStates] = useState<Record<string, boolean>>({})

  const map = list.reduce(
    (acc, tool) => {
      if (typeof acc[tool.name] !== 'undefined') throw new Error(`Two tools have the same name '${tool.name}'.`)
      acc[tool.name] = tool
      return acc
    },
    {} as Record<string, ToolRenderer>
  )

  // Mount function
  const mount = useCallback(
    async (toolName: string) => {
      if (!toolStates[toolName]) {
        await tools.mount(toolName)
      }
    },
    [toolStates]
  )

  // Unmount function
  const unmount = useCallback(
    async (toolName: string) => {
      if (toolStates[toolName]) {
        await tools.unmount(toolName)
      }
    },
    [toolStates]
  )

  // Synchronous check function
  const is = useCallback(
    (toolName: string): boolean => {
      return !!toolStates[toolName]
    },
    [toolStates]
  )

  // Effect to handle tool state updates from `tools.update`
  useEffect(() => {
    const handleUpdate = (toolName: string, isMounted: boolean) => {
      if (
        (typeof toolStates[toolName] === 'boolean' && toolStates[toolName] !== isMounted) ||
        (typeof toolStates[toolName] !== 'boolean' && isMounted)
      ) {
        if (typeof map[toolName] === 'undefined')
          throw new Error(
            `Internal error the tool '${toolName}' is not in the TOOL_LIST provided to useTool(TOOL_LIST) react hook.`
          )
        map[toolName].reset()
      }
      setToolStates((prevState) => ({ ...prevState, [toolName]: isMounted }))
    }

    // Register the update listener
    tools.update(handleUpdate)

    // Clean up listener on component unmount
    return () => {
      tools.removeUpdate(handleUpdate)
    }
  }, [])

  return [list, is, mount, unmount]
}

export default useTool
