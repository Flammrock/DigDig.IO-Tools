import wabtFactory from 'wabt';
import { readFunctions, findInstructionSequences } from '../../../tools/wasm-analysis/src/instructions.mjs';
import { findCameraPointerCandidates, findCoordinateCandidates, findStaticCameraCandidates } from '../../../tools/wasm-analysis/src/patterns.mjs';
import { readModuleData } from './binary-data.mjs';
import { findTerrainCandidates } from './terrain-patterns.mjs';

export const RESOLVER_VERSION = 'wasm-patterns-1';
export const MAX_WASM_BYTES = 8 * 1024 * 1024;
let decoder;
const unsupported = (message, evidence = {}) => ({ status: 'unsupported', message, evidence });

function rendererUsesCamera(render, camera, fields) {
  // Join independent renderer and coordinate evidence through the same camera
  // subobject displacement and field accesses, not just module-wide constants.
  const bases = findInstructionSequences(render.instructions, [
    { op: 'local.get', operands: ['$capture:owner'] },
    { op: 'i32.const', operands: [String(camera.subobjectOffset ?? camera.cameraOffset)] },
    { op: 'i32.add' }, { op: 'local.tee', operands: ['$capture:camera'] },
  ]);
  return bases.some(base => {
    const local = base.captures.camera;
    const remaining = render.instructions.slice(base.end);
    const reassigned = remaining.findIndex(ins => ['local.set', 'local.tee'].includes(ins.op) && ins.operands[0] === local);
    const reads = reassigned < 0 ? remaining : remaining.slice(0, reassigned);
    const dimensions = findInstructionSequences(reads.slice(0, 150), [
      { op: 'local.get', operands: [local] }, { op: 'local.get', operands: ['$capture:viewport'] },
      { op: 'i32.load', memoryOffset: '$capture:width' }, { op: 'i32.store', memoryOffset: fields.viewWidth },
      { op: 'local.get', operands: [local] }, { op: 'local.get', operands: ['$capture:viewport'] },
      { op: 'i32.load', memoryOffset: '$capture:height' }, { op: 'i32.store', memoryOffset: fields.viewHeight },
    ]).filter(match => match.captures.width !== match.captures.height);
    return dimensions.length > 0 && findInstructionSequences(reads, [
      { op: 'local.get', operands: [local] }, { op: 'f32.load', memoryOffset: fields.scale },
    ]).length > 0;
  });
}

/** Read-only decoded-instruction resolution. Run this in a worker with a time
 * budget: parsing is bounded by bytes/text/instruction counts, not a UI loop.
 * The WABT runtime executes its own decoder; the supplied game is never run.
 */
export async function resolveWasm(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 8 || input.byteLength > MAX_WASM_BYTES) {
    return unsupported('WASM analysis requires a binary between 8 bytes and 8 MiB.');
  }
  let module;
  try {
    const bytes = new Uint8Array(input);
    const metadata = readModuleData(bytes);
    decoder ??= wabtFactory();
    const wabt = await decoder;
    module = wabt.readWasm(bytes, { readDebugNames: false });
    module.validate();
    module.generateNames();
    module.applyNames();
    const wat = module.toText({ foldExprs: false, inlineExport: false });
    module.destroy();
    module = undefined;
    if (wat.length > 80 * 1024 * 1024) return unsupported('Decoded WASM exceeds the analysis limit.');
    if (/^  \(import\b[^\n]*\(memory\b/m.test(wat)) return unsupported('Imported or multiple-memory layouts need a supported memory resolver.');
    const functions = readFunctions(wat);
    if (functions.length > 20000 || functions.reduce((sum, fn) => sum + fn.instructions.length, 0) > 2000000) {
      return unsupported('WASM function/instruction count exceeds the analysis limit.');
    }
    const coordinates = findCoordinateCandidates(functions);
    const evidence = { resolverVersion: RESOLVER_VERSION, definedFunctions: functions.length,
      coordinateCandidates: coordinates.length, cameraCandidates: 0, terrainCandidates: 0, layoutCandidates: 0 };
    if (!coordinates.length || coordinates.length > 16) return unsupported('No unique supported coordinate calculation was found.', evidence);
    const resolvedCoordinates = coordinates.map(coordinate => ({ coordinate,
      cameras: [...findCameraPointerCandidates(functions, coordinate), ...findStaticCameraCandidates(functions, coordinate)] }));
    evidence.cameraCandidates = resolvedCoordinates.reduce((sum, item) => sum + item.cameras.length, 0);
    if (evidence.cameraCandidates > 16) return unsupported('Camera ownership is ambiguous.', evidence);
    const terrains = findTerrainCandidates(functions, metadata.data);
    evidence.terrainCandidates = terrains.length;
    if (!terrains.length || terrains.length > 16) return unsupported('Terrain geometry and material-palette evidence is missing or ambiguous.', evidence);
    const layouts = new Map();
    for (const { coordinate, cameras } of resolvedCoordinates) {
      for (const camera of cameras) for (const terrain of terrains) {
        const render = functions.find(fn => fn.name === terrain.renderFunction);
        if (!rendererUsesCamera(render, camera, coordinate.cameraFields)) continue;
        const fields = coordinate.cameraFields;
        const layout = {
          memoryExport: metadata.memoryExport,
          mapX: coordinate.originX, mapY: coordinate.originY, mapRadius: coordinate.mapSize,
          ...(camera.pointerAddress === undefined ? {} : { cameraPointer: camera.pointerAddress }),
          cameraOffset: camera.cameraOffset, cameraVtable: camera.cameraVtable,
          cameraX: fields.x, cameraY: fields.y, cameraScale: fields.scale, viewWidth: fields.viewWidth, viewHeight: fields.viewHeight,
          scaleMode: coordinate.scaleMode === 'viewport-division' ? 'divide-f32' : 'legacy-reciprocal', terrain: terrain.terrain,
        };
        if (![layout.mapX, layout.mapY, layout.mapRadius, ...(layout.cameraPointer === undefined ? [] : [layout.cameraPointer]), layout.cameraOffset, layout.cameraVtable]
          .every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0xfffffffc)) continue;
        layouts.set(JSON.stringify(layout), { layout, coordinate, camera, terrain });
      }
    }
    evidence.layoutCandidates = layouts.size;
    if (layouts.size !== 1) return unsupported(layouts.size ? 'Several complete layouts remain plausible.' : 'Camera ownership and renderer evidence could not be joined.', evidence);
    const match = layouts.values().next().value;
    return { status: 'candidate', layout: match.layout, evidence: { ...evidence,
      coordinateFunction: match.coordinate.function, cameraConstructor: match.camera.constructor,
      rendererFunction: match.terrain.renderFunction, materialFunction: match.terrain.materialFunction,
      paletteAddress: match.terrain.paletteAddress,
      validationRequired: 'Live memory, viewport, geometry, and material observations must agree before capture or caching.' } };
  } catch (error) {
    return unsupported(`WASM decoding or pattern analysis failed: ${String(error?.message ?? error).slice(0, 350)}`);
  } finally { module?.destroy(); }
}
