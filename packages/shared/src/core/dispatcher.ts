/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 * A type representing a callable function that takes any number of arguments of any type and returns any type.
 * @callback Callable
 * @param {...any} args - The arguments to pass to the callable function.
 * @returns {any} The return value of the callable function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Callable = (...args: any[]) => any

/**
 * A class representing an event dispatcher.
 * @class Dispatcher
 *
 * @example
 * // Example usage of the Dispatcher class with custom events
 * enum MyEvent {
 *   Draw,
 *   Clear
 * }
 *
 * interface MyEventFn {
 *   [MyEvent.Draw]: (a: number, b: number) => void
 *   [MyEvent.Clear]: (f: boolean) => number
 * }
 *
 * class MyClass {
 *   private dispatcher = new Dispatcher()
 *
 *   public on<T extends keyof MyEventFn>(eventType: T, callback: MyEventFn[T]): void {
 *     this.dispatcher.on(eventType, callback)
 *   }
 *
 *   public off<T extends keyof MyEventFn>(eventType: T, callback: MyEventFn[T]): void {
 *     this.dispatcher.off(eventType, callback)
 *   }
 *
 *   public emit<T extends keyof MyEventFn>(eventType: T, args: Parameters<MyEventFn[T]>): void {
 *     this.dispatcher.emit(eventType, args)
 *   }
 * }
 *
 * const myInstance = new MyClass()
 *
 * // Register event handlers
 * myInstance.on(MyEvent.Clear, (f) => {
 *   return 5
 * })
 */
export class Dispatcher {
  /**
   * A map storing event types and their associated callbacks.
   * @private
   * @type {Map<unknown, Array<Callable>>}
   */
  private events: Map<unknown, Array<Callable>> = new Map()

  /**
   * Registers a callback function to be invoked when the specified event type is emitted.
   * @template T
   * @param {T} eventType - The event type to listen for.
   * @param {Callable} callback - The callback function to register.
   * @returns {void}
   */
  on<T>(eventType: T, callback: Callable): void {
    if (!this.events.has(eventType)) {
      this.events.set(eventType, [])
    }
    this.events.get(eventType)!.push(callback)
  }

  /**
   * Unregisters a callback function from the specified event type.
   * @template T
   * @param {T} eventType - The event type to stop listening for.
   * @param {Callable} callback - The callback function to unregister.
   * @returns {void}
   */
  off<T>(eventType: T, callback: Callable): void {
    if (!this.events.has(eventType)) return
    const callbacks = this.events.get(eventType)
    if (callbacks) {
      this.events.set(
        eventType,
        callbacks.filter((cb) => cb !== callback)
      )
    }
  }

  /**
   * Emits an event of the specified type, invoking all registered callback functions with the provided arguments.
   * @template T
   * @param {T} eventType - The event type to emit.
   * @param {...Array<unknown>} args - The arguments to pass to the callback functions.
   * @returns {void}
   */
  emit<T>(eventType: T, ...args: Array<unknown>): void {
    const callbacks = this.events.get(eventType)
    if (callbacks) {
      callbacks.forEach((callback) => callback(...args))
    }
  }
}

export default Dispatcher
