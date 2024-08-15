/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import sdl from '@kmamal/sdl'
import { EventCallbacks, EventEmitter } from 'shared'

export enum KeyboardEvent {
  KeyDown,
  KeyUp
}

export interface KeyboardEventCallbacks extends EventCallbacks {
  [KeyboardEvent.KeyDown]: (e: sdl.Events.Window.KeyDown) => void
  [KeyboardEvent.KeyUp]: (e: sdl.Events.Window.KeyUp) => void
}

export const Scancodes = sdl.keyboard.SCANCODE

export interface KeyboardIsDownOptions {
  ctrl: boolean
  shift: boolean
  alt: boolean
  altgr: boolean
  repeat: boolean
  capslock: boolean
  numlock: boolean
}

/**
 *
 */
export class Keyboard extends EventEmitter<KeyboardEventCallbacks> {
  private readonly window: sdl.Sdl.Video.Window
  public readonly keys: Record<number, sdl.Events.Window.KeyDown>

  public constructor(window: sdl.Sdl.Video.Window) {
    super()
    this.window = window
    this.keys = {}

    this.window.on('keyDown', (e) => {
      this.keys[e.scancode] = e
      this.dispatcher.emit(KeyboardEvent.KeyDown, e)
    })
    this.window.on('keyUp', (e) => {
      delete this.keys[e.scancode]
      this.dispatcher.emit(KeyboardEvent.KeyUp, e)
    })
  }

  public isDown(scancode: number, options: Partial<KeyboardIsDownOptions> = {}): boolean {
    const key = this.keys[scancode]
    if (typeof key === 'undefined') return false
    for (const prop in options) {
      if (Object.prototype.hasOwnProperty.call(options, prop)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((key as any)[prop] !== (options as any)[prop]) return false
      }
    }
    return true
  }
}

export default Keyboard
