import { currentTerrainProfile } from '../../src/game-layouts.ts';

/** Independently authored runtime data; no game module is executed or changed. */
export function syntheticLayout(overrides = {}) {
  return { memoryExport: 'renamedMemory', mapX: 128, mapY: 132, mapRadius: 136,
    cameraPointer: 256, cameraOffset: 128, cameraVtable: 64,
    cameraX: 8, cameraY: 12, cameraScale: 16, viewWidth: 20, viewHeight: 24,
    scaleMode: 'divide-f32', terrain: { ...currentTerrainProfile }, ...overrides };
}

export function syntheticMemory(layout = syntheticLayout(), hash = 'c'.repeat(64)) {
  const memory = new WebAssembly.Memory({ initial: 256 });
  const view = new DataView(memory.buffer), owner = 2 * 1024 * 1024;
  const camera = layout.cameraPointer === undefined ? layout.cameraOffset : owner + layout.cameraOffset;
  if (layout.cameraPointer !== undefined) view.setUint32(layout.cameraPointer, owner, true);
  if (layout.cameraVtable !== undefined) view.setUint32(camera, layout.cameraVtable, true);
  view.setFloat32(layout.mapX, 0, true); view.setFloat32(layout.mapY, 0, true); view.setFloat32(layout.mapRadius, 9000, true);
  view.setFloat32(camera + layout.cameraX, 0, true); view.setFloat32(camera + layout.cameraY, 0, true);
  view.setFloat32(camera + layout.cameraScale, 1, true);
  view.setInt32(camera + layout.viewWidth, 1920, true); view.setInt32(camera + layout.viewHeight, 1080, true);
  return { entry: { id: 1, sha256: hash, bytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    memories: [{ name: layout.memoryExport, memory }] }, memory, view, camera, layout };
}

export const transform = { a: 1, b: 0, c: 0, d: 1, e: 960, f: 540 };
export const tileRect = index => ({ x: index * 1024 - 1, y: -1, width: 1026, height: 1026 });
