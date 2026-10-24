// Deterministic CPU benchmark. No game modules, browser hooks, or live data.
// Run: node tools/benchmark-terrain.mjs
import { performance } from 'node:perf_hooks';
import { materialPalette, classifyMaterial, observeMaterialChanges } from '../packages/terrain/src/index.ts';

function previousObserve(input, output) {
  let observed = 0;
  for (let offset = 0; offset < input.length; offset += 4) {
    const material = classifyMaterial(input[offset], input[offset + 1], input[offset + 2], input[offset + 3]);
    if (!material) continue;
    output[offset] = material.rgb[0]; output[offset + 1] = material.rgb[1];
    output[offset + 2] = material.rgb[2]; output[offset + 3] = 255;
    observed++;
  }
  return observed;
}

function measure(operation, input) {
  const output = new Uint8ClampedArray(input.length);
  for (let i = 0; i < 12; i++) operation(input, output);
  const samples = [];
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    for (let i = 0; i < 50; i++) operation(input, output);
    samples.push((performance.now() - start) / 50);
  }
  return samples.sort((a, b) => a - b)[2];
}

for (const fog of [false, true]) {
  const input = new Uint8ClampedArray(24 * 64 * 64 * 4);
  let random = 0x12345678;
  for (let offset = 0; offset < input.length; offset += 4) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const material = materialPalette[random % materialPalette.length];
    const brightness = 0.95 + ((random >>> 8) % 101) / 2000;
    input.set(fog && random >>> 31 ? [49, 49, 49, 255]
      : [...material.rgb.map(channel => Math.floor(channel * brightness)), 255], offset);
  }
  const before = measure(previousObserve, input);
  const after = measure(observeMaterialChanges, input);
  console.log(JSON.stringify({ workload: fog ? '24 tiles, half fog' : '24 tiles, opaque terrain',
    pixels: input.length / 4, beforeMs: +before.toFixed(3), afterMs: +after.toFixed(3),
    classificationSpeedup: +(before / after).toFixed(2) }));
}
