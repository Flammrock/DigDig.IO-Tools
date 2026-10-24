const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_PNG_INTEGER = 0x7fffffff;
const STORED_BLOCK_BYTES = 65535;
const ADLER_MODULUS = 65521;

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = crcTable[(crc ^ bytes[index]!) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Exact output size, including filter bytes and framing; allocates no image buffer. */
export function getPngRgbaByteLength(width: number, height: number): number {
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= MAX_PNG_INTEGER)) {
    throw new Error('PNG dimensions must be positive integers within the PNG format limit.');
  }
  const scanlineBytes = (width * 4 + 1) * height;
  const idatBytes = 6 + scanlineBytes + 5 * Math.ceil(scanlineBytes / STORED_BLOCK_BYTES);
  if (!Number.isSafeInteger(scanlineBytes) || !Number.isSafeInteger(idatBytes) || idatBytes > MAX_PNG_INTEGER) {
    throw new Error('The uncompressed PNG is too large to encode.');
  }
  // Signature (8), IHDR (25), IDAT framing (12), and IEND (12).
  return 57 + idatBytes;
}

/**
 * RGBA8 PNG with filter None and uncompressed DEFLATE stored blocks.
 * Copies straight RGBA bytes, including RGB under transparent or partial alpha.
 * PNG framing: https://www.w3.org/TR/png-3/
 * Zlib/stored blocks: RFC 1950 and RFC 1951 section 3.2.4.
 */
export function encodePngRgba(width: number, height: number,
  pixels: Uint8Array | Uint8ClampedArray, maxBytes = DEFAULT_MAX_BYTES): Uint8Array<ArrayBuffer> {
  const length = getPngRgbaByteLength(width, height);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('PNG byte limit must be a positive safe integer.');
  if (length > maxBytes) {
    throw new Error(`The uncompressed PNG requires ${length} bytes, exceeding the ${maxBytes}-byte export limit.`);
  }
  if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) {
    throw new Error('PNG pixels must contain exactly four RGBA bytes per pixel.');
  }
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  output.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;

  function beginChunk(type: string, size: number): number {
    view.setUint32(offset, size);
    offset += 4;
    const start = offset;
    for (let index = 0; index < 4; index++) output[offset++] = type.charCodeAt(index);
    return start;
  }
  function endChunk(start: number) {
    view.setUint32(offset, crc32(output, start, offset));
    offset += 4;
  }

  const header = beginChunk('IHDR', 13);
  view.setUint32(offset, width); offset += 4;
  view.setUint32(offset, height); offset += 4;
  output.set([8, 6, 0, 0, 0], offset); offset += 5;
  endChunk(header);

  const data = beginChunk('IDAT', length - 57);
  // CM=DEFLATE, 32 KiB window, no dictionary, fastest/no compression, FCHECK.
  output.set([0x78, 0x01], offset); offset += 2;
  const rowBytes = width * 4;
  let remaining = (rowBytes + 1) * height;
  let source = 0, rowOffset = 0, adlerA = 1, adlerB = 0;
  while (remaining > 0) {
    const count = Math.min(remaining, STORED_BLOCK_BYTES);
    output[offset++] = count === remaining ? 1 : 0; // BFINAL; BTYPE=00; zero padding.
    view.setUint16(offset, count, true); offset += 2;
    view.setUint16(offset, count ^ 0xffff, true); offset += 2;
    for (let index = 0; index < count; index++) {
      const byte = rowOffset === 0 ? 0 : pixels[source++]!;
      output[offset++] = byte;
      adlerA += byte;
      adlerB += adlerA;
      if (++rowOffset > rowBytes) rowOffset = 0;
    }
    // At most 65,535 additions stay exact in JavaScript's integer range.
    adlerA %= ADLER_MODULUS;
    adlerB %= ADLER_MODULUS;
    remaining -= count;
  }
  view.setUint32(offset, (adlerB << 16 | adlerA) >>> 0); offset += 4;
  endChunk(data);
  endChunk(beginChunk('IEND', 0));
  return output;
}
