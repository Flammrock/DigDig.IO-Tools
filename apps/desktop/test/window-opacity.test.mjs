import assert from 'node:assert/strict';
import test from 'node:test';
import { WindowOpacityController } from '../src/window-opacity.ts';

test('rapid previews coalesce and the final value waits for older native updates', async () => {
  const calls = [];
  const pending = [];
  const controller = new WindowOpacityController(value => {
    calls.push(value);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  });
  const first = controller.set(0.9);
  const middle = controller.set(0.7);
  const final = controller.set(0.2);
  assert.deepEqual(calls, [0.9]);
  pending.shift().resolve();
  await first;
  assert.deepEqual(calls, [0.9, 0.2]);
  let finalApplied = false;
  void final.then(() => { finalApplied = true; });
  await Promise.resolve();
  assert.equal(finalApplied, false);
  pending.shift().resolve();
  await Promise.all([middle, final]);
  assert.equal(finalApplied, true);
});

test('a failed native preview does not block restoring the saved opacity', async () => {
  const calls = [];
  let rejectPreview;
  const controller = new WindowOpacityController(value => {
    calls.push(value);
    return value === 0.2 ? new Promise((_, reject) => { rejectPreview = reject; }) : Promise.resolve();
  });
  const preview = controller.set(0.2);
  const failure = assert.rejects(preview, /native error/);
  const restored = controller.set(1);
  rejectPreview(new Error('native error'));
  await Promise.all([failure, restored]);
  await controller.set(0.6);
  assert.deepEqual(calls, [0.2, 1, 0.6]);
});
