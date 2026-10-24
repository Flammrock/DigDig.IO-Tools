import type { Telemetry, TelemetryClient, Tile } from './telemetry.ts';
import type { MapMarker } from '@digdig/terrain';

interface CachedMap {
  tiles: Map<string, Tile>;
  tileList: Tile[];
  tileKeys: string[];
  authoritativeKeys?: string[];
  dirty: boolean;
  markers: MapMarker[];
  frame?: TelemetryClient['mapFrame'];
}

function sameMarkers(left: MapMarker[], right: MapMarker[]): boolean {
  return left.length === right.length && left.every((marker, index) => {
    const other = right[index]!;
    return marker.id === other.id && marker.x === other.x && marker.y === other.y && marker.label === other.label;
  });
}

/** Reconstruct complete client maps from bounded incremental bridge responses. */
export class TelemetryCache {
  #serverId = '';
  #revision: number | undefined;
  #maps = new Map<string, CachedMap>();
  #snapshot: Telemetry = { serverId: '', clients: [] };

  cursor(): { since?: number; serverId?: string } {
    return this.#revision === undefined ? {} : { since: this.#revision, serverId: this.#serverId };
  }

  invalidate() { this.#revision = undefined; }

  #mapId(clientId: string) {
    const client = this.#snapshot.clients.find(item => item.clientId === clientId);
    return client?.mapId ?? clientId;
  }

  #refreshMap(mapId: string): Telemetry {
    const map = this.#maps.get(mapId);
    if (!map) return this.#snapshot;
    this.#materialize(map);
    this.#snapshot = { ...this.#snapshot, clients: this.#snapshot.clients.map(client => (client.mapId ?? client.clientId) === mapId
      ? { ...client, tiles: map.tileList, tileKeys: map.tileKeys, markers: map.markers } : client) };
    return this.#snapshot;
  }

  #materialize(map: CachedMap) {
    if (!map.dirty) return;
    map.tileList = [...map.tiles.values()];
    map.tileKeys = [...map.tiles.keys()];
    map.dirty = false;
  }

  upsertMarker(clientId: string, marker: MapMarker): Telemetry {
    this.invalidate();
    const id = this.#mapId(clientId), map = this.#maps.get(id);
    if (map) map.markers = [...map.markers.filter(item => item.id !== marker.id), marker];
    return this.#refreshMap(id);
  }

  deleteItems(clientId: string, tileKeys: string[], markerIds: string[]): Telemetry {
    const removedTiles = new Set(tileKeys), removedMarkers = new Set(markerIds);
    const id = this.#mapId(clientId), map = this.#maps.get(id);
    for (const key of removedTiles) if (map?.tiles.delete(key)) map.dirty = true;
    if (map) map.markers = map.markers.filter(marker => !removedMarkers.has(marker.id));
    this.invalidate();
    return this.#refreshMap(id);
  }

  apply(incoming: Telemetry): Telemetry {
    if (!incoming || typeof incoming.serverId !== 'string' || !Array.isArray(incoming.clients)) {
      throw new Error('Unexpected telemetry response.');
    }
    const full = incoming.reset === true || incoming.serverId !== this.#serverId || incoming.revision === undefined;
    if (!full && this.#revision !== undefined && incoming.revision! < this.#revision) return this.#snapshot;
    if (full) this.#maps.clear();
    const ids = new Set<string>();
    // Only one session carries shared pixels in each response. Process carriers
    // first so client order cannot leave another tab with an empty map.
    for (const client of incoming.clients) {
      const id = client.mapId ?? client.clientId;
      ids.add(id);
      if (client.mapData === false) continue;
      let map = this.#maps.get(id);
      if (!map) {
        map = { tiles: new Map(), tileList: [], tileKeys: [], dirty: false, markers: [] };
        this.#maps.set(id, map);
      }
      if (client.resetTiles) { map.tiles.clear(); map.dirty = true; delete map.authoritativeKeys; }
      for (const tile of client.tiles) { map.tiles.set(tile.key, tile); map.dirty = true; }
      const keys = client.tileKeys ?? client.tiles.map(tile => tile.key);
      if (!map.authoritativeKeys || keys.length !== map.authoritativeKeys.length
        || keys.some((key, index) => key !== map.authoritativeKeys![index]) || client.tiles.length > 0) {
        const retained = new Set(keys);
        for (const key of map.tiles.keys()) if (!retained.has(key)) { map.tiles.delete(key); map.dirty = true; }
        map.authoritativeKeys = keys;
      }
      const markers = client.markers ?? [];
      if (!sameMarkers(map.markers, markers)) map.markers = markers;
      if (client.mapFrame) map.frame = client.mapFrame;
      this.#materialize(map);
    }
    const clients: TelemetryClient[] = incoming.clients.map(client => {
      const map = this.#maps.get(client.mapId ?? client.clientId);
      if (!map) throw new Error('Shared map data is missing from the bridge response.');
      return { ...client, tiles: map.tileList, tileKeys: map.tileKeys, markers: map.markers,
        ...(map.frame ? { mapFrame: map.frame } : {}) };
    });
    for (const id of this.#maps.keys()) if (!ids.has(id)) this.#maps.delete(id);
    this.#serverId = incoming.serverId;
    this.#revision = incoming.revision;
    this.#snapshot = {
      serverId: incoming.serverId,
      ...(incoming.revision === undefined ? {} : { revision: incoming.revision }),
      clients,
    };
    return this.#snapshot;
  }

  clearTiles(clientId: string): Telemetry {
    const id = this.#mapId(clientId);
    const map = this.#maps.get(id);
    if (map) { map.tiles.clear(); map.dirty = true; delete map.authoritativeKeys; }
    this.#revision = undefined; // Request a complete authoritative state after the clear.
    return this.#refreshMap(id);
  }
}
