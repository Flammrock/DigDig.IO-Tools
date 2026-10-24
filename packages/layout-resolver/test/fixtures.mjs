import wabtFactory from 'wabt';

// Independently authored toy module. It is never derived by patching a game
// binary and must never replace a game's module in a live page.
const bytesLiteral = bytes => Array.from(bytes, byte => `\\${byte.toString(16).padStart(2, '0')}`).join('');
const words = values => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
};
const floats = values => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
};

export function resolverFixtureWat(options = {}) {
  const { origin = 8192, owner = 12288, ownerField = 64, cameraOffset = 128,
    allocation = 16384, vtable = 2048, palette = 4096, memoryExport = 'terrain_memory',
    fieldShift = 0, ambiguous = false, wrongPalette = false, wrongCamera = false, wrongGrid = false,
    missingTerrain = false, staticCamera = false } = options;
  const fields = { x: 8 + fieldShift, y: 12 + fieldShift, scale: 16 + fieldShift, width: 20 + fieldShift, height: 24 + fieldShift };
  const layout = { memoryExport, mapX: origin, mapY: origin + 4, mapRadius: origin + 8,
    ...(staticCamera ? {} : { cameraPointer: owner + ownerField }), cameraOffset: staticCamera ? owner + cameraOffset : cameraOffset, cameraVtable: vtable,
    cameraX: fields.x, cameraY: fields.y, cameraScale: fields.scale, viewWidth: fields.width, viewHeight: fields.height,
    scaleMode: 'divide-f32', terrain: { sourceWidth: 64, sourceHeight: 64, worldGridSpacing: 1024,
      worldDrawSize: 1026, worldDrawInset: -1, paletteProfile: 'materials-v1' } };
  const cameraBase = (staticCamera ? owner : allocation) + cameraOffset;
  const cameraBytes = new Uint8Array(fields.height + 4), cameraView = new DataView(cameraBytes.buffer);
  cameraView.setUint32(0, vtable, true);
  cameraView.setFloat32(fields.x, 256, true); cameraView.setFloat32(fields.y, 512, true);
  cameraView.setFloat32(fields.scale, 1, true);
  cameraView.setInt32(fields.width, 1920, true); cameraView.setInt32(fields.height, 1080, true);
  const paletteBytes = words([0xb834ba, 0xa8a116, 0x784400, 0x784400, 0x111111, 0x34a832, 0xad1a07, 0x32a8a0, wrongPalette ? 0xeeeeee : 0xdddddd]);
  const pages = Math.ceil((Math.max(origin + 12, owner + ownerField + 4, cameraBase + cameraBytes.length, palette + paletteBytes.length) + 1024) / 65536);
  const wat = `(module
    (memory (export "${memoryExport}") ${pages})
    (data (i32.const ${origin}) "${bytesLiteral(floats([0, 0, 4096]))}")
    (data (i32.const ${owner + ownerField}) "${bytesLiteral(words([allocation]))}")
    (data (i32.const ${cameraBase}) "${bytesLiteral(cameraBytes)}")
    (data (i32.const ${palette}) "${bytesLiteral(paletteBytes)}")
    (func $allocate (param i32) (result i32) i32.const ${allocation})
    ${staticCamera ? `(func $constructor (param $owner i32)
      local.get $owner i32.const ${cameraOffset} i32.add i32.const ${vtable} i32.store)` : `(func $constructor (param $owner i32) (local $heap i32)
      i32.const ${Math.max(1024, cameraOffset + fields.height + 8)} call $allocate
      local.tee $heap local.get $owner i32.store
      local.get $heap i32.const ${cameraOffset} i32.add i32.const ${vtable} i32.store
      local.get $owner local.get $heap i32.store offset=${ownerField})`}
    (func $startup i32.const ${owner} call $constructor)
    ${ambiguous ? `(func $anotherStartup i32.const ${owner + 1024} call $constructor)` : ''}
    (func $coordinates (param $camera i32) (param $other i32)
      (local $height i32) (local $width i32) (local $heightScale f32) (local $widthScale f32) (local $scale f32)
      local.get $camera i32.const ${cameraOffset} i32.sub i32.load drop
      i32.const ${origin + 8} f32.load
      local.get $camera f32.load offset=${fields.scale}
      local.get $camera i32.load offset=${fields.height} local.tee $height f32.convert_i32_s
      f32.const 1080 f32.div local.tee $heightScale
      local.get $camera i32.load offset=${fields.width} local.tee $width f32.convert_i32_s
      f32.const 1920 f32.div local.tee $widthScale
      local.get $heightScale local.get $widthScale f32.gt select f32.mul local.tee $scale f32.mul drop
      local.get $height f64.convert_i32_s f64.const 0.5 f64.mul
      i32.const ${origin + 4} f32.load local.get ${wrongCamera ? '$other' : '$camera'} f32.load offset=${fields.y}
      f32.sub local.get $scale f32.mul f64.promote_f32 f64.add f32.demote_f64 drop
      local.get $width f64.convert_i32_s f64.const 0.5 f64.mul
      i32.const ${origin} f32.load local.get $camera f32.load offset=${fields.x}
      f32.sub local.get $scale f32.mul f64.promote_f32 f64.add f32.demote_f64 drop)
    ${missingTerrain ? '' : `
    (func $createSurface (param i32 i32 i32))
    (func $materialId (param i32) (result i32) i32.const 3)
    (func $material (param $chunk i32) (result i32)
      (local $surface i32) (local $rgb i32) (local $green i32) (local $blue i32) (local $material i32) (local $x i32) (local $y i32)
      local.get $surface i32.const 64 i32.const 64 call $createSurface
      i32.const 34 local.set $rgb i32.const 34 local.set $green i32.const 34 local.set $blue
      local.get $chunk call $materialId local.tee $material i32.const 4 i32.ne
      if
        local.get $surface local.get $material i32.const 1 i32.sub i32.const 255 i32.and i32.const 2 i32.shl
        i32.const ${palette} i32.add i32.load local.tee $rgb i32.store8 offset=26
        local.get $surface local.get $rgb i32.const 8 i32.shr_u i32.store8 offset=25
        local.get $surface local.get $rgb i32.const 16 i32.shr_u i32.store8 offset=24
      end
      local.get $surface local.get $rgb i32.const -16777216 i32.or i32.store
      loop $rows local.get $x i32.const 1 i32.add local.tee $x i32.const 64 i32.ne br_if $rows end
      loop $columns local.get $y i32.const 1 i32.add local.tee $y i32.const 64 i32.ne br_if $columns end
      local.get $surface)
    (func $draw (param i32 i32 f64 f64 f64 f64) i32.const 0 i32.const 35 i32.store8)
    (func $render (param $owner i32) (param $viewport i32) (param $context i32) (param $chunk i32) (local $camera i32)
      local.get $owner i32.const ${cameraOffset} i32.add local.tee $camera drop
      local.get $camera local.get $viewport i32.load offset=44 i32.store offset=${fields.width}
      local.get $camera local.get $viewport i32.load offset=48 i32.store offset=${fields.height}
      local.get $camera f32.load offset=${fields.scale} drop
      local.get $context local.get $chunk call $material
      local.get $chunk i32.load16_u i32.const ${wrongGrid ? 9 : 10} i32.shl f64.convert_i32_u f64.const -1 f64.add
      local.get $chunk i32.load16_u offset=2 i32.const 10 i32.shl f64.convert_i32_u f64.const -1 f64.add
      f64.const 1026 f64.const 1026 call $draw)`}
  )`;
  return { wat, layout, cameraBase, allocation, mapState: { world: { centerX: 0, centerY: 0, radius: 4096 },
    player: { x: 256, y: 512, normalizedX: 0.0625, normalizedY: 0.125 }, camera: { x: 256, y: 512, scale: 1, width: 1920, height: 1080 } } };
}

let compiler;
export async function buildResolverFixture(options = {}) {
  const fixture = resolverFixtureWat(options);
  compiler ??= wabtFactory();
  const wabt = await compiler;
  const module = wabt.parseWat('independently-authored-layout-fixture.wat', fixture.wat);
  try { module.validate(); return { ...fixture, bytes: new Uint8Array(module.toBinary({ write_debug_names: false }).buffer) }; }
  finally { module.destroy(); }
}
