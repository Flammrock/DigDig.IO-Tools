import type { MapFrame } from './telemetry.ts';

/** Only pixel-affecting fields invalidate the canvas; timestamps/status do not. */
export function sameMapAppearance(left: MapFrame | undefined, right: MapFrame | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.source !== right.source || left.terrainMode !== right.terrainMode) return false;
  const a = left.world, b = right.world;
  if (Boolean(a) !== Boolean(b) || a?.centerX !== b?.centerX || a?.centerY !== b?.centerY || a?.radius !== b?.radius) return false;
  const c = left.camera, d = right.camera;
  if (Boolean(c) !== Boolean(d) || c?.x !== d?.x || c?.y !== d?.y || c?.scale !== d?.scale
    || c?.width !== d?.width || c?.height !== d?.height) return false;
  const p = left.player, q = right.player;
  return Boolean(p) === Boolean(q) && p?.x === q?.x && p?.y === q?.y;
}
