import { findInstructionSequences } from './instructions.mjs';

// This is a hypothesis from one archived build, not a universal game signature.
// Local identifiers and map addresses are captured instead of hardcoded.
const viewportScale = [
  { op: 'local.get', operands: ['$capture:camera'] },
  { op: 'i32.load', memoryOffset: '$capture:heightField' },
  { op: 'local.tee', operands: ['$capture:height'] },
  { op: 'f32.convert_i32_s' },
  { op: 'f32.const', operands: ['0x1.e573acp-11'] },
  { op: 'f32.mul' },
  { op: 'local.tee', operands: ['$capture:heightScale'] },
  { op: 'local.get', operands: ['$capture:camera'] },
  { op: 'i32.load', memoryOffset: '$capture:widthField' },
  { op: 'local.tee', operands: ['$capture:width'] },
  { op: 'f32.convert_i32_s' },
  { op: 'f32.const', operands: ['0x1.111112p-11'] },
  { op: 'f32.mul' },
  { op: 'local.tee', operands: ['$capture:widthScale'] },
  { op: 'local.get', operands: ['$capture:widthScale'] },
  { op: 'local.get', operands: ['$capture:heightScale'] },
  { op: 'f32.lt' },
  { op: 'select' },
  { op: 'local.get', operands: ['$capture:camera'] },
  { op: 'f32.load', memoryOffset: '$capture:scaleField' },
  { op: 'f32.mul' },
  { op: 'local.tee', operands: ['$capture:scale'] },
  { op: 'i32.const', operands: ['$capture:mapSize'] },
  { op: 'f32.load', operands: [] },
  { op: 'f32.mul' }
];

function originPattern(offset) {
  return [
    { op: 'local.get', operands: ['$capture:scale'] },
    { op: 'i32.const', operands: ['$capture:origin'] },
    { op: 'f32.load', operands: [] },
    { op: 'local.get', operands: ['$capture:camera'] },
    { op: 'f32.load', operands: [`offset=${offset}`] },
    { op: 'f32.sub' },
    { op: 'f32.mul' },
    { op: 'f64.promote_f32' },
    { op: 'f64.add' }
  ];
}

export function findCoordinateCandidates(functions) {
  const reciprocalCandidates = functions.flatMap((fn) => findInstructionSequences(fn.instructions, viewportScale).flatMap((scale) => {
    const remaining = fn.instructions.slice(scale.end, scale.end + 100);
    const consistent = (match) => match.captures.scale === scale.captures.scale && match.captures.camera === scale.captures.camera;
    const xs = findInstructionSequences(remaining, originPattern(8)).filter(consistent);
    const ys = findInstructionSequences(remaining, originPattern(12)).filter(consistent);
    return xs.flatMap((x) => ys.flatMap((y) => {
      const originX = Number(x.captures.origin);
      const originY = Number(y.captures.origin);
      const mapSize = Number(scale.captures.mapSize);
      if (!Number.isSafeInteger(originX) || originY !== originX + 4 || mapSize !== originX + 8) return [];
      const cameraFields = { x: 8, y: 12, scale: Number(scale.captures.scaleField),
        viewWidth: Number(scale.captures.widthField), viewHeight: Number(scale.captures.heightField) };
      if (!validFields(cameraFields)) return [];
      return [{
        function: fn.name,
        instruction: scale.start,
        cameraLocal: scale.captures.camera,
        originX,
        originY,
        mapSize,
        cameraFields
      }];
    }));
  }));
  return [...reciprocalCandidates, ...findDivisionCoordinateCandidates(functions)];
}

// The current compiler retains division by the viewport dimensions and places
// the radius/scale operands before the max calculation. Match those operations
// directly; changing them to reciprocal multiplication can change f32 rounding.
const viewportDivisionScale = [
  { op: 'i32.const', operands: ['$capture:mapSize'] },
  { op: 'f32.load', operands: [] },
  { op: 'local.get', operands: ['$capture:camera'] },
  { op: 'f32.load', memoryOffset: '$capture:scaleField' },
  { op: 'local.get', operands: ['$capture:camera'] },
  { op: 'i32.load', memoryOffset: '$capture:heightField' },
  { op: 'local.tee', operands: ['$capture:height'] },
  { op: 'f32.convert_i32_s' },
  { op: 'f32.const', operands: ['0x1.0ep+10'] },
  { op: 'f32.div' },
  { op: 'local.tee', operands: ['$capture:heightScale'] },
  { op: 'local.get', operands: ['$capture:camera'] },
  { op: 'i32.load', memoryOffset: '$capture:widthField' },
  { op: 'local.tee', operands: ['$capture:width'] },
  { op: 'f32.convert_i32_s' },
  { op: 'f32.const', operands: ['0x1.ep+10'] },
  { op: 'f32.div' },
  { op: 'local.tee', operands: ['$capture:widthScale'] },
  { op: 'local.get', operands: ['$capture:heightScale'] },
  { op: 'local.get', operands: ['$capture:widthScale'] },
  { op: 'f32.gt' },
  { op: 'select' },
  { op: 'f32.mul' },
  { op: 'local.tee', operands: ['$capture:scale'] },
  { op: 'f32.mul' }
];

