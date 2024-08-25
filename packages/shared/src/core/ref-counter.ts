export class RefCounter<T> {
  private counter = 0
  public constructor(public readonly item: T) {}
  public increment(): this {
    this.counter++
    return this
  }
  public decrement(): this {
    if (this.counter > 0) this.counter--
    return this
  }
  public isUse(): boolean {
    return this.counter > 0
  }
}
