import { DialogBridgeAPI, FsBridgeAPI, MenuBridgeAPI, ToolBridgeAPI, WebSocketBridgeAPI } from './bridge/api'

declare global {
  const wss: WebSocketBridgeAPI
  const Menu: MenuBridgeAPI
  const Dialog: DialogBridgeAPI
  const fs: FsBridgeAPI
  const tools: ToolBridgeAPI
}
