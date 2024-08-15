/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 * UniqueIdProvider class generates unique IDs by combining a counter, a random number, and the current time.
 */
export class UniqueIdProvider {
  /**
   * A counter incremented with each ID generation to ensure uniqueness.
   * This helps avoid collisions when:
   * - `performance.now()` returns the same value as the previous call to `.next()`.
   * - `Math.random()` returns the same value as the previous call to `.next()`.
   *
   * In scenarios where ID generation happens rapidly, and `Math.random()` returns the same value consecutively,
   * the counter guarantees uniqueness.
   *
   * Note: Even if the CPU is fast enough that `performance.now()` and `Math.random()` return the same values repeatedly,
   * this counter ensures unique IDs for up to 4,294,967,295 successive calls.
   */
  private increment = 0

  /**
   * Generates a unique ID.
   *
   * @returns {string} A unique identifier string.
   */
  public next(): string {
    this.increment = ((this.increment >>> 0) + 1) >>> 0
    return `id_${(++this.increment).toString(36)}_${Math.random().toString(36).substring(2)}_${performance.now().toString(36).replace('.', '_')}`
  }
}

export default UniqueIdProvider
