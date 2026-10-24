import { encodePngRgba, getPngRgbaByteLength } from './png.ts';

export const MAX_CHUNKS_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_CHUNKS_TILES = 2048;
export const MAX_MAP_MARKERS = 512;
export const MAX_PNG_DIMENSION = 8192;
export const MAX_PNG_PIXELS = 32 * 1024 * 1024;

export interface ChunkTile {
  key: string;
  x: number; y: number; width: number; height: number;
  pixelWidth: number; pixelHeight: number;
  rgba: string;
  observedPixels?: number;
}
export interface ChunkWorld { centerX: number; centerY: number; radius: number }
export interface MapMarker { id: string; x: number; y: number; label: string }
export interface ChunksDocument {
  format: 'digdig-chunks';
  version: 1;
  savedAt: string;
  source: { label: string; buildHash: string | null; terrainMode?: 'materials-v1'; world?: ChunkWorld };
  tiles: ChunkTile[];
  markers: MapMarker[];
}
export interface ChunksWorldBounds {
  x: number; y: number; worldWidth: number; worldHeight: number;
}
export interface ChunksImageBounds extends ChunksWorldBounds {
  width: number; height: number; scale: number;
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown, label: string): Record<string, unknown> {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min = -1e9, max = 1e9, integer = false): number {
  expect(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value)), `${label} is outside the supported range.`);
  return value;
}
function withinUtf8Limit(text: string): boolean {
  if (text.length > MAX_CHUNKS_FILE_BYTES) return false;
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4; index++;
    } else bytes += 3;
    if (bytes > MAX_CHUNKS_FILE_BYTES) return false;
  }
  return true;
}
function tile(value: unknown, materialsOnly: boolean): ChunkTile {
  const item = object(value, 'Chunk');
  expect(typeof item.key === 'string' && /^[A-Za-z0-9_.:,\-]{1,128}$/.test(item.key), 'Chunk key is invalid.');
  const pixelWidth = number(item.pixelWidth, 'Pixel width', 1, 64, true);
  const pixelHeight = number(item.pixelHeight, 'Pixel height', 1, 64, true);
  const expectedBytes = pixelWidth * pixelHeight * 4;
  expect(typeof item.rgba === 'string' && item.rgba.length === 4 * Math.ceil(expectedBytes / 3)
    && /^[A-Za-z0-9+/]*={0,2}$/.test(item.rgba), 'Chunk RGBA data has an invalid size or encoding.');
  let decoded: string;
  try { decoded = atob(item.rgba); } catch { throw new Error('Chunk RGBA data is not valid base64.'); }
  expect(decoded.length === expectedBytes && btoa(decoded) === item.rgba, 'Chunk RGBA data must use canonical base64.');
  let observedPixels = 0;
  for (let offset = 0; offset < decoded.length; offset += 4) {
    const alpha = decoded.charCodeAt(offset + 3);
    if (materialsOnly) {
      expect(alpha === 0 || alpha === 255, 'Material pixels must be opaque or unknown.');
      expect(alpha !== 0 || (decoded.charCodeAt(offset) === 0 && decoded.charCodeAt(offset + 1) === 0
        && decoded.charCodeAt(offset + 2) === 0), 'Unknown material pixels must contain zero RGBA bytes.');
    }
    if (alpha !== 0) observedPixels++;
  }
  return {
    key: item.key, x: number(item.x, 'Chunk x'), y: number(item.y, 'Chunk y'),
    width: number(item.width, 'Chunk width', Number.MIN_VALUE, 1e7),
    height: number(item.height, 'Chunk height', Number.MIN_VALUE, 1e7),
    pixelWidth, pixelHeight, rgba: item.rgba,
    ...(materialsOnly ? { observedPixels } : {}),
  };
}

export function validateMapMarker(value: unknown): MapMarker {
  const marker = object(value, 'Marker');
  expect(typeof marker.id === 'string' && /^[A-Za-z0-9_.:,\-]{1,128}$/.test(marker.id), 'Marker ID is invalid.');
  expect(typeof marker.label === 'string', 'Marker label must be text.');
  const label = marker.label.trim();
  expect(label.length > 0 && label.length <= 240 && !/[\u0000-\u001f\u007f]/.test(label),
    'Marker label must contain 1–240 printable characters.');
  return { id: marker.id, x: number(marker.x, 'Marker x'), y: number(marker.y, 'Marker y'), label };
}

