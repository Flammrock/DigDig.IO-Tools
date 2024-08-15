/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

export type WebSocketHandleChannel = 'websocket.close'
export type WebSocketCallbackChannel = 'websocket.connection' | 'websocket.disconnection' | 'websocket.message'

export type MenuCallbackChannel = 'menu.click'

export type DialogHandleChannel = 'dialog.show-open' | 'dialog.show-save'

export type IOHandleChannel = 'io.read-file' | 'io.write-file'

export type HandleChannel = WebSocketHandleChannel | DialogHandleChannel | IOHandleChannel
export type CallbackChannel = WebSocketCallbackChannel | MenuCallbackChannel
