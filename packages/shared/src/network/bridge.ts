/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

export interface NetworkBridge {
  port: number
  handshake: ArrayBuffer
}

export const UniqueBridgeIdProvider = ((): (() => number) => {
  let id = 1
  return (): number => id++
})()
