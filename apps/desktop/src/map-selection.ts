import type { MapMarker } from '@digdig/terrain';
import type { Tile } from './telemetry.ts';
import type { Point } from './viewport.ts';

export interface MapSelection { tileKeys: Set<string>; markerIds: Set<string> }
export function emptySelection(): MapSelection { return { tileKeys: new Set(), markerIds: new Set() }; }

/** Markers take precedence over the terrain beneath their screen-sized target. */
export function hitMap(point: Point, tiles: Tile[], markers: MapMarker[], markerRadius: number): MapSelection {
  const result = emptySelection();
  const marker = [...markers].reverse().find(item => Math.hypot(item.x - point.x, item.y - point.y) <= markerRadius);
  if (marker) result.markerIds.add(marker.id);
  else {
    const tile = [...tiles].reverse().find(item => point.x >= item.x && point.x < item.x + item.width
      && point.y >= item.y && point.y < item.y + item.height);
    if (tile) result.tileKeys.add(tile.key);
  }
  return result;
}

export function selectMapRectangle(start: Point, end: Point, tiles: Tile[], markers: MapMarker[]): MapSelection {
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  return {
    tileKeys: new Set(tiles.filter(tile => tile.x < right && tile.x + tile.width > left
      && tile.y < bottom && tile.y + tile.height > top).map(tile => tile.key)),
    markerIds: new Set(markers.filter(marker => marker.x >= left && marker.x <= right
      && marker.y >= top && marker.y <= bottom).map(marker => marker.id)),
  };
}

export function toggleSelection(previous: MapSelection, next: MapSelection): MapSelection {
  const result = { tileKeys: new Set(previous.tileKeys), markerIds: new Set(previous.markerIds) };
  for (const kind of ['tileKeys', 'markerIds'] as const) for (const key of next[kind]) {
    if (result[kind].has(key)) result[kind].delete(key); else result[kind].add(key);
  }
  return result;
}
