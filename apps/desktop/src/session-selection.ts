import type { TelemetryClient } from './telemetry.ts';

export function chooseSession(clients: TelemetryClient[], selected: string, autoReconnect: boolean): string {
  const current = clients.find(client => client.clientId === selected);
  const freshGame = clients.filter(client => client.frame.source === 'game' && !client.mapOnly
    && client.frame.status === 'live' && !client.stale)
    .sort((a, b) => (b.firstSeen ?? b.lastSeen) - (a.firstSeen ?? a.lastSeen) || b.lastSeen - a.lastSeen)[0];
  if (current) {
    if (autoReconnect && current.frame.source === 'game' && (current.stale || current.mapOnly) && freshGame) {
      return freshGame.clientId;
    }
    return selected;
  }
  return (freshGame ?? clients.find(client => client.mapOnly)
    ?? clients.find(client => client.frame.status === 'live' && !client.stale)
    ?? clients.find(client => !client.stale) ?? clients[0])?.clientId ?? '';
}

/** Shared terrain metadata is a fallback; a fresh tab owns its live boundary and pose. */
export function withMapMetadata(client: TelemetryClient): TelemetryClient {
  return client.mapFrame ? { ...client, frame: { ...client.frame, ...client.mapFrame,
    ...(!client.stale && !client.mapOnly && client.frame.status === 'live' && client.frame.world
      ? { world: client.frame.world } : {}) } } : client;
}
