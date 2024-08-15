/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { WebSocketServer } from 'ws'
import { MapScannerBridge } from 'map-scanner-shared'
import Client from './core/client'
import Viewer, { ViewerEvent } from './tools/viewer'

// ╭═────═⌘═────═╮
// | Entry  Point |
// ╰═────═⌘═────═╯
const wss = new WebSocketServer({ port: MapScannerBridge.port })
const viewer = new Viewer()
viewer.on(ViewerEvent.Close, () => wss.close())
wss.on('connection', (ws) => viewer.take(new Client(ws)))
