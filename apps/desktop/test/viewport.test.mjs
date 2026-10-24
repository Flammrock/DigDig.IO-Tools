import test from 'node:test';
import assert from 'node:assert/strict';
import { fitMap, fitWorld, screenToWorld, worldToScreen, zoomAt } from '../src/viewport.ts';

test('map coordinates round-trip with a translated camera and non-square viewport', () => {
  const size = { width: 1234, height: 789 };
  const view = { x: -431.25, y: 8831.5, scale: 0.037 };
  const point = { x: 917.5, y: -62.75 };
  const actual = screenToWorld(worldToScreen(point, view, size), view, size);
  assert.ok(Math.abs(actual.x - point.x) < 1e-9);
  assert.ok(Math.abs(actual.y - point.y) < 1e-9);
});

test('fit includes retained chunks beyond a shrinking world without altering the boundary', () => {
  const size = { width: 400, height: 320 };
  const world = { centerX: 500, centerY: -700, radius: 1000 };
  const chunks = [{ x: -3000, y: -6000, width: 1026, height: 1026 }, { x: 7000, y: 2000, width: 1026, height: 1026 }];
  for (const radius of [1000, 6000, 200]) {
    const current = { ...world, radius };
    const view = fitMap(current, chunks, size);
    for (const point of [{ x: world.centerX - radius, y: world.centerY - radius },
      { x: world.centerX + radius, y: world.centerY + radius },
      ...chunks.flatMap(tile => [{ x: tile.x, y: tile.y }, { x: tile.x + tile.width, y: tile.y + tile.height }])]) {
      const screen = worldToScreen(point, view, size);
      assert.ok(screen.x >= 50 - 1e-6 && screen.x <= size.width - 50 + 1e-6);
      assert.ok(screen.y >= 50 - 1e-6 && screen.y <= size.height - 50 + 1e-6);
    }
    assert.equal(current.radius, radius);
  }
  assert.equal(fitMap(undefined, [], size), undefined);
});

test('large changing worlds and distant archives fit a small window without a fixed zoom-size ceiling', () => {
  const size = { width: 400, height: 320 };
  const view = fitWorld({ x: 200000, y: -300000 }, 1e7, size);
  assert.ok(view.scale < 0.005);
  const edge = worldToScreen({ x: view.x + 1e7, y: view.y + 1e7 }, view, size);
  assert.ok(edge.x <= 350 && edge.y <= 270);
  const zoomed = zoomAt(view, { x: 200, y: 160 }, 1.1, size);
  assert.ok(Math.abs(zoomed.scale / view.scale - 1.1) < 1e-9);
  const distant = fitMap(undefined, [{ x: -1e9, y: -1e9, width: 1, height: 1 },
    { x: 1e9, y: 1e9, width: 1, height: 1 }], size);
  assert.ok(distant.scale < view.scale);
});

test('scroll zoom keeps the world position underneath the cursor fixed', () => {
  const size = { width: 900, height: 600 };
  const view = { x: 1400, y: -1200, scale: 0.8 };
  const pointer = { x: 130, y: 420 };
  const before = screenToWorld(pointer, view, size);
  const after = screenToWorld(pointer, zoomAt(view, pointer, 1.4, size), size);
  assert.deepEqual(after, before);
});

test('fit map keeps all world bounds inside the viewport with a margin', () => {
  const size = { width: 900, height: 600 };
  const center = { x: 1300, y: -900 };
  const radius = 4000;
  const view = fitWorld(center, radius, size);
  const topLeft = worldToScreen({ x: center.x - radius, y: center.y - radius }, view, size);
  const bottomRight = worldToScreen({ x: center.x + radius, y: center.y + radius }, view, size);
  assert.ok(topLeft.x >= 50 && topLeft.y >= 50);
  assert.ok(bottomRight.x <= size.width - 50 && bottomRight.y <= size.height - 50);
});
