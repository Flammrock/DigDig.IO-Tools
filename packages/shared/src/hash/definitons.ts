const hex_chr = '0123456789abcdef'.split('')

const hex = function (x: Array<number | string>) {
  for (let i = 0; i < x.length; i++) x[i] = hex_chr[((x[i] as number) >> 4) & 0x0f] + hex_chr[(x[i] as number) & 0x0f]
  return x.join('')
}

////////////////////// /**
//////////////////////  * Reverse function of the tb function.
//////////////////////  *
//////////////////////  * **Note:**
//////////////////////  * A lot faster than just doing this:
//////////////////////  * ```typescript
//////////////////////  * function rtb2(a) {
//////////////////////  *   return Array.from(new Int32Array(new Uint8Array(a).buffer))
//////////////////////  * }
//////////////////////  * ```
//////////////////////  */
////////////////////// function rtb(a: Array<number>): Array<number> {
//////////////////////   const x = new Array(a.length / 4)
//////////////////////   for (let i = 0, u = 0; i < x.length; i++) {
//////////////////////     let n = 0
//////////////////////     for (let j = 0; j < 4; j++) {
//////////////////////       n |= (a[u++] & 0xff) << (j * 8)
//////////////////////     }
//////////////////////     x[i] = n
//////////////////////   }
//////////////////////   return x
////////////////////// }

export class Hash {
  public constructor(private bytes: Array<number>) {}

  public toString(): string {
    return hex(this.bytes)
  }

  public toBuffer(): ArrayBuffer {
    return new Uint8Array(this.bytes).buffer
  }

  public toArray(): Array<number> {
    return this.bytes.slice()
  }
}

export interface HashAlgorithm {
  hash: (s: string) => Hash
}