export function validateMapMarkers(value: unknown): MapMarker[] {
  expect(Array.isArray(value) && value.length <= MAX_MAP_MARKERS, `A map may contain at most ${MAX_MAP_MARKERS} markers.`);
  const markers = value.map(validateMapMarker);
  expect(new Set(markers.map((marker) => marker.id)).size === markers.length, 'Map contains duplicate marker IDs.');
  return markers;
}

/** Return a validated independent copy, including old files without markers. */
export function validateChunksDocument(value: unknown): ChunksDocument {
  const input = object(value, 'Chunks file');
  expect(input.format === 'digdig-chunks' && input.version === 1, 'Unsupported .chunks format or version.');
  expect(typeof input.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.savedAt)
    && Number.isFinite(Date.parse(input.savedAt)) && new Date(input.savedAt).toISOString() === input.savedAt,
  'Chunks file has an invalid saved timestamp.');
  const source = object(input.source, 'Source');
  expect(typeof source.label === 'string' && source.label.length > 0 && source.label.length <= 160
    && !/[\u0000-\u001f]/.test(source.label), 'Source label must contain 1–160 printable characters.');
  expect(source.buildHash === null || (typeof source.buildHash === 'string' && /^[a-f0-9]{64}$/.test(source.buildHash)), 'Source build hash is invalid.');
  expect(source.terrainMode === undefined || source.terrainMode === 'materials-v1', 'Unsupported terrain mode.');
  let world: ChunkWorld | undefined;
  if (source.world !== undefined) {
    const raw = object(source.world, 'Map bounds');
    world = { centerX: number(raw.centerX, 'Map center x'), centerY: number(raw.centerY, 'Map center y'),
      radius: number(raw.radius, 'Map radius', Number.MIN_VALUE, 1e7) };
  }
  expect(Array.isArray(input.tiles) && input.tiles.length <= MAX_CHUNKS_TILES, `A chunks file may contain at most ${MAX_CHUNKS_TILES} tiles.`);
  const tiles = input.tiles.map((item) => tile(item, source.terrainMode === 'materials-v1'));
  expect(new Set(tiles.map((item) => item.key)).size === tiles.length, 'Chunks file contains duplicate tile keys.');
  return {
    format: 'digdig-chunks', version: 1, savedAt: input.savedAt,
    source: { label: source.label, buildHash: source.buildHash,
      ...(source.terrainMode === 'materials-v1' ? { terrainMode: 'materials-v1' as const } : {}),
      ...(world ? { world } : {}) },
    tiles, markers: input.markers === undefined ? [] : validateMapMarkers(input.markers),
  };
}

export function createChunksDocument(client: {
  frame: { buildHash: string | null; terrainMode?: 'materials-v1'; world?: ChunkWorld };
  tiles: readonly ChunkTile[];
  markers?: readonly MapMarker[];
}, label = 'Captured map'): ChunksDocument {
  return validateChunksDocument({
    format: 'digdig-chunks', version: 1, savedAt: new Date().toISOString(),
    source: { label, buildHash: client.frame.buildHash,
      ...(client.frame.terrainMode ? { terrainMode: client.frame.terrainMode } : {}),
      ...(client.frame.world ? { world: client.frame.world } : {}) },
    tiles: client.tiles, markers: client.markers ?? [],
  });
}

export function parseChunksDocument(text: string): ChunksDocument {
  expect(typeof text === 'string' && withinUtf8Limit(text), 'Chunks file exceeds the 64 MiB limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The selected file is not valid .chunks JSON.'); }
  return validateChunksDocument(parsed);
}

export function stringifyChunksDocument(document: ChunksDocument): string {
  const text = `${JSON.stringify(validateChunksDocument(document))}\n`;
  expect(withinUtf8Limit(text), 'Chunks file exceeds the 64 MiB limit.');
  return text;
}

function worldBounds(tiles: readonly ChunkTile[]): ChunksWorldBounds {
  expect(tiles.length > 0, 'There are no chunks to export.');
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const item of tiles) {
    x = Math.min(x, item.x); y = Math.min(y, item.y);
    right = Math.max(right, item.x + item.width); bottom = Math.max(bottom, item.y + item.height);
  }
  const worldWidth = right - x, worldHeight = bottom - y;
  expect(worldWidth > 0 && worldHeight > 0 && Number.isFinite(worldWidth) && Number.isFinite(worldHeight), 'Chunk bounds cannot be represented as an image.');
  return { x, y, worldWidth, worldHeight };
}

