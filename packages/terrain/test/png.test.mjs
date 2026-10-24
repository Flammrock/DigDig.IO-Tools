import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { encodePngRgba, getPngRgbaByteLength } from '../src/png.ts';

// Independent bitwise CRC, without the encoder's lookup table.
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function decodePng(encoded) {
  const bytes = Buffer.from(encoded);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    assert.ok(offset + size + 12 <= bytes.length, 'chunk must fit in file');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + size + 8);
    assert.equal(bytes.readUInt32BE(offset + size + 8), crc32(bytes.subarray(offset + 4, offset + size + 8)), `${type} CRC`);
    chunks.push({ type, data });
    offset += size + 12;
  }
  assert.equal(offset, bytes.length);
  assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  const header = chunks[0].data;
  assert.equal(header.length, 13);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  assert.deepEqual(header.subarray(8), Buffer.from([8, 6, 0, 0, 0]), 'RGBA8, standard compression/filter method, no interlace');
  assert.equal(chunks[2].data.length, 0);
  const zlib = chunks[1].data;
  assert.equal(zlib.readUInt16BE(0) % 31, 0, 'zlib header checksum');
  assert.equal(zlib[0] & 15, 8, 'DEFLATE wrapper');
  assert.equal(zlib[1] & 32, 0, 'no preset dictionary');

  const blocks = [];
  offset = 2;
  let final = false;
  while (!final) {
    const flags = zlib[offset++];
    assert.ok(flags === 0 || flags === 1, 'only stored blocks with zero padding');
    final = Boolean(flags & 1);
    const size = zlib.readUInt16LE(offset);
    assert.equal(zlib.readUInt16LE(offset + 2), size ^ 0xffff, 'stored block length complement');
    offset += 4;
    assert.ok(size > 0 && offset + size <= zlib.length - 4);
    blocks.push(zlib.subarray(offset, offset + size));
    offset += size;
  }
  assert.equal(offset, zlib.length - 4, 'no trailing bytes before Adler32');
  const scanlines = inflateSync(zlib); // Independent DEFLATE and Adler32 validation.
  assert.deepEqual(Buffer.concat(blocks), scanlines);
  assert.equal(scanlines.length, (width * 4 + 1) * height);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    assert.equal(scanlines[row], 0, 'every row uses filter None');
    scanlines.copy(pixels, y * width * 4, row + 1, row + 1 + width * 4);
  }
  return { width, height, pixels, blockSizes: blocks.map(block => block.length) };
}

test('uncompressed PNG preserves every RGBA byte, including transparent RGB and partial alpha', () => {
  const source = Uint8ClampedArray.from([
    19, 201, 255, 255, 250, 100, 55, 0,
    17, 35, 82, 1, 255, 13, 9, 128,
  ]);
  const original = source.slice();
  const encoded = encodePngRgba(2, 2, source);
  const decoded = decodePng(encoded);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(decoded.pixels, Buffer.from(source));
  assert.deepEqual(source, original, 'encoding must not mutate the source');
  assert.equal(encoded.length, getPngRgbaByteLength(2, 2));
});

test('stored blocks split correctly before, at, and across 65,535-byte and scanline boundaries', () => {
  for (const [width, height] of [[16383, 1], [5461, 3], [16384, 1], [257, 150]]) {
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, index) => (index * 37 + Math.floor(index / 256)) & 255);
    const encoded = encodePngRgba(width, height, pixels);
    const decoded = decodePng(encoded);
    assert.deepEqual(decoded.pixels, Buffer.from(pixels));
    const rawBytes = (width * 4 + 1) * height;
    assert.equal(decoded.blockSizes.length, Math.ceil(rawBytes / 65535));
    assert.ok(decoded.blockSizes.slice(0, -1).every(size => size === 65535));
    assert.equal(decoded.blockSizes.at(-1), ((rawBytes - 1) % 65535) + 1);
    assert.equal(encoded.length, getPngRgbaByteLength(width, height));
  }
});

test('typed-array views encode only their visible bytes and obey the exact predicted limit', () => {
  const backing = Uint8Array.from([99, 98, 7, 19, 83, 127, 97]);
  const pixels = backing.subarray(2, 6);
  const size = getPngRgbaByteLength(1, 1);
  assert.equal(size, 73);
  assert.throws(() => encodePngRgba(1, 1, pixels, size - 1), /export limit/);
  const encoded = encodePngRgba(1, 1, pixels, size);
  assert.equal(encoded.length, size);
  assert.deepEqual(decodePng(encoded).pixels, Buffer.from([7, 19, 83, 127]));
});

test('invalid geometry, payloads, byte limits, and excessive output fail before image allocation', () => {
  const pixels = new Uint8Array(4);
  for (const invalid of [0, -1, 0.5, NaN, Infinity, 0x80000000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => encodePngRgba(invalid, 1, pixels), /dimensions/);
    assert.throws(() => encodePngRgba(1, invalid, pixels), /dimensions/);
  }
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => encodePngRgba(1, 1, pixels, invalid), /byte limit/);
  }
  for (const invalid of [new Uint8Array(3), new Uint8Array(5), new Uint16Array(4), [1, 2, 3, 4], null]) {
    assert.throws(() => encodePngRgba(1, 1, invalid), /RGBA bytes/);
  }
  assert.throws(() => encodePngRgba(8192, 8192, pixels), /export limit/, 'size limit is checked before payload allocation or access');
  assert.throws(() => getPngRgbaByteLength(0x7fffffff, 0x7fffffff), /too large/);
  assert.throws(() => getPngRgbaByteLength(0x7fffffff, 1), /too large/);
});
