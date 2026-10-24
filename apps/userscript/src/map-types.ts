export interface MapTile {
  key: string;
  x: number; y: number; width: number; height: number;
  pixelWidth: number; pixelHeight: number;
  rgba: string;
}
export interface MapState {
  world: { centerX: number; centerY: number; radius: number };
  player: { x: number; y: number; normalizedX: number; normalizedY: number };
  camera: { x: number; y: number; scale: number; width: number; height: number };
}
export interface MapFrame extends Partial<MapState> {
  version: 1;
  appVersion?: string;
  source: 'game' | 'fixture';
  status: 'waiting' | 'unsupported' | 'live' | 'error';
  message: string;
  buildHash: string | null;
  capturedAt: string;
  terrainMode?: 'materials-v1';
  tiles: MapTile[];
}
export interface MemoryLayout {
  sha256: string;
  memoryExport: string;
  mapX: number; mapY: number; mapRadius: number;
  cameraPointer?: number;
  cameraOffset: number;
  cameraVtable?: number;
  cameraX: number; cameraY: number; cameraScale: number;
  viewWidth: number; viewHeight: number;
  scaleMode: 'divide-f32' | 'legacy-reciprocal';
  terrain?: TerrainProfile;
}

export interface TerrainProfile {
  sourceWidth: number; sourceHeight: number;
  worldGridSpacing: number; worldDrawSize: number; worldDrawInset: number;
  paletteProfile: 'materials-v1';
}
