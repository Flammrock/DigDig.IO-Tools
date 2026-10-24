export interface Tile {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  rgba: string;
  observedPixels?: number;
}

export interface MapFrame {
  version: 1;
  appVersion?: string;
  source: 'game' | 'fixture';
  status: 'waiting' | 'unsupported' | 'live' | 'error';
  message: string;
  buildHash: string | null;
  capturedAt: string;
  terrainMode?: 'materials-v1';
  world?: { centerX: number; centerY: number; radius: number };
  player?: { x: number; y: number; normalizedX: number; normalizedY: number };
  camera?: { x: number; y: number; scale: number; width: number; height: number };
  tiles: Tile[];
}

export interface TelemetryClient {
  clientId: string;
  firstSeen?: number;
  mapId?: string;
  mapData?: boolean;
  mapOnly?: boolean;
  mapFrame?: Pick<MapFrame, 'buildHash' | 'terrainMode' | 'world'>;
  lastSeen: number;
  stale: boolean;
  frame: MapFrame;
  tiles: Tile[];
  markers?: MapMarker[];
  tileKeys?: string[];
  resetTiles?: boolean;
}

export interface Telemetry {
  serverId: string;
  revision?: number;
  reset?: boolean;
  clients: TelemetryClient[];
}
import type { MapMarker } from '@digdig/terrain';

