import assert from 'node:assert/strict';
import test from 'node:test';
import { materialPalette, classifyMaterial, observeMaterialPixels, observeMaterialChanges } from '../src/index.ts';

test('identifies every supported material across the current renderer brightness range', () => {
  for (const material of materialPalette) {
    for (let step = 0; step <= 100; step++) {
      const brightness = 0.95 + step / 2000;
      const rgb = material.rgb.map(channel => Math.floor(channel * brightness));
      assert.equal(classifyMaterial(...rgb)?.id, material.id, `${material.id} ${rgb}`);
    }
  }
});

test('rejects fog, empty space, transparent colors, old black, and tinted memory overlays', () => {
  for (const gray of [0, 32, 33, 34, 44, 45, 46, 47, 48, 49, 50, 51]) {
    assert.equal(classifyMaterial(gray, gray, gray), undefined, `gray ${gray}`);
  }
  for (const rgb of [[65, 47, 24], [66, 47, 24], [65, 46, 23], [255, 0, 255]]) {
    assert.equal(classifyMaterial(...rgb), undefined);
  }
  for (const alpha of [0, 1, 128, 254]) assert.equal(classifyMaterial(221, 221, 221, alpha), undefined);
  assert.equal(classifyMaterial(21, 17, 17), undefined, 'strict squared distance boundary');
});

test('normalizes positive observations without modifying source pixels or losing discoveries to fog', () => {
  const input = new Uint8ClampedArray([114, 64, 0, 255, 210, 210, 210, 255, 49, 49, 49, 255, 17, 17, 17, 128]);
  const original = input.slice();
  const output = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0, 50, 168, 160, 255, 0, 0, 0, 0]);
  assert.equal(observeMaterialPixels(input, output), 2);
  assert.deepEqual([...output], [120, 68, 0, 255, 221, 221, 221, 255, 50, 168, 160, 255, 0, 0, 0, 0]);
  assert.deepEqual(input, original);
  assert.throws(() => observeMaterialPixels(input, input), /separate/);
  assert.throws(() => observeMaterialPixels(input, output.subarray(4)), /equal/);
});

test('reports changed pixels independently of repeated positive observations', () => {
  const input = new Uint8ClampedArray([114, 64, 0, 255, 210, 210, 210, 255, 49, 49, 49, 255]);
  const original = input.slice();
  const output = new Uint8ClampedArray(input.length);
  assert.deepEqual(observeMaterialChanges(input, output), { observed: 2, changed: 2 });
  assert.deepEqual(observeMaterialChanges(input, output), { observed: 2, changed: 0 });
  input.set([50, 168, 160, 255]);
  assert.deepEqual(observeMaterialChanges(input, output), { observed: 2, changed: 1 });
  const known = output.slice();
  input.fill(0);
  assert.deepEqual(observeMaterialChanges(input, output), { observed: 0, changed: 0 });
  assert.deepEqual(output, known);
  assert.deepEqual([...original], [114, 64, 0, 255, 210, 210, 210, 255, 49, 49, 49, 255]);
});

test('cached bulk classification matches exact distances through collisions and tolerance boundaries', () => {
  const colors = [];
  // Reusing occupied cache slots must not reuse their previous color's result.
  const slots = new Map();
  let collision;
  for (const material of materialPalette) {
    const [r, g, b] = material.rgb;
    const rgb = r << 16 | g << 8 | b;
    slots.set(Math.imul(rgb, 0x9e3779b1) >>> 18, material.rgb);
    for (let dr = -25; dr <= 25; dr += 5) {
      for (let dg = -25; dg <= 25; dg += 5) {
        for (let db = -25; db <= 25; db += 5) colors.push([r + dr, g + dg, b + db, 255]);
      }
    }
  }
  let random = 0x12345678;
  for (let i = 0; i < 100_000; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const rgb = random & 0xffffff;
    const color = [rgb >>> 16, rgb >>> 8 & 255, rgb & 255, i % 7 === 0 ? random >>> 24 : 255];
    colors.push(color);
    const prior = slots.get(Math.imul(rgb, 0x9e3779b1) >>> 18);
    if (prior && !classifyMaterial(...color)) collision = [...prior, 255, ...color.slice(0, 3), 255];
  }
  assert.ok(collision, 'the deterministic sample must exercise a known/unknown hash collision');
  const input = new Uint8ClampedArray([...colors.flat(), ...collision, ...collision, ...collision]);
  const source = input.slice();
  const expected = new Uint8ClampedArray(input.length);
  let observed = 0;
  for (let i = 0; i < input.length; i += 4) {
    const material = classifyMaterial(input[i], input[i + 1], input[i + 2], input[i + 3]);
    if (material) { expected.set([...material.rgb, 255], i); observed++; }
  }
  const output = new Uint8ClampedArray(input.length);
  assert.deepEqual(observeMaterialChanges(input, output), { observed, changed: observed });
  assert.deepEqual(output, expected);
  assert.deepEqual(input, source, 'source pixels remain unchanged');
  assert.deepEqual(observeMaterialChanges(input, output), { observed, changed: 0 });
});
