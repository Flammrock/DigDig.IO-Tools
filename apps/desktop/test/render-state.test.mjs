import assert from 'node:assert/strict';
import test from 'node:test';
import { sameMapAppearance } from '../src/render-state.ts';

const frame = {
  version: 1, source: 'game', status: 'live', capturedAt: 'first', message: 'Ready',
  buildHash: null, terrainMode: 'materials-v1', tiles: [],
  world: {centerX: 5, centerY: 6, radius: 20000},
  camera: {x: 100, y: 200, scale: 0.2, width: 1200, height: 800},
  player: {x: 100, y: 200, normalizedX: 0.01, normalizedY: 0.02},
};

test('timestamps, connection state and equivalent preview clones do not repaint stationary terrain', () => {
  assert.equal(sameMapAppearance(frame, {...structuredClone(frame), capturedAt: 'later', status: 'waiting', message: 'Waiting'}), true);
  assert.equal(sameMapAppearance(undefined, undefined), true);
  assert.equal(sameMapAppearance(frame, undefined), false);
  assert.equal(sameMapAppearance(undefined, frame), false);
});

test('every visible coordinate, viewport, bounds and terrain style change repaints', () => {
  for (const [section, fields] of [
    ['world', ['centerX', 'centerY', 'radius']],
    ['camera', ['x', 'y', 'scale', 'width', 'height']],
    ['player', ['x', 'y']],
  ]) {
    for (const field of fields) {
      const next = structuredClone(frame);
      next[section][field] += 1;
      assert.equal(sameMapAppearance(frame, next), false, `${section}.${field}`);
    }
    const hidden = structuredClone(frame);
    delete hidden[section];
    assert.equal(sameMapAppearance(frame, hidden), false, `missing ${section}`);
    assert.equal(sameMapAppearance(hidden, frame), false, `restored ${section}`);
  }
  assert.equal(sameMapAppearance(frame, {...frame, terrainMode: undefined}), false);
  assert.equal(sameMapAppearance(frame, {...frame, source: 'fixture'}), false);
});
