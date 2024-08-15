/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { NetworkBridge, UniqueBridgeIdProvider } from 'shared'

/**
 *
 */
export const MapScannerBridge: NetworkBridge = {
  port: 8543,
  handshake: new Uint32Array([UniqueBridgeIdProvider()]).buffer
}