function divisionOriginPattern() {
  return [
    { op: 'local.get', operands: ['$capture:viewport'] },
    { op: 'f64.convert_i32_s' },
    { op: 'f64.const', operands: ['0x1p-1'] },
    { op: 'f64.mul' },
    { op: 'i32.const', operands: ['$capture:origin'] },
    { op: 'f32.load', operands: [] },
    { op: 'local.get', operands: ['$capture:camera'] },
    { op: 'f32.load', memoryOffset: '$capture:coordinateField' },
    { op: 'f32.sub' },
    { op: 'local.get', operands: ['$capture:scale'] },
    { op: 'f32.mul' },
    { op: 'f64.promote_f32' },
    { op: 'f64.add' },
    { op: 'f32.demote_f64' }
  ];
}

function findDivisionCoordinateCandidates(functions) {
  return functions.flatMap((fn) => findInstructionSequences(fn.instructions, viewportDivisionScale).flatMap((scale) => {
    const remaining = fn.instructions.slice(scale.end, scale.end + 100);
    const consistent = (axis) => (match) => match.captures.scale === scale.captures.scale
      && match.captures.camera === scale.captures.camera && match.captures.viewport === scale.captures[axis];
    const axes = findInstructionSequences(remaining, divisionOriginPattern());
    const xs = axes.filter(consistent('width'));
    const ys = axes.filter(consistent('height'));
    return xs.flatMap((x) => ys.flatMap((y) => {
      const originX = Number(x.captures.origin);
      const originY = Number(y.captures.origin);
      const mapSize = Number(scale.captures.mapSize);
      if (!Number.isSafeInteger(originX) || originY !== originX + 4 || mapSize !== originX + 8) return [];
      const cameraFields = { x: Number(x.captures.coordinateField), y: Number(y.captures.coordinateField),
        scale: Number(scale.captures.scaleField), viewWidth: Number(scale.captures.widthField), viewHeight: Number(scale.captures.heightField) };
      if (!validFields(cameraFields)) return [];
      return [{ function: fn.name, instruction: scale.start, cameraLocal: scale.captures.camera,
        originX, originY, mapSize, scaleMode: 'viewport-division',
        cameraFields }];
    }));
  }));
}

function validFields(fields) {
  const values = Object.values(fields);
  return values.every((value, index) => Number.isSafeInteger(value) && value >= 0 && value <= 0xfffffff0
    && values.slice(0, index).every(previous => Math.abs(previous - value) >= 4));
}

/** Resolve the heap camera through a constructor and constant owner call sites.
 * This deliberately recognizes only this traced constructor shape. It never
 * treats a malloc result as a permanent absolute camera address.
 */
export function findCameraPointerCandidates(functions, coordinate) {
  const render = functions.find((fn) => fn.name === coordinate.function);
  if (!render) return [];
  const enclosing = findInstructionSequences(render.instructions, [
    { op: 'local.get', operands: [coordinate.cameraLocal] },
    { op: 'i32.const', operands: ['$capture:offset'] },
    { op: 'i32.sub' },
    { op: 'i32.load', operands: [] }
  ]);
  const candidates = [];
  for (const match of enclosing) {
    const cameraOffset = Number(match.captures.offset);
    if (!Number.isSafeInteger(cameraOffset) || cameraOffset < 32 || cameraOffset % 4) continue;
    for (const constructor of functions) {
      const parameters = [...constructor.text.split('\n')[0].matchAll(/\(param (\$[^\s()]+) i32\)/g)];
      if (parameters.length !== 1 || /\(param [^)]*\b(?:f32|f64|i64)\b/.test(constructor.text.split('\n')[0])) continue;
      const owner = parameters[0][1];
      const vtables = findInstructionSequences(constructor.instructions, [
        { op: 'local.get', operands: ['$capture:allocation'] },
        { op: 'i32.const', operands: [String(cameraOffset)] },
        { op: 'i32.add' },
        { op: 'i32.const', operands: ['$capture:vtable'] },
        { op: 'i32.store', operands: [] }
      ]);
      for (const vtable of vtables) {
        const allocations = findInstructionSequences(constructor.instructions.slice(0, vtable.start), [
          { op: 'i32.const', operands: ['$capture:bytes'] },
          { op: 'call', operands: ['*'] },
          { op: 'local.tee', operands: [vtable.captures.allocation] },
          { op: 'local.get', operands: [owner] },
          { op: 'i32.store', operands: [] }
        ]);
        if (allocations.length !== 1) continue;
        const allocationBytes = Number(allocations[0].captures.bytes);
        const cameraVtable = Number(vtable.captures.vtable);
        if (!Number.isSafeInteger(allocationBytes) || allocationBytes < cameraOffset + Math.max(...Object.values(coordinate.cameraFields)) + 4
          || !Number.isSafeInteger(cameraVtable) || cameraVtable <= 0) continue;
        const pointerStores = findInstructionSequences(constructor.instructions.slice(vtable.end), [
          { op: 'local.get', operands: [owner] },
          { op: 'local.get', operands: [vtable.captures.allocation] },
          { op: 'i32.store', operands: ['$capture:field'] }
        ]);
        for (const store of pointerStores) {
          if (!/^offset=\d+$/.test(store.captures.field)) continue;
          const flow = constructor.instructions.slice(allocations[0].end, vtable.end + store.start);
          if (flow.some(({ op, operands }) => ['local.set', 'local.tee'].includes(op)
            && [owner, vtable.captures.allocation].includes(operands[0]))) continue;
          const field = Number(store.captures.field.slice(7));
          for (const caller of functions) {
            for (const call of findInstructionSequences(caller.instructions, [
              { op: 'i32.const', operands: ['$capture:ownerAddress'] },
              { op: 'call', operands: [constructor.name] }
            ])) {
              const ownerAddress = Number(call.captures.ownerAddress);
              if (!Number.isSafeInteger(ownerAddress) || ownerAddress <= 0 || ownerAddress % 4) continue;
              const pointerAddress = ownerAddress + field;
              const existing = candidates.find((entry) => entry.pointerAddress === pointerAddress
                && entry.cameraOffset === cameraOffset && entry.cameraVtable === cameraVtable);
              if (existing) {
                if (!existing.callers.includes(caller.name)) existing.callers.push(caller.name);
              } else candidates.push({ pointerAddress, cameraOffset, cameraVtable, allocationBytes,
                constructor: constructor.name, callers: [caller.name] });
            }
          }
        }
      }
    }
  }
  return candidates;
}

