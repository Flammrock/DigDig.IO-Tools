/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { ToolMain, ToolCallbackChannel, ToolCallbackChannelMethods, StripPrefix } from 'shared'
import { ipcMainHandle } from './utils'
import { BrowserWindow } from 'electron'
import { remoteApi } from './remote-api'

const cache: Record<string, ToolMain> = {}

const sendToolEvent = <T extends ToolCallbackChannel>(
  channel: T,
  window: BrowserWindow,
  ...args: Parameters<ToolCallbackChannelMethods[StripPrefix<T, 'tool.'>]>
): void => {
  window?.webContents.send(channel, ...args)
}

export function registerTool(tool: ToolMain): void {
  if (typeof cache[tool.name] !== 'undefined') {
    throw new Error(`Tool '${tool.name}' already registered.`)
  }
  cache[tool.name] = tool
}

const mount = async (window: BrowserWindow, name: string) => {
  if (typeof cache[name] === 'undefined') {
    throw new Error(`Tool '${name}' dont exists.`)
  }
  try {
    await unmount(window, name)
    await cache[name].mount(window, remoteApi)
  } finally {
    sendToolEvent('tool.update', window, name, await cache[name].is())
  }
}

const unmount = async (window: BrowserWindow, name: string) => {
  if (typeof cache[name] === 'undefined') {
    throw new Error(`Tool '${name}' dont exists.`)
  }
  try {
    await cache[name].unmount(window, remoteApi)
  } finally {
    sendToolEvent('tool.update', window, name, await cache[name].is())
  }
}

const is = async (name: string) => {
  if (typeof cache[name] === 'undefined') {
    throw new Error(`Tool '${name}' dont exists.`)
  }
  await cache[name].is()
}

export function registerToolHandlers() {
  ipcMainHandle('tool.mount', (event, name) => mount(BrowserWindow.fromWebContents(event.sender), name))
  ipcMainHandle('tool.unmount', (event, name) => unmount(BrowserWindow.fromWebContents(event.sender), name))
  ipcMainHandle('tool.is', (event, name) => is(name))
}