/** View/fit bounds have no PNG allocation limits. */
export function getChunksWorldBounds(document: ChunksDocument): ChunksWorldBounds {
  return worldBounds(validateChunksDocument(document).tiles);
}

interface RasterTile { tile: ChunkTile; x: number; y: number; width: number; height: number }
interface RasterPlan { bounds: ChunksImageBounds; tiles: RasterTile[] }

/** Verify the logical grid against world geometry before interpreting tile keys.
 * The game slightly enlarges drawing rectangles to hide seams. Those padding
 * units must not shrink the original pixel rows/columns in an exported image.
 * Derive spacing from the scan: neither map radius nor a particular game's
 * world-unit tile size is assumed here. */
function logicalGrid(document: ChunksDocument): RasterPlan | undefined {
  if (document.source.terrainMode !== 'materials-v1' || !document.tiles.length) return;
  const first = document.tiles[0]!;
  if (first.pixelWidth !== first.pixelHeight) return;
  const tolerance = Math.max(1e-6, first.width / first.pixelWidth * 0.025);
  const indexed: { tile: ChunkTile; ix: number; iy: number; cx: number; cy: number }[] = [];
  const keys = new Set<string>();
  for (const tile of document.tiles) {
    const match = /^(-?\d+),(-?\d+)$/.exec(tile.key);
    if (!match || tile.pixelWidth !== first.pixelWidth || tile.pixelHeight !== first.pixelHeight
      || Math.abs(tile.width - first.width) > tolerance || Math.abs(tile.height - first.width) > tolerance) return;
    const ix = Number(match[1]), iy = Number(match[2]);
    const key = `${ix},${iy}`;
    if (!Number.isSafeInteger(ix) || !Number.isSafeInteger(iy) || keys.has(key)) return;
    keys.add(key);
    indexed.push({ tile, ix, iy, cx: tile.x + tile.width / 2, cy: tile.y + tile.height / 2 });
  }
  const steps: number[] = [];
  for (const [index, coordinate] of [['ix', 'cx'], ['iy', 'cy']] as const) {
    let low = indexed[0]!, high = low;
    for (const tile of indexed) {
      if (tile[index] < low[index]) low = tile;
      if (tile[index] > high[index]) high = tile;
    }
    if (high[index] !== low[index]) steps.push((high[coordinate] - low[coordinate]) / (high[index] - low[index]));
  }
  const step = steps.length ? steps.reduce((sum, value) => sum + value, 0) / steps.length : first.width;
  if (!Number.isFinite(step) || step <= 0 || steps.some(value => Math.abs(value - step) > tolerance)
    || step > first.width + tolerance || first.width - step > first.width / first.pixelWidth / 2) return;
  const originX = indexed.reduce((sum, item) => sum + item.cx - (item.ix + 0.5) * step, 0) / indexed.length;
  const originY = indexed.reduce((sum, item) => sum + item.cy - (item.iy + 0.5) * step, 0) / indexed.length;
  if (indexed.some(item => Math.abs(item.cx - originX - (item.ix + 0.5) * step) > tolerance
    || Math.abs(item.cy - originY - (item.iy + 0.5) * step) > tolerance)) return;
  const minX = Math.min(...indexed.map(item => item.ix)), maxX = Math.max(...indexed.map(item => item.ix));
  const minY = Math.min(...indexed.map(item => item.iy)), maxY = Math.max(...indexed.map(item => item.iy));
  return {
    bounds: { x: originX + minX * step, y: originY + minY * step,
      worldWidth: (maxX - minX + 1) * step, worldHeight: (maxY - minY + 1) * step,
      width: (maxX - minX + 1) * first.pixelWidth, height: (maxY - minY + 1) * first.pixelHeight,
      scale: first.pixelWidth / step },
    tiles: indexed.map(item => ({ tile: item.tile, x: (item.ix - minX) * first.pixelWidth,
      y: (item.iy - minY) * first.pixelHeight, width: first.pixelWidth, height: first.pixelHeight })),
  };
}

