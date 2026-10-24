import assert from 'node:assert/strict';
import test from 'node:test';
import { findAbsoluteMemoryAccesses, findInstructionSequences, readFunctions } from '../src/instructions.mjs';

test('instruction patterns bind changing addresses and require repeated operands to agree', () => {
  const instructions = [
    { op: 'i32.const', operands: ['500000'] },
    { op: 'f32.load', operands: ['offset=8'] },
    { op: 'i32.const', operands: ['500000'] },
    { op: 'f32.load', operands: ['offset=12'] },
    { op: 'f32.sub', operands: [] }
  ];
  const pattern = [
    { op: 'i32.const', operands: ['$capture:base'] },
    { op: 'f32.load', operands: ['offset=8'] },
    { op: 'i32.const', operands: ['$capture:base'] },
    { op: 'f32.load', operands: ['offset=12'] },
    { op: 'f32.sub' }
  ];
  assert.deepEqual(findInstructionSequences(instructions, pattern), [
    { start: 0, end: 5, captures: { base: '500000' } }
  ]);
  instructions[2].operands[0] = '600000';
  assert.deepEqual(findInstructionSequences(instructions, pattern), []);
});

test('loads with dynamic bases are not misreported as absolute memory locations', () => {
  const instructions = [
    { op: 'i32.const', operands: ['1000'] },
    { op: 'f32.load', operands: ['offset=8', 'align=1'] },
    { op: 'local.get', operands: ['$p0'] },
    { op: 'f32.load', operands: ['offset=12'] }
  ];
  assert.deepEqual(findAbsoluteMemoryAccesses(instructions), [
    { index: 1, op: 'f32.load', base: 1000, displacement: 8, address: 1008 }
  ]);
});

test('function extraction stops before data sections and ignores declarations', () => {
  const functions = readFunctions(`(module
  (func $f1 (param $p0 i32)
    (local $l1 f32)
    local.get $p0
    f32.load offset=4)
  (memory $m0 1)
  (data (i32.const 0) "(func $fake)"))`);
  assert.equal(functions.length, 1);
  assert.equal(functions[0].name, '$f1');
  assert.deepEqual(functions[0].instructions.map(({ op }) => op), ['local.get', 'f32.load']);
});
