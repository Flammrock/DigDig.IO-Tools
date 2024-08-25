/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import Dispatcher, { Callable } from './dispatcher'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventCallbacks = Record<any, Callable>

export class EventEmitter<E extends EventCallbacks> {
  // TODO: SHOULD BE PRIVATE
  protected dispatcher = new Dispatcher()

  public on<T extends keyof E>(eventType: T, callback: E[T]): this {
    this.dispatcher.on(eventType, callback)
    return this
  }

  public off<T extends keyof E>(eventType: T, callback: E[T]): this {
    this.dispatcher.off(eventType, callback)
    return this
  }

  public fire<T extends keyof E>(eventType: T, ...args: Parameters<E[T]>): this {
    this.dispatcher.emit(eventType, ...args)
    return this
  }

  public offAll(): void {
    this.dispatcher.offAll()
  }
}

export default EventEmitter
