import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { createChunksDocument, parseChunksDocument, stringifyChunksDocument, getChunksImageBounds,
  renderChunksPng, getChunksWorldBounds, validateMapMarker, MAX_MAP_MARKERS,
  MAX_CHUNKS_TILES, MAX_CHUNKS_FILE_BYTES, MAX_PNG_PIXELS } from '../src/chunks.ts';

function tile(overrides = {}) {
  return { key: '0,0', x: -1024, y: 512, width: 1024, height: 1024,
    pixelWidth: 2, pixelHeight: 1, rgba: Buffer.from([120, 68, 0, 255, 0, 0, 0, 0]).toString('base64'), ...overrides };
}
function document(tiles = [tile()]) {
  return createChunksDocument({ frame: { buildHash: 'a'.repeat(64), terrainMode: 'materials-v1',
    world: { centerX: 0, centerY: 0, radius: 9000 } }, tiles }, 'Saved discovery');
}

async function decodedPng(saved) {
  const png = Buffer.from(await (await renderChunksPng(saved)).arrayBuffer());
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
  for (let cursor = 8; cursor < png.length;) {
    const size = png.readUInt32BE(cursor);
    if (png.toString('ascii', cursor + 4, cursor + 8) === 'IDAT') chunks.push(png.subarray(cursor + 8, cursor + 8 + size));
    cursor += 12 + size;
  }
  const rows = inflateSync(Buffer.concat(chunks)), pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * (width * 4 + 1)], 0);
    rows.copy(pixels, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, pixels, png };
}

test('chunks round-trip preserves placement, palette bytes, transparency, and map bounds independently', () => {
  const source = tile({ observedPixels: 999 });
  const saved = document([source]);
  const text = stringifyChunksDocument(saved);
  const loaded = parseChunksDocument(text);
  assert.deepEqual(loaded, saved);
  assert.equal(loaded.tiles[0].observedPixels, 1, 'do not trust supplied counters');
  assert.equal(loaded.tiles[0].rgba, source.rgba);
  assert.equal(loaded.tiles[0].x, -1024);
  loaded.tiles[0].x = 10;
  loaded.source.world.radius = 20;
  assert.equal(saved.tiles[0].x, -1024);
  assert.equal(saved.source.world.radius, 9000);
  assert.deepEqual(parseChunksDocument(`\uFEFF${text}`), saved);
});

test('rejects unsupported, corrupt, ambiguous, and oversized chunk documents before use', () => {
  const saved = document();
  const invalid = [
    { ...saved, format: 'other' }, { ...saved, version: 2 }, { ...saved, savedAt: '2026-02-30T00:00:00.000Z' },
    { ...saved, source: { ...saved.source, buildHash: 'unknown' } },
    { ...saved, source: { ...saved.source, world: { centerX: 0, centerY: 0, radius: -1 } } },
    { ...saved, tiles: [tile(), tile()] },
    { ...saved, tiles: [tile({ pixelWidth: 65 })] }, { ...saved, tiles: [tile({ width: 0 })] },
    { ...saved, tiles: [tile({ x: 1e12 })] }, { ...saved, tiles: [tile({ rgba: '/wAA/w==' })] },
    { ...saved, tiles: [tile({ rgba: Buffer.from([120, 68, 0, 128, 0, 0, 0, 0]).toString('base64') })] },
    { ...saved, tiles: [tile({ rgba: Buffer.from([120, 68, 0, 255, 1, 0, 0, 0]).toString('base64') })] },
    { ...saved, tiles: Array.from({ length: MAX_CHUNKS_TILES + 1 }, (_, index) => tile({ key: String(index) })) },
  ];
  for (const value of invalid) assert.throws(() => parseChunksDocument(JSON.stringify(value)));
  assert.throws(() => parseChunksDocument('{broken'), /JSON/);
  assert.throws(() => parseChunksDocument(' '.repeat(MAX_CHUNKS_FILE_BYTES + 1)), /64 MiB/);
});

test('raw fixture files retain partial alpha while material observations remain binary coverage', () => {
  const raw = createChunksDocument({ frame: { buildHash: null }, tiles: [tile({ rgba: Buffer.from([120, 68, 0, 128, 0, 0, 0, 0]).toString('base64') })] });
  assert.equal(parseChunksDocument(stringifyChunksDocument(raw)).tiles[0].rgba, raw.tiles[0].rgba);
  assert.equal(raw.tiles[0].observedPixels, undefined);
});

test('PNG bounds include all chunk coordinates at native density without viewport cropping', () => {
  const data = Buffer.alloc(64 * 64 * 4).toString('base64');
  const saved = document([tile({ pixelWidth: 64, pixelHeight: 64, rgba: data }),
    tile({ key: '1,0', x: 0, pixelWidth: 64, pixelHeight: 64, rgba: data })]);
  const bounds = getChunksImageBounds(saved);
  assert.deepEqual(bounds, { x: -1024, y: 512, worldWidth: 2048, worldHeight: 1024,
    width: 128, height: 64, scale: 1 / 16 });
  assert.throws(() => getChunksImageBounds(document([])), /no chunks/);
});

test('oversized native PNGs fail before allocation without shrinking or preventing map fitting', async () => {
  const small = tile({ key: 'left', x: -1e9, y: -1e9, width: 1, height: 1 });
  const distant = tile({ key: 'right', x: 1e9, y: 1e9, width: 1, height: 1 });
  for (const [dimension, pixels] of [[8192, MAX_PNG_PIXELS], [100, 1000], [8192, 1]]) {
    assert.throws(() => getChunksImageBounds(document([small, distant]), dimension, pixels), /full-resolution.*exceeds/);
  }
  await assert.rejects(renderChunksPng(document([small, distant])), /full-resolution.*exceeds/);
  assert.deepEqual(getChunksWorldBounds(document([small, distant])), {
    x: -1e9, y: -1e9, worldWidth: 2e9 + 1, worldHeight: 2e9 + 1,
  });
  const wide = tile({ key: 'a', x: 0, y: 0, width: 8192, height: 2048 });
  const dense = tile({ key: 'b', x: 0, y: 0, width: 2, height: 1 });
  assert.throws(() => getChunksImageBounds(document([wide, dense])), /uncompressed.*64 MiB/);
});

