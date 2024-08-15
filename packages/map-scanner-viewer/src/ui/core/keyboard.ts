/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { EventCallbacks, EventEmitter } from 'shared'

export enum KeyboardEventType {
  KeyDown,
  KeyUp
}

export interface KeyboardEvent {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  repeat: boolean
}

export interface KeyboardIsDownOptions {
  ctrl: boolean
  shift: boolean
  alt: boolean
  repeat: boolean
}

export interface KeyboardEventCallbacks extends EventCallbacks {
  [KeyboardEventType.KeyDown]: (e: KeyboardEvent) => void
  [KeyboardEventType.KeyUp]: (e: KeyboardEvent) => void
}

/**
 *
 */
export class Keyboard extends EventEmitter<KeyboardEventCallbacks> {
  private readonly keys: Record<string, KeyboardEvent>

  public constructor(ctx: CanvasRenderingContext2D) {
    super()
    this.keys = {}

    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = {
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        repeat: e.repeat
      }
      this.dispatcher.emit(KeyboardEventType.KeyDown, this.keys[e.key])
    })
    window.addEventListener('keyup', (e) => {
      const keyobj = this.keys[e.key]
      if (!keyobj) return
      delete this.keys[e.key]
      this.dispatcher.emit(KeyboardEventType.KeyUp, keyobj)
    })
  }

  public isDown(key: string, options: Partial<KeyboardIsDownOptions> = {}): boolean {
    const keyobj = this.keys[key]
    if (typeof keyobj === 'undefined') return false
    for (const prop in options) {
      if (Object.prototype.hasOwnProperty.call(options, prop)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((keyobj as any)[prop] !== (options as any)[prop]) return false
      }
    }
    return true
  }
}

export default Keyboard
