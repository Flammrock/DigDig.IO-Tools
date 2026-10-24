import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import { readFunctions } from '../src/instructions.mjs';
import { findCameraPointerCandidates, findCoordinateCandidates } from '../src/patterns.mjs';

const wabt = await wabtFactory();

function fixture(origin, secondCamera = '$camera') {
  return `(func (param $camera i32) (param $otherCamera i32)
    (local $height i32) (local $width i32)
    (local $heightScale f32) (local $widthScale f32) (local $scale f32)
    local.get $camera
    i32.load offset=24
    local.tee $height
    f32.convert_i32_s
    f32.const 0x1.e573acp-11
    f32.mul
    local.tee $heightScale
    local.get $camera
    i32.load offset=20
    local.tee $width
    f32.convert_i32_s
    f32.const 0x1.111112p-11
    f32.mul
    local.tee $widthScale
    local.get $widthScale
    local.get $heightScale
    f32.lt
    select
    local.get $camera
    f32.load offset=16
    f32.mul
    local.tee $scale
    i32.const ${origin + 8}
    f32.load
    f32.mul
    drop
    f64.const 0
    local.get $scale
    i32.const ${origin + 4}
    f32.load
    local.get ${secondCamera}
    f32.load offset=12
    f32.sub
    f32.mul
    f64.promote_f32
    f64.add
    drop
    f64.const 0
    local.get $scale
    i32.const ${origin}
    f32.load
    local.get $camera
    f32.load offset=8
    f32.sub
    f32.mul
    f64.promote_f32
    f64.add
    drop)`;
}

function decode(...bodies) {
  const source = wabt.parseWat('fixture.wat', `(module (memory 1) ${bodies.join('\n')})`);
  try {
    source.validate();
    const { buffer } = source.toBinary({ write_debug_names: false });
    const decoded = wabt.readWasm(buffer, { readDebugNames: true });
    try {
      decoded.generateNames();
      decoded.applyNames();
      return readFunctions(decoded.toText({ foldExprs: false, inlineExport: false }));
    } finally {
      decoded.destroy();
    }
  } finally {
    source.destroy();
  }
}

test('decoded signature survives address relocation and loss of local names', () => {
  for (const origin of [120, 1857464, 30000000]) {
    const candidates = findCoordinateCandidates(decode(fixture(origin)));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].originX, origin);
    assert.equal(candidates[0].originY, origin + 4);
    assert.equal(candidates[0].mapSize, origin + 8);
  }
});

test('unrelated camera operands prevent a false coordinate match', () => {
  assert.deepEqual(findCoordinateCandidates(decode(fixture(1857464, '$otherCamera'))), []);
});

test('ambiguous candidates remain visible instead of silently choosing the first', () => {
  const candidates = findCoordinateCandidates(decode(fixture(1857464), fixture(30000000)));
  assert.equal(candidates.length, 2);
});

function divisionFixture(origin, other = '$camera', viewport = '$width') {
  return `(func $coordinates (param $camera i32) (param $otherCamera i32)
    (local $height i32) (local $width i32)
    (local $heightScale f32) (local $widthScale f32) (local $scale f32)
    local.get $camera
    i32.const 185632
    i32.sub
    i32.load
    drop
    i32.const ${origin + 8}
    f32.load
    local.get $camera
    f32.load offset=16
    local.get $camera
    i32.load offset=24
    local.tee $height
    f32.convert_i32_s
    f32.const 1080
    f32.div
    local.tee $heightScale
    local.get $camera
    i32.load offset=20
    local.tee $width
    f32.convert_i32_s
    f32.const 1920
    f32.div
    local.tee $widthScale
    local.get $heightScale
    local.get $widthScale
    f32.gt
    select
    f32.mul
    local.tee $scale
    f32.mul
    drop
    local.get $height
    f64.convert_i32_s
    f64.const 0.5
    f64.mul
    i32.const ${origin + 4}
    f32.load
    local.get ${other}
    f32.load offset=12
    f32.sub
    local.get $scale
    f32.mul
    f64.promote_f32
    f64.add
    f32.demote_f64
    drop
    local.get ${viewport}
    f64.convert_i32_s
    f64.const 0.5
    f64.mul
    i32.const ${origin}
    f32.load
    local.get $camera
    f32.load offset=8
    f32.sub
    local.get $scale
    f32.mul
    f64.promote_f32
    f64.add
    f32.demote_f64
    drop)`;
}

test('viewport division variant resolves relocated origins and checks both axes', () => {
  for (const origin of [120, 1509292, 30000000]) {
    const matches = findCoordinateCandidates(decode(divisionFixture(origin)));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].originX, origin);
    assert.equal(matches[0].mapSize, origin + 8);
    assert.equal(matches[0].scaleMode, 'viewport-division');
  }
  assert.deepEqual(findCoordinateCandidates(decode(divisionFixture(120, '$otherCamera'))), []);
  assert.deepEqual(findCoordinateCandidates(decode(divisionFixture(120, '$camera', '$height'))), []);
});

function cameraConstructor(ownerAddress = 331784, reassignment = '') {
  return [
    '(func $allocate (param i32) (result i32) i32.const 4096)',
    `(func $constructor (param $owner i32) (local $heap i32)
      i32.const 258816
      call $allocate
      local.tee $heap
      local.get $owner
      i32.store
      local.get $heap
      i32.const 185632
      i32.add
      i32.const 54080
      i32.store
      ${reassignment}
      local.get $owner
      local.get $heap
      i32.store offset=536)`,
    `(func $startup i32.const ${ownerAddress} call $constructor)`
  ];
}

test('heap camera resolver follows constructor owner and rereadable pointer location', () => {
  for (const owner of [331784, 900000]) {
    const functions = decode(divisionFixture(1509292), ...cameraConstructor(owner));
    const [coordinate] = findCoordinateCandidates(functions);
    const candidates = findCameraPointerCandidates(functions, coordinate);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].pointerAddress, owner + 536);
    assert.equal(candidates[0].cameraOffset, 185632);
    assert.equal(candidates[0].cameraVtable, 54080);
  }
});

test('heap camera resolver preserves distinct owner candidates as ambiguity', () => {
  const functions = decode(divisionFixture(1509292), ...cameraConstructor(),
    '(func $anotherStartup i32.const 700000 call $constructor)');
  const [coordinate] = findCoordinateCandidates(functions);
  assert.equal(findCameraPointerCandidates(functions, coordinate).length, 2);
});

test('heap camera resolver rejects reassigned allocation locals', () => {
  const functions = decode(divisionFixture(1509292), ...cameraConstructor(331784, 'i32.const 99 local.set $heap'));
  const [coordinate] = findCoordinateCandidates(functions);
  assert.deepEqual(findCameraPointerCandidates(functions, coordinate), []);
});
