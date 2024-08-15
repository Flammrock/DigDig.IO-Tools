/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

// Taken and modified from https://github.com/tangmi/node-gameloop

export type LoopCallback = (delta: number) => void
export type LoopId = number

const Loops: Record<number, boolean> = {}

const MAXIMUM_LOOPS = 100
const DEFAULT_TICK = 1000 / 30 // 30 FPS

const getLoopId = (): number => {
  if (Object.values(Loops).length > MAXIMUM_LOOPS)
    throw new Error(`Too many loops (only ${MAXIMUM_LOOPS} loops allowed).`)
  let id = performance.now() | 0
  while (typeof Loops[id] !== 'undefined') id++
  return id
}

export const setLoop = (callback: LoopCallback, tickLengthMs = DEFAULT_TICK): LoopId => {
  const id = getLoopId()
  Loops[id] = true

  const loop = () => {
    if (typeof Loops[id] === 'undefined') return
    callback(0)
    requestAnimationFrame(loop)
  }

  // begin the loop!
  requestAnimationFrame(loop)

  return id
}

export const clearLoop = (id: LoopId) => {
  // remove the loop id from the active loops
  delete Loops[id]
}
