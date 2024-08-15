/*********************************************************************************\
* Copyright (c) 2024 Flammrock                                                    *
* Copyright (c) 2014 Michael Tang // tangmi                                       *
* Copyright (c) 2014 Alexey M.    // norlin                                       *
* Copyright (c) 2014 Alex Bennett // timetocode                                   *
*                                                                                 *
* Permission is hereby granted, free of charge, to any person obtaining a copy    *
* of this software and associated documentation files (the "Software"), to deal   *
* in the Software without restriction, including without limitation the rights    *
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell       *
* copies of the Software, and to permit persons to whom the Software is           *
* furnished to do so, subject to the following conditions:                        *
*                                                                                 *
* The above copyright notice and this permission notice shall be included in all  *
* copies or substantial portions of the Software.                                 *
*                                                                                 *
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR      *
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,        *
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE     *
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER          *
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,   *
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE   *
* SOFTWARE.                                                                       *
\*********************************************************************************/

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
const SECONDS_TO_NANOSECONDS = 1e9
const NANOSECONDS_TO_SECONDS = 1 / SECONDS_TO_NANOSECONDS // avoid a divide later, although maybe not nessecary
const MILLISECONDS_TO_NANOSECONDS = 1e6
const DEFAULT_TICK = 1000 / 30 // 30 FPS

const getLoopId = (): number => {
  if (Object.values(Loops).length > MAXIMUM_LOOPS)
    throw new Error(`Too many loops (only ${MAXIMUM_LOOPS} loops allowed).`)
  let id = performance.now() | 0
  while (typeof Loops[id] !== 'undefined') id++
  return id
}

const getNano = (): number => {
  const hrtime = process.hrtime()
  return +hrtime[0] * SECONDS_TO_NANOSECONDS + +hrtime[1]
}

/**
 * Create a game loop that will attempt to update at some target `tickLengthMs`.
 *
 * `tickLengthMs` defaults to 30fps (~33.33ms).
 *
 * Internally, the `gameLoop` function created has two mechanisms to update itself.
 * One for coarse-grained updates (with `setTimeout`) and one for fine-grained
 * updates (with `setImmediate`).
 *
 * On each tick, we set a target time for the next tick. We attempt to use the coarse-
 * grained "long wait" to get most of the way to our target tick time, then use the
 * fine-grained wait to wait the remaining time.
 */
export const setLoop = (callback: LoopCallback, tickLengthMs = DEFAULT_TICK): LoopId => {
  const id = getLoopId()
  Loops[id] = true

  // expected tick length
  const tickLengthNano = tickLengthMs * MILLISECONDS_TO_NANOSECONDS

  // We pick the floor of `tickLengthMs - 1` because the `setImmediate` below runs
  // around 16ms later and if our coarse-grained 'long wait' is too long, we tend
  // to miss our target framerate by a little bit
  const longwaitMs = Math.floor(tickLengthMs - 1)
  const longwaitNano = longwaitMs * MILLISECONDS_TO_NANOSECONDS

  let prev = getNano()
  let target = getNano()

  let frame = 0

  const loop = () => {
    frame++

    const now = getNano()

    // do not go on to renew loop if no longer active
    if (typeof Loops[id] === 'undefined') return

    if (now >= target) {
      const delta = now - prev

      prev = now
      target = now + tickLengthNano

      // actually run user code
      callback(delta * NANOSECONDS_TO_SECONDS)
    }

    // re-grab the current time in case we ran update and it took a long time
    const remainingInTick = target - getNano()
    if (remainingInTick > longwaitNano) {
      // unfortunately it seems our code/node leaks memory if setTimeout is
      // called with a value less than 16, so we give up our accuracy for
      // memory stability
      setTimeout(loop, Math.max(longwaitMs, 16))
    } else {
      setImmediate(loop)
    }
  }

  // begin the loop!
  setImmediate(loop)

  return id
}

export const clearLoop = (id: LoopId) => {
  // remove the loop id from the active loops
  delete Loops[id]
}
