import { findInstructionSequences } from '../../../tools/wasm-analysis/src/instructions.mjs';
import { readInitialBytes } from './binary-data.mjs';

// The supported material meaning is pinned to this decoded RGB table/profile,
// not to an address or module hash. Unknown palettes require a new profile.
const PALETTE = [0xb834ba, 0xa8a116, 0x784400, 0x784400, 0x111111, 0x34a832, 0xad1a07, 0x32a8a0, 0xdddddd];
const drawPattern = [
  { op: 'local.get', operands: ['$capture:context'] },
  { op: 'local.get', operands: ['$capture:chunk'] },
  { op: 'call', operands: ['$capture:materialFunction'] },
  { op: 'local.get', operands: ['$capture:chunk'] },
  { op: 'i32.load16_u', memoryOffset: '$capture:gridX' },
  { op: 'i32.const', operands: ['10'] }, { op: 'i32.shl' }, { op: 'f64.convert_i32_u' },
  { op: 'f64.const', operands: ['-0x1p+0'] }, { op: 'f64.add' },
  { op: 'local.get', operands: ['$capture:chunk'] },
  { op: 'i32.load16_u', memoryOffset: '$capture:gridY' },
  { op: 'i32.const', operands: ['10'] }, { op: 'i32.shl' }, { op: 'f64.convert_i32_u' },
  { op: 'f64.const', operands: ['-0x1p+0'] }, { op: 'f64.add' },
  { op: 'f64.const', operands: ['0x1.008p+10'] },
  { op: 'f64.const', operands: ['0x1.008p+10'] },
  { op: 'call', operands: ['$capture:drawFunction'] },
];
const palettePattern = [
  { op: 'local.get', operands: ['$capture:material'] },
  { op: 'i32.const', operands: ['1'] }, { op: 'i32.sub' },
  { op: 'i32.const', operands: ['255'] }, { op: 'i32.and' },
  { op: 'i32.const', operands: ['2'] }, { op: 'i32.shl' },
  { op: 'i32.const', operands: ['$capture:palette'] }, { op: 'i32.add' },
  { op: 'i32.load', memoryOffset: 0 },
  { op: 'local.tee', operands: ['$capture:rgb'] },
  { op: 'i32.store8', memoryOffset: '$capture:blueByte' },
  { op: 'local.get', operands: ['$capture:rgbTarget'] },
  { op: 'local.get', operands: ['$capture:rgb'] },
  { op: 'i32.const', operands: ['8'] }, { op: 'i32.shr_u' },
  { op: 'i32.store8', memoryOffset: '$capture:greenByte' },
  { op: 'local.get', operands: ['$capture:rgbTarget'] },
  { op: 'local.get', operands: ['$capture:rgb'] },
  { op: 'i32.const', operands: ['16'] }, { op: 'i32.shr_u' },
  { op: 'i32.store8', memoryOffset: '$capture:redByte' },
];

export function findTerrainCandidates(functions, data) {
  const byName = new Map(functions.map(fn => [fn.name, fn]));
  const candidates = [];
  for (const render of functions) for (const draw of findInstructionSequences(render.instructions, drawPattern)) {
    const material = byName.get(draw.captures.materialFunction), emitter = byName.get(draw.captures.drawFunction);
    if (!material || !emitter || draw.captures.gridX === draw.captures.gridY) continue;
    // The draw helper emits the traced five-argument image command. Geometry is
    // subsequently cross-checked against actual Canvas draws by the userscript.
    if (!findInstructionSequences(emitter.instructions, [{ op: 'i32.const', operands: ['35'] }, { op: 'i32.store8', memoryOffset: 0 }]).length) continue;
    const creates = findInstructionSequences(material.instructions, [
      { op: 'local.get', operands: ['$capture:surface'] }, { op: 'i32.const', operands: ['64'] },
      { op: 'i32.const', operands: ['64'] }, { op: 'call', operands: ['$capture:create'] },
    ]);
    if (!creates.length) continue;
    const loops = findInstructionSequences(material.instructions, [
      { op: 'local.get', operands: ['$capture:index'] }, { op: 'i32.const', operands: ['1'] }, { op: 'i32.add' },
      { op: 'local.tee', operands: ['$capture:index'] }, { op: 'i32.const', operands: ['64'] }, { op: 'i32.ne' }, { op: 'br_if' },
    ]);
    if (new Set(loops.map(loop => loop.captures.index)).size !== 2) continue;
    for (const lookup of findInstructionSequences(material.instructions, palettePattern)) {
      const address = Number(lookup.captures.palette);
      const rgb = readInitialBytes(data, address, PALETTE.length * 4);
      if (!rgb || !Number.isSafeInteger(address) || address < 0 || address % 4) continue;
      const table = new DataView(rgb.buffer, rgb.byteOffset, rgb.byteLength);
      if (!PALETTE.every((value, index) => table.getUint32(index * 4, true) === value)) continue;
      const red = Number(lookup.captures.redByte);
      if (Number(lookup.captures.greenByte) !== red + 1 || Number(lookup.captures.blueByte) !== red + 2) continue;
      const before = material.instructions.slice(Math.max(0, lookup.start - 7), lookup.start);
      if (!findInstructionSequences(before, [
        { op: 'local.tee', operands: [lookup.captures.material] },
        { op: 'i32.const', operands: ['4'] }, { op: 'i32.ne' }, { op: 'if' },
      ]).length) continue;
      // Empty pixels take the separate 34-gray path. Alpha255 packing is part
      // of this material producer, not inferred from color-table presence alone.
      if (material.instructions.filter(ins => ins.op === 'i32.const' && ins.operands[0] === '34').length !== 3
        || !findInstructionSequences(material.instructions, [
          { op: 'i32.const', operands: ['-16777216'] }, { op: 'i32.or' }, { op: 'i32.store', memoryOffset: 0 },
        ]).length) continue;
      const candidate = { renderFunction: render.name, materialFunction: material.name, drawFunction: emitter.name,
        paletteAddress: address, gridXField: Number(draw.captures.gridX), gridYField: Number(draw.captures.gridY),
        terrain: { sourceWidth: 64, sourceHeight: 64, worldGridSpacing: 1024, worldDrawSize: 1026, worldDrawInset: -1, paletteProfile: 'materials-v1' } };
      if (!candidates.some(item => JSON.stringify(item) === JSON.stringify(candidate))) candidates.push(candidate);
    }
  }
  return candidates;
}
