/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Nullable } from '../utils/helpers'

/**
 *
 */
export class RecentItems<T> {
  private items: Array<T>
  private maxSize: number

  public constructor(maxSize: number = 10) {
    this.items = []
    this.maxSize = maxSize
  }

  public get length(): number {
    return this.items.length
  }

  public insert(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift() // Remove the oldest item
    }
    this.items.push(item)
  }

  public clear(): void {
    this.items = []
  }

  public first(): Nullable<T> {
    if (this.items.length === 0) return null
    return this.items[0]
  }

  public last(): Nullable<T> {
    if (this.items.length === 0) return null
    return this.items[this.items.length - 1]
  }

  public list(): ReadonlyArray<T> {
    return this.items
  }
}

export default RecentItems
