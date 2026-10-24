import type { MemoryLayout, TerrainProfile } from './map-types.ts';

export const currentTerrainProfile: Readonly<TerrainProfile> = {
  sourceWidth: 64, sourceHeight: 64, worldGridSpacing: 1024,
  worldDrawSize: 1026, worldDrawInset: -1, paletteProfile: 'materials-v1'
};

// Only add manifests produced by read-only analysis for an exact game binary hash.
// Historical offsets are deliberately not fallback candidates.
export const gameLayouts: readonly MemoryLayout[] = [{
  // reports/current-game-layout.json: unique decoded map-circle and camera-owner patterns.
  // Also checked against live values; owner confirmed terrain alignment on 2026-10-24.
  // These renderer camera coordinates can differ from the exact local-player position.
  sha256: '8ff0e9d2bc58c6f9c52ef4fe2ee99173aa577bd51dc264cbef0b02e1f298f58d',
  memoryExport: 'Mf',
  mapX: 1509292, mapY: 1509296, mapRadius: 1509300,
  cameraPointer: 332320, cameraOffset: 185632, cameraVtable: 54080,
  cameraX: 8, cameraY: 12, cameraScale: 16, viewWidth: 20, viewHeight: 24,
  scaleMode: 'divide-f32', terrain: currentTerrainProfile
}];
