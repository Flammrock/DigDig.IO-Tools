import type { MapState, MemoryLayout } from './map-types.ts';

/** Fresh buffer per read, no writes. Layout must have been matched to the captured binary hash. */
export function readMapState(memory: WebAssembly.Memory, layout: MemoryLayout): MapState {
  const view = new DataView(memory.buffer);
  let base = layout.cameraOffset;
  if (layout.cameraPointer !== undefined) {
    if (!Number.isSafeInteger(layout.cameraPointer) || layout.cameraPointer < 0 || layout.cameraPointer + 4 > view.byteLength) {
      throw new Error('Camera pointer location is outside memory');
    }
    const pointer = view.getUint32(layout.cameraPointer, true);
    if (!pointer || pointer % 4 !== 0) throw new Error('Camera object is not initialized');
    base += pointer;
  }
  const offsets = [layout.mapX, layout.mapY, layout.mapRadius, base + layout.cameraX,
    base + layout.cameraY, base + layout.cameraScale, base + layout.viewWidth, base + layout.viewHeight];
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset < 0 || offset + 4 > view.byteLength)) {
    throw new Error('Resolved memory layout is outside the current buffer');
  }
  if (layout.cameraVtable !== undefined && view.getUint32(base, true) !== layout.cameraVtable) {
    throw new Error('Camera object does not match the resolved game layout');
  }
  const centerX = view.getFloat32(layout.mapX, true);
  const centerY = view.getFloat32(layout.mapY, true);
  // The renderer eases this live value toward the server's changing map size.
  // It is neither a constant nor an envelope of all previously scanned terrain.
  const radius = view.getFloat32(layout.mapRadius, true);
  const x = view.getFloat32(base + layout.cameraX, true);
  const y = view.getFloat32(base + layout.cameraY, true);
  const internalScale = view.getFloat32(base + layout.cameraScale, true);
  const width = view.getInt32(base + layout.viewWidth, true);
  const height = view.getInt32(base + layout.viewHeight, true);
  // Match the operation order and f32 rounding of the resolved build.
  const scale = layout.scaleMode === 'divide-f32'
    ? Math.fround(internalScale * Math.max(Math.fround(height / 1080), Math.fround(width / 1920)))
    : Math.max(width * 0.00052083336, height * 0.00092592591) * internalScale;
  if (![centerX, centerY, radius, x, y, scale].every(Number.isFinite)
    || radius <= 0 || radius > 1e7 || scale <= 0 || scale > 1e5
    || width < 1 || height < 1 || width > 32768 || height > 32768
    || Math.abs(x - centerX) > radius * 4 || Math.abs(y - centerY) > radius * 4) {
    throw new Error('Map/camera data is not ready or failed plausibility checks');
  }
  return {
    world: { centerX, centerY, radius },
    player: { x, y, normalizedX: (x - centerX) / radius, normalizedY: (y - centerY) / radius },
    camera: { x, y, scale, width, height }
  };
}

/** Invert the game's camera transform; no historical grid-origin adjustment. */
export function locateTerrainTile(state: MapState, transform: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>,
  destination = { x: 0, y: 0, width: 1, height: 1 }) {
  const { camera } = state;
  if (![transform.a, transform.b, transform.c, transform.d, transform.e, transform.f].every(Number.isFinite)
    || Math.abs(transform.b) > 1e-5 || Math.abs(transform.c) > 1e-5 || transform.a <= 0 || transform.d <= 0) return null;
  if (![destination.x, destination.y, destination.width, destination.height].every(Number.isFinite)) return null;
  const width = transform.a * destination.width / camera.scale;
  const height = transform.d * destination.height / camera.scale;
  if (width < 1 || height < 1 || width > state.world.radius * 2 || height > state.world.radius * 2) return null;
  const x = (transform.a * destination.x + transform.e - camera.width / 2) / camera.scale + camera.x;
  const y = (transform.d * destination.y + transform.f - camera.height / 2) / camera.scale + camera.y;
  // Quantize sub-pixel float jitter in stable world coordinates, not a guessed grid size.
  const round = (value: number) => Math.round(value * 10) / 10;
  return { key: `${round(x)},${round(y)},${round(width)},${round(height)}`, x, y, width, height };
}
