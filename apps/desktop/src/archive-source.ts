import type { ChunksDocument } from '@digdig/terrain';
import type { TelemetryClient } from './telemetry.ts';

/** Preview terrain stays separate; compatible live bounds and coordinates are overlaid. */
export function archiveClient(document: ChunksDocument, clientId: string): TelemetryClient {
  return {
    clientId, lastSeen: Date.parse(document.savedAt), stale: false,
    frame: {
      version: 1, source: 'game', status: 'waiting', capturedAt: document.savedAt,
      buildHash: document.source.buildHash,
      message: 'Previewing saved terrain. Live coordinates appear when a matching session is available.',
      ...(document.source.terrainMode ? { terrainMode: document.source.terrainMode } : {}),
      ...(document.source.world ? { world: { ...document.source.world } } : {}),
      tiles: [],
    },
    tiles: document.tiles.map(tile => ({ ...tile })),
    markers: (document.markers ?? []).map(marker => ({ ...marker })),
  };
}

export function compatiblePreview(document: ChunksDocument, live: TelemetryClient): boolean {
  const source = document.source;
  const frame = live.frame;
  if (source.buildHash !== frame.buildHash || source.terrainMode !== frame.terrainMode) return false;
  if (!source.world || !frame.world) return false;
  return source.world.centerX === frame.world.centerX && source.world.centerY === frame.world.centerY;
}

export function previewWithLivePosition(preview: TelemetryClient, document: ChunksDocument,
  live: TelemetryClient | undefined, now = Date.now()): TelemetryClient {
  if (!live || live.stale || now - live.lastSeen > 5000 || live.frame.status !== 'live' || !compatiblePreview(document, live)) return preview;
  return {
    ...preview, lastSeen: live.lastSeen,
    frame: {
      ...preview.frame,
      message: 'Preview terrain stays fixed. Map boundary, player and camera follow the linked live session.',
      capturedAt: live.frame.capturedAt,
      ...(live.frame.world ? { world: { ...live.frame.world } } : {}),
      ...(live.frame.player ? { player: { ...live.frame.player } } : {}),
      ...(live.frame.camera ? { camera: { ...live.frame.camera } } : {}),
    },
  };
}
