import assert from 'node:assert/strict';
import test from 'node:test';
import { hitMap, selectMapRectangle, toggleSelection } from '../src/map-selection.ts';

const tiles = [{ key: 'left', x: -10, y: -10, width: 10, height: 10 },
  { key: 'right', x: 0, y: -10, width: 10, height: 10 },
  { key: 'far', x: 100, y: 100, width: 10, height: 10 }];
const markers = [{ id: 'inside', x: -5, y: -5, label: 'Ore' }, { id: 'far', x: 105, y: 105, label: 'Later' }];

test('point selection prioritizes markers, supports hidden markers, and assigns shared tile edges once', () => {
  const hit = hitMap({ x: -5, y: -5 }, tiles, markers, 1);
  assert.deepEqual([...hit.markerIds], ['inside']);
  assert.equal(hit.tileKeys.size, 0);
  assert.deepEqual([...hitMap({ x: -5, y: -5 }, tiles, [], 1).tileKeys], ['left']);
  assert.deepEqual([...hitMap({ x: 0, y: -5 }, tiles, [], 1).tileKeys], ['right']);
  assert.equal(hitMap({ x: 50, y: 50 }, tiles, markers, 1).tileKeys.size, 0);
});

test('reverse box selection includes intersected chunks and contained markers but excludes distant items', () => {
  const result = selectMapRectangle({ x: 5, y: 5 }, { x: -6, y: -6 }, tiles, markers);
  assert.deepEqual([...result.tileKeys], ['left', 'right']);
  assert.deepEqual([...result.markerIds], ['inside']);
  assert.equal(selectMapRectangle({ x: -20, y: -20 }, { x: -10, y: -10 }, tiles, markers).tileKeys.size, 0);
});

test('shift toggles selected chunks and markers without changing the prior selection', () => {
  const first = selectMapRectangle({ x: -10, y: -10 }, { x: 10, y: 10 }, tiles, markers);
  const result = toggleSelection(first, hitMap({ x: -5, y: -5 }, tiles, markers, 1));
  assert.equal(result.markerIds.size, 0);
  assert.equal(first.markerIds.size, 1);
  assert.equal(result.tileKeys.size, 2);
});
