export interface Material {
  readonly id: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly tolerance: number;
}

// Read from the original current WASM's data table, not from fog-blended screenshots.
// Evidence and exact supported binary hash: reports/current-terrain-palette.json.
// The renderer dithers each channel to floor(base * brightness), brightness 0.95..1.
export const materialPalette: readonly Material[] = [
  { id: 'dirt', name: 'Dirt', rgb: [120, 68, 0], tolerance: 24 },
  { id: 'quartz', name: 'Quartz', rgb: [221, 221, 221], tolerance: 24 },
  { id: 'diamond', name: 'Diamond', rgb: [50, 168, 160], tolerance: 24 },
  // Empty space is [34,34,34], fog is roughly [44..51] gray. A broad radius of
  // 40 around bedrock would accept empty space; only tiny bedrock noise is allowed.
  { id: 'bedrock', name: 'Bedrock', rgb: [17, 17, 17], tolerance: 4 },
  { id: 'gold', name: 'Gold', rgb: [168, 161, 22], tolerance: 24 },
  { id: 'amethyst', name: 'Amethyst', rgb: [184, 52, 186], tolerance: 24 },
  { id: 'uranium', name: 'Uranium', rgb: [52, 168, 50], tolerance: 24 },
  { id: 'lava', name: 'Lava', rgb: [173, 26, 7], tolerance: 24 },
];

/** Squared Euclidean RGB distance, avoiding a square root for every material/pixel. */
export function classifyMaterial(red: number, green: number, blue: number, alpha = 255): Material | undefined {
  if (alpha !== 255) return;
  let match: Material | undefined;
  let nearest = Infinity;
  for (const material of materialPalette) {
    const distance = (red - material.rgb[0]) ** 2 + (green - material.rgb[1]) ** 2 + (blue - material.rgb[2]) ** 2;
    if (distance < material.tolerance ** 2 && distance < nearest) {
      match = material;
      nearest = distance;
    }
  }
  return match;
}

export interface MaterialObservation { observed: number; changed: number }

// Terrain repeats a small set of exact RGB shades. A bounded 64 KiB direct-mapped
// cache avoids eight distance tests per pixel without quantizing colors. Entries
// retain the entire RGB key: a collision only causes another exact classification.
// The high byte is 1 for unknown, or the palette index + 2; zero means unused.
const materialColors = new Uint32Array(16_384);

/** Add positive observations and count changed pixels; never erase discoveries with fog. */
export function observeMaterialChanges(input: Uint8ClampedArray, output: Uint8ClampedArray): MaterialObservation {
  if (input.length !== output.length || input.length % 4 !== 0) throw new Error('RGBA buffers must have equal, whole-pixel lengths');
  if (input.buffer === output.buffer) throw new Error('Material observations require a separate output buffer');
  let observed = 0, changed = 0;
  for (let offset = 0; offset < input.length; offset += 4) {
    if (input[offset + 3] !== 255) continue;
    const red = input[offset]!, green = input[offset + 1]!, blue = input[offset + 2]!;
    const rgb = red << 16 | green << 8 | blue;
    const slot = Math.imul(rgb, 0x9e3779b1) >>> 18;
    const cached = materialColors[slot]!;
    let code: number;
    if (cached !== 0 && (cached & 0xffffff) === rgb) code = cached >>> 24;
    else {
      const material = classifyMaterial(red, green, blue);
      code = material ? materialPalette.indexOf(material) + 2 : 1;
      materialColors[slot] = code << 24 | rgb;
    }
    if (code === 1) continue;
    const material = materialPalette[code - 2]!;
    observed++;
    if (output[offset] === material.rgb[0] && output[offset + 1] === material.rgb[1]
      && output[offset + 2] === material.rgb[2] && output[offset + 3] === 255) continue;
    output[offset] = material.rgb[0];
    output[offset + 1] = material.rgb[1];
    output[offset + 2] = material.rgb[2];
    output[offset + 3] = 255;
    changed++;
  }
  return { observed, changed };
}

/** Add positive observations only; fog, transparency, and air never erase prior knowledge. */
export function observeMaterialPixels(input: Uint8ClampedArray, output: Uint8ClampedArray): number {
  return observeMaterialChanges(input, output).observed;
}

export * from './chunks.ts';