test('old chunks files load without markers and new files preserve independent named markers', () => {
  const old = document();
  delete old.markers;
  assert.deepEqual(parseChunksDocument(JSON.stringify(old)).markers, []);
  const marker = { id: 'ore-1', x: -2048.5, y: 123, label: '  Explore here when diamond respawns  ' };
  const saved = createChunksDocument({ frame: old.source, tiles: old.tiles, markers: [marker] });
  const loaded = parseChunksDocument(stringifyChunksDocument(saved));
  assert.deepEqual(loaded.markers, [{ ...marker, label: marker.label.trim() }]);
  loaded.markers[0].label = 'Changed';
  assert.equal(saved.markers[0].label, marker.label.trim());
  assert.equal(marker.label.startsWith('  '), true);
});

test('marker validation rejects ambiguous IDs, invalid coordinates, controls, and unbounded lists', () => {
  const saved = document();
  const marker = { id: 'ore-1', x: 0, y: 0, label: 'Diamond' };
  for (const markers of [null, {}, [marker, marker], [{ ...marker, id: '../ore' }],
    [{ ...marker, x: 1e10 }], [{ ...marker, y: null }], [{ ...marker, label: ' ' }],
    [{ ...marker, label: 'A\nB' }], [{ ...marker, label: 'x'.repeat(241) }],
    Array.from({ length: MAX_MAP_MARKERS + 1 }, (_, index) => ({ ...marker, id: String(index) }))]) {
    assert.throws(() => parseChunksDocument(JSON.stringify({ ...saved, markers })));
  }
  assert.throws(() => validateMapMarker({ ...marker, x: Infinity }));
  assert.throws(() => validateMapMarker({ ...marker, y: NaN }));
  assert.equal(validateMapMarker({ ...marker, label: 'x'.repeat(240), x: -1e9, y: 1e9 }).label.length, 240);
});

test('PNG export preserves exactly the terrain regardless of distant markers or map radius', async () => {
  const saved = document();
  const marked = { ...saved, markers: [{ id: 'far-away', x: 1e9, y: -1e9, label: 'Hidden from PNG' }] };
  assert.deepEqual(getChunksImageBounds(marked), getChunksImageBounds(saved));
  marked.source = { ...marked.source, world: { centerX: 9999, centerY: -5000, radius: 30 } };
  assert.deepEqual((await decodedPng(marked)).png, (await decodedPng(saved)).png);
});

test('logical grid preserves every 64x64 sample despite padded draw rectangles, jitter, negatives and gaps', async () => {
  for (const step of [1024, 777]) {
    const indices = [[-2, -1], [-1, -1], [-2, 1]];
    const expected = Buffer.alloc(128 * 192 * 4);
    const tiles = indices.map(([ix, iy], index) => {
      const data = Buffer.alloc(64 * 64 * 4);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        if ((x + y) % 7 !== 0) data.set([(x + index) % 2 ? 120 : 221, (x + index) % 2 ? 68 : 221, (x + index) % 2 ? 0 : 221, 255], (y * 64 + x) * 4);
      }
      for (let y = 0; y < 64; y++) data.copy(expected,
        (((iy + 1) * 64 + y) * 128 + (ix + 2) * 64) * 4, y * 64 * 4, (y + 1) * 64 * 4);
      const jitter = (index - 1) * 0.03;
      return tile({ key: `${ix},${iy}`, x: 123 + ix * step - 1 + jitter, y: -87 + iy * step - 1 - jitter,
        width: step + 2 + jitter, height: step + 2 - jitter, pixelWidth: 64, pixelHeight: 64, rgba: data.toString('base64') });
    });
    const result = await decodedPng(document(tiles));
    assert.equal(result.width, 128); assert.equal(result.height, 192);
    assert.deepEqual(result.pixels, expected);
  }
});

test('misleading logical keys cannot collapse far-apart world rectangles into adjacent tiles', async () => {
  const data = Buffer.alloc(64 * 64 * 4, 255).toString('base64');
  const saved = document([tile({ key: '0,0', x: 0, y: 0, width: 1026, height: 1026, pixelWidth: 64, pixelHeight: 64, rgba: data }),
    tile({ key: '1,0', x: 8192, y: 0, width: 1026, height: 1026, pixelWidth: 64, pixelHeight: 64, rgba: data })]);
  const result = await decodedPng(saved);
  assert.ok(result.width > 128);
  assert.equal(result.pixels.filter((_, index) => index % 4 === 3 && result.pixels[index] === 255).length, 2 * 64 * 64);
});

test('transparent overlapping terrain never erases known pixels; raw alpha retains exact source channels', async () => {
  const known = tile({ key: 'known', x: 0, y: 0, width: 2, height: 1 });
  const unknown = tile({ ...known, key: 'unknown', rgba: Buffer.alloc(8).toString('base64') });
  const materials = await decodedPng(document([known, unknown]));
  assert.deepEqual(materials.pixels, Buffer.from(known.rgba, 'base64'));
  const rawPixels = Buffer.from([119, 67, 3, 1, 123, 45, 67, 0]);
  const raw = createChunksDocument({ frame: { buildHash: null }, tiles: [{ ...known, rgba: rawPixels.toString('base64') }] });
  assert.deepEqual((await decodedPng(raw)).pixels, rawPixels);
});