/** Archived compiler shape: constructor receives the static owner address and
 * writes the camera vtable directly into that owner's subobject. */
export function findStaticCameraCandidates(functions, coordinate) {
  const render = functions.find(fn => fn.name === coordinate.function);
  if (!render) return [];
  const prefix = [
    { op: 'local.get', operands: [coordinate.cameraLocal] },
    { op: 'i32.const', operands: ['$capture:offset'] },
    { op: 'i32.sub' },
  ];
  const enclosing = [
    ...findInstructionSequences(render.instructions, [...prefix, { op: 'i32.load', memoryOffset: 0 }]),
    ...findInstructionSequences(render.instructions, [...prefix,
      { op: 'local.tee', operands: ['$capture:owner'] }, { op: 'i32.load8_u', memoryOffset: 0 },
      { op: 'i32.eqz' }, { op: 'br_if' },
    ]),
  ];
  const candidates = [];
  for (const match of enclosing) {
    const subobjectOffset = Number(match.captures.offset);
    if (!Number.isSafeInteger(subobjectOffset) || subobjectOffset < 32 || subobjectOffset % 4) continue;
    for (const constructor of functions) {
      const parameters = [...constructor.text.split('\n')[0].matchAll(/\(param (\$[^\s()]+) i32\)/g)];
      if (parameters.length !== 1 || /\(param [^)]*\b(?:f32|f64|i64)\b/.test(constructor.text.split('\n')[0])) continue;
      const owner = parameters[0][1];
      for (const initialization of findInstructionSequences(constructor.instructions, [
        { op: 'local.get', operands: [owner] }, { op: 'i32.const', operands: [String(subobjectOffset)] },
        { op: 'i32.add' }, { op: 'i32.const', operands: ['$capture:vtable'] }, { op: 'i32.store', memoryOffset: 0 },
      ])) {
        const vtable = Number(initialization.captures.vtable);
        if (!Number.isSafeInteger(vtable) || vtable <= 0 || constructor.instructions.slice(0, initialization.start)
          .some(ins => ['local.set', 'local.tee'].includes(ins.op) && ins.operands[0] === owner)) continue;
        for (const caller of functions) for (const call of findInstructionSequences(caller.instructions, [
          { op: 'i32.const', operands: ['$capture:ownerAddress'] }, { op: 'call', operands: [constructor.name] },
        ])) {
          const ownerAddress = Number(call.captures.ownerAddress), cameraOffset = ownerAddress + subobjectOffset;
          if (!Number.isSafeInteger(ownerAddress) || ownerAddress <= 0 || ownerAddress % 4 || cameraOffset > 0xfffffffc) continue;
          const previous = candidates.find(item => item.cameraOffset === cameraOffset && item.cameraVtable === vtable);
          if (previous) {
            if (!previous.callers.includes(caller.name)) previous.callers.push(caller.name);
          } else candidates.push({ cameraOffset, subobjectOffset, cameraVtable: vtable, ownerAddress,
            constructor: constructor.name, callers: [caller.name] });
        }
      }
    }
  }
  return candidates;
}
