// Read section metadata and active data initializers. This is not an encoder and
// never exposes an operation that rewrites or executes the supplied module.
class Reader {
  constructor(bytes, start = 0, end = bytes.length) { this.bytes = bytes; this.position = start; this.end = end; }
  byte() {
    if (this.position >= this.end) throw Error('Truncated WASM section');
    return this.bytes[this.position++];
  }
  integer(signed = false) {
    let value = 0, shift = 0;
    for (let index = 0; index < 5; index++, shift += 7) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        if (signed && (byte & 64)) value -= 2 ** (shift + 7);
        if (!Number.isSafeInteger(value) || value < (signed ? -0x80000000 : 0) || value > (signed ? 0x7fffffff : 0xffffffff)) {
          throw Error('Unsupported WASM integer');
        }
        return value;
      }
    }
    throw Error('Invalid WASM integer length');
  }
  slice(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.position + length > this.end) throw Error('Truncated WASM payload');
    const value = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return value;
  }
  name() { return new TextDecoder('utf-8', { fatal: true }).decode(this.slice(this.integer())); }
}

export function readModuleData(bytes) {
  if (bytes.length < 8 || [0, 97, 115, 109, 1, 0, 0, 0].some((byte, index) => bytes[index] !== byte)) throw Error('Unsupported WASM header');
  const reader = new Reader(bytes, 8);
  const exports = [], data = [];
  let definedMemories = 0, ordinaryMemory = false;
  while (reader.position < reader.end) {
    const id = reader.byte(), length = reader.integer();
    const section = new Reader(reader.slice(length));
    if (id === 5) {
      definedMemories = section.integer();
      if (definedMemories !== 1) throw Error('Resolver requires one ordinary wasm32 memory');
      const flags = section.integer();
      if (flags > 1) throw Error('Shared or memory64 layouts are unsupported');
      section.integer();
      if (flags & 1) section.integer();
      ordinaryMemory = true;
    } else if (id === 7) {
      const count = section.integer();
      if (count > 100000) throw Error('Too many WASM exports');
      for (let index = 0; index < count; index++) {
        const name = section.name(), kind = section.byte(), reference = section.integer();
        if (kind === 2) exports.push({ name, index: reference });
      }
    } else if (id === 10) {
      // Local declarations use run-length encoding. Bound their expanded size
      // before passing untrusted bytes into WABT, not only after text decoding.
      const count = section.integer();
      if (count > 20000 || length > 4 * 1024 * 1024) throw Error('WASM code exceeds the analysis limit');
      let totalLocals = 0;
      for (let index = 0; index < count; index++) {
        const bodyLength = section.integer();
        if (bodyLength > 1024 * 1024) throw Error('WASM function exceeds the analysis limit');
        const body = new Reader(section.slice(bodyLength));
        const groups = body.integer();
        if (groups > 10000) throw Error('Too many WASM local declarations');
        let locals = 0;
        for (let group = 0; group < groups; group++) {
          locals += body.integer();
          if (locals > 100000) throw Error('WASM expanded local count exceeds the analysis limit');
          if (![0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f].includes(body.byte())) throw Error('Unsupported WASM local type');
        }
        totalLocals += locals;
        if (totalLocals > 1000000) throw Error('WASM total local count exceeds the analysis limit');
      }
    } else if (id === 11) {
      const count = section.integer();
      if (count > 10000) throw Error('Too many WASM data segments');
      for (let index = 0; index < count; index++) {
        const flags = section.integer();
        let address, memory = 0;
        if (flags !== 0 && flags !== 1 && flags !== 2) throw Error('Unsupported WASM data segment');
        if (flags === 2) memory = section.integer();
        if (flags !== 1) {
          if (section.byte() !== 0x41) throw Error('Nonconstant WASM data initializer is unsupported');
          address = section.integer(true) >>> 0;
          if (section.byte() !== 0x0b) throw Error('Unsupported WASM initializer expression');
        }
        const contents = section.slice(section.integer());
        if (address !== undefined) {
          if (memory !== 0 || address + contents.length > 0x100000000) throw Error('Unsupported data memory address');
          data.push({ address, bytes: contents });
        }
      }
    }
  }
  if (!ordinaryMemory || definedMemories !== 1 || exports.length !== 1 || exports[0].index !== 0
    || !exports[0].name || exports[0].name.length > 128 || /[\x00-\x1f\x7f]/.test(exports[0].name)) {
    throw Error('Resolver requires one unambiguous exported memory');
  }
  return { memoryExport: exports[0].name, data };
}

export function readInitialBytes(data, address, length) {
  const overlapping = data.filter(segment => segment.address < address + length && segment.address + segment.bytes.length > address);
  if (overlapping.length !== 1) return null;
  const segment = overlapping[0], offset = address - segment.address;
  return offset < 0 || offset + length > segment.bytes.length ? null : segment.bytes.subarray(offset, offset + length);
}