function rasterPlan(document: ChunksDocument, maxDimension: number, maxPixels: number): RasterPlan {
  number(maxDimension, 'Image dimension limit', 1, MAX_PNG_DIMENSION, true);
  number(maxPixels, 'Image pixel limit', 1, MAX_PNG_PIXELS, true);
  const world = worldBounds(document.tiles);
  let plan = logicalGrid(document);
  if (!plan) {
    const scale = Math.max(...document.tiles.flatMap(tile => [tile.pixelWidth / tile.width, tile.pixelHeight / tile.height]));
    // Arbitrary old/fixture rectangles may not form a logical grid. Snap their
    // placements to whole output pixels and only enlarge source samples, never
    // reduce them or interpolate colors.
    const tiles = document.tiles.map(tile => ({ tile,
      x: Math.round((tile.x - world.x) * scale), y: Math.round((tile.y - world.y) * scale),
      width: Math.max(tile.pixelWidth, Math.ceil(tile.width * scale - 1e-6)),
      height: Math.max(tile.pixelHeight, Math.ceil(tile.height * scale - 1e-6)) }));
    plan = { bounds: { ...world, scale,
      width: Math.max(...tiles.map(tile => tile.x + tile.width)),
      height: Math.max(...tiles.map(tile => tile.y + tile.height)) }, tiles };
  }
  const { width, height } = plan.bounds;
  expect(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && width <= maxDimension && height <= maxDimension && width * height <= maxPixels,
  `The full-resolution PNG exceeds the export limit (${maxDimension} pixels per side, ${maxPixels} pixels total). Save .chunks instead; no pixels were reduced.`);
  expect(getPngRgbaByteLength(width, height) <= MAX_CHUNKS_FILE_BYTES,
    'The uncompressed full-resolution PNG exceeds 64 MiB. Save .chunks instead; no pixels were reduced.');
  return plan;
}

/** Native-resolution bounds; oversized exports fail instead of losing pixels. */
export function getChunksImageBounds(document: ChunksDocument,
  maxDimension = MAX_PNG_DIMENSION, maxPixels = MAX_PNG_PIXELS): ChunksImageBounds {
  return rasterPlan(validateChunksDocument(document), maxDimension, maxPixels).bounds;
}

function paintTile(output: Uint8Array, outputWidth: number, placement: RasterTile) {
  const { tile, x, y, width, height } = placement;
  const input = Uint8Array.from(atob(tile.rgba), character => character.charCodeAt(0));
  for (let row = 0; row < height; row++) {
    const sourceRow = Math.floor(row * tile.pixelHeight / height) * tile.pixelWidth;
    let destination = ((y + row) * outputWidth + x) * 4;
    for (let column = 0; column < width; column++, destination += 4) {
      const source = (sourceRow + Math.floor(column * tile.pixelWidth / width)) * 4;
      const alpha = input[source + 3]!, previousAlpha = output[destination + 3]!;
      if (alpha === 255 || previousAlpha === 0) {
        output[destination] = input[source]!;
        output[destination + 1] = input[source + 1]!;
        output[destination + 2] = input[source + 2]!;
        output[destination + 3] = alpha;
      } else if (alpha !== 0) {
        // Only raw overlapping fixture/archive pixels need source-over blending.
        // A sample over an unknown pixel is copied byte-for-byte above, avoiding
        // canvas premultiplied-alpha rounding of the original RGB channels.
        const combined = alpha * 255 + previousAlpha * (255 - alpha);
        for (let channel = 0; channel < 3; channel++) {
          output[destination + channel] = Math.round((input[source + channel]! * alpha * 255
            + output[destination + channel]! * previousAlpha * (255 - alpha)) / combined);
        }
        output[destination + 3] = Math.round(combined / 255);
      }
    }
  }
}

/** Export original terrain samples with no canvas resampling or PNG compression. */
export async function renderChunksPng(document: ChunksDocument): Promise<Blob> {
  const checked = validateChunksDocument(document);
  const plan = rasterPlan(checked, MAX_PNG_DIMENSION, MAX_PNG_PIXELS);
  const { width, height } = plan.bounds;
  const pixels = new Uint8Array(width * height * 4);
  for (const tile of plan.tiles) paintTile(pixels, width, tile);
  const png = encodePngRgba(width, height, pixels, MAX_CHUNKS_FILE_BYTES);
  return new Blob([png], { type: 'image/png' });
}
