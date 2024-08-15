/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 *
 */
export class Buffer {
  private buffer: ArrayBuffer
  private view: DataView
  private offset: number

  constructor(size: number)
  constructor(arrayBuffer: ArrayBuffer)
  constructor(a: ArrayBuffer | number) {
    if (typeof a === 'number') {
      this.buffer = new ArrayBuffer(a)
    } else {
      this.buffer = a
    }
    this.view = new DataView(this.buffer)
    this.offset = 0
  }

  public get size(): number {
    return this.buffer.byteLength
  }

  public readUint8(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getUint8(position)
    if (offset === undefined) this.offset += 1
    return value
  }

  public readUint16(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getUint16(position, true)
    if (offset === undefined) this.offset += 2
    return value
  }

  public readUint32(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getUint32(position, true)
    if (offset === undefined) this.offset += 4
    return value
  }

  public readInt8(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getInt8(position)
    if (offset === undefined) this.offset += 1
    return value
  }

  public readInt16(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getInt16(position, true)
    if (offset === undefined) this.offset += 2
    return value
  }

  public readInt32(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getInt32(position, true)
    if (offset === undefined) this.offset += 4
    return value
  }

  public readFloat32(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getFloat32(position, true)
    if (offset === undefined) this.offset += 4
    return value
  }

  public readFloat64(offset?: number): number {
    const position = offset ?? this.offset
    const value = this.view.getFloat64(position, true)
    if (offset === undefined) this.offset += 8
    return value
  }

  public writeUint8(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setUint8(position, value)
    if (offset === undefined) this.offset += 1
  }

  public writeUint16(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setUint16(position, value, true)
    if (offset === undefined) this.offset += 2
  }

  public writeUint32(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setUint32(position, value, true)
    if (offset === undefined) this.offset += 4
  }

  public writeInt8(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setInt8(position, value)
    if (offset === undefined) this.offset += 1
  }

  public writeInt16(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setInt16(position, value, true)
    if (offset === undefined) this.offset += 2
  }

  public writeInt32(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setInt32(position, value, true)
    if (offset === undefined) this.offset += 4
  }

  public writeFloat32(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setFloat32(position, value, true)
    if (offset === undefined) this.offset += 4
  }

  public writeFloat64(value: number, offset?: number): void {
    const position = offset ?? this.offset
    this.view.setFloat64(position, value, true)
    if (offset === undefined) this.offset += 8
  }

  public equals(otherBuffer: Buffer): boolean {
    if (this.size !== otherBuffer.size) {
      return false
    }

    for (let i = 0; i < this.size; i++) {
      if (this.view.getUint8(i) !== otherBuffer.view.getUint8(i)) {
        return false
      }
    }

    return true
  }

  public resetOffset(): void {
    this.offset = 0
  }

  public getArrayBuffer(): ArrayBuffer {
    return this.buffer
  }

  /**
   * Creates a new Buffer from the provided buffer-like object.
   * The input buffer is duplicated/copied to ensure the new Buffer
   * is a separate instance.
   *
   * @param buffer - The buffer-like object to duplicate. It can be an ArrayBuffer, a Buffer, or a Node.js Buffer.
   * @returns A new Buffer instance containing a copy of the data from the input buffer.
   * @throws {TypeError} - If the input buffer is of an unsupported type.
   */
  public static from(buffer: BufferLike): Buffer {
    if (buffer instanceof ArrayBuffer) {
      return new Buffer(buffer.slice(0))
    } else if (buffer instanceof Buffer) {
      return new Buffer(buffer.getArrayBuffer().slice(0))
    } else {
      throw new TypeError('Unsupported buffer type.')
    }
  }
}

export type BufferLike = ArrayBuffer | Buffer

export default Buffer
