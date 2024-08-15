/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './css/index.css'
import 'resources/fonts'

import Viewer from './tools/viewer'
import WebSocketProvider, { WebSocketProviderEventType } from './core/websocket-provider'
import Client from './core/client'

// ╭═────═⌘═────═╮
// | Entry  Point |
// ╰═────═⌘═────═╯
const viewer = new Viewer()
window.addEventListener('load', () => {
  document.body.appendChild(viewer.element)
})
WebSocketProvider.on(WebSocketProviderEventType.Connection, (ws) => {
  viewer.take(new Client(ws))
})
Menu.on('click', (e) => {
  if (e.name === 'new') viewer.new()
  else if (e.name === 'open') viewer.open()
  else if (e.name === 'save') viewer.save()
  else if (e.name === 'save-as') viewer.saveAs()
  else if (e.name === 'show-controls') viewer.showControls()
})
