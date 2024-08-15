/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 * The "@ts-nocheck" below is mandatory because Typescript isn't smart enough to allow the following:
 *
 * ```
 * const originalInstantiate = WebAssembly.instantiate
 * WebAssembly.instantiate = (a, b) => {
 *   return originalInstantiate(a, b)
 * }
 * ```
 *
 * This is very weird, very cringe and very very annoying 😡😡😡😡🤬
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

/**
 *
 */
export type WasmInjectorCallback = (instance: WebAssembly.WebAssemblyInstantiatedSource) => void

/**
 * Sets up a WebAssembly module injector by overriding default WebAssembly instantiation methods.
 * This function should be invoked once at the beginning of a script injection in user scripts
 * (e.g., Tampermonkey/Greasemonkey) to ensure that custom logic is executed during module instantiation.
 *
 * @param callback - A callback function to be executed during the WebAssembly
 * instantiation process. This function receives the WebAssembly binary buffer and an optional imports
 * object as parameters.
 *
 * @example
 * // Example usage in a Tampermonkey/Greasemonkey script
 * WasmInjector((buffer, imports) => {
 *   console.log('Intercepted WebAssembly buffer:', buffer);
 *   // Modify the buffer or perform other operations as needed
 * });
 */
export const WasmInjector = (callbackInstance: WasmInjectorCallback) => {
  const _instantiateStreaming = WebAssembly.instantiateStreaming
  WebAssembly.instantiateStreaming = () => {
    return _instantiateStreaming(new Response())
  }

  const _instantiate = WebAssembly.instantiate
  WebAssembly.instantiate = async (buffer, imports) => {
    const instance = await _instantiate(buffer, imports)
    callbackInstance(instance)
    return instance
  }
}
