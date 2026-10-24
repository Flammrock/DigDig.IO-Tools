export interface Point { x: number; y: number }
export interface Viewport extends Point { scale: number }
export interface Size { width: number; height: number }
export const MIN_VIEW_SCALE = 1e-8;
interface Rectangle extends Point { width: number; height: number }

export function worldToScreen(point: Point, view: Viewport, size: Size): Point {
  return { x: (point.x - view.x) * view.scale + size.width / 2, y: (point.y - view.y) * view.scale + size.height / 2 };
}

export function screenToWorld(point: Point, view: Viewport, size: Size): Point {
  return { x: (point.x - size.width / 2) / view.scale + view.x, y: (point.y - size.height / 2) / view.scale + view.y };
}

export function zoomAt(view: Viewport, screen: Point, factor: number, size: Size): Viewport {
  const anchor = screenToWorld(screen, view, size);
  const scale = Math.max(MIN_VIEW_SCALE, Math.min(20, view.scale * factor));
  return { x: anchor.x - (screen.x - size.width / 2) / scale, y: anchor.y - (screen.y - size.height / 2) / scale, scale };
}

export function fitWorld(center: Point, radius: number, size: Size): Viewport {
  return fitBounds({ x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 }, size);
}

function fitBounds(bounds: Rectangle, size: Size): Viewport {
  const scale = Math.max(MIN_VIEW_SCALE, Math.min(20,
    Math.max(1, size.width - 100) / bounds.width, Math.max(1, size.height - 100) / bounds.height));
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, scale };
}

/** The current boundary can shrink while older discoveries remain outside it. */
export function fitMap(world: { centerX: number; centerY: number; radius: number } | undefined,
  tiles: readonly Rectangle[], size: Size): Viewport | undefined {
  if (!world && !tiles.length) return;
  let left = world ? world.centerX - world.radius : Infinity;
  let top = world ? world.centerY - world.radius : Infinity;
  let right = world ? world.centerX + world.radius : -Infinity;
  let bottom = world ? world.centerY + world.radius : -Infinity;
  for (const tile of tiles) {
    left = Math.min(left, tile.x); top = Math.min(top, tile.y);
    right = Math.max(right, tile.x + tile.width); bottom = Math.max(bottom, tile.y + tile.height);
  }
  return fitBounds({ x: left, y: top, width: right - left, height: bottom - top }, size);
}
