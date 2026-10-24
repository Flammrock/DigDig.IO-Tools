/** Split WABT's unfolded text at module-level declarations. */
export function readFunctions(wat) {
  const headings = [...wat.matchAll(/^  \((\w+)(?:\s+(\$[^\s()]+))?/gm)];
  return headings.flatMap((heading, index) => {
    if (heading[1] !== 'func') return [];
    const text = wat.slice(heading.index, headings[index + 1]?.index ?? wat.length);
    const instructions = text.split('\n').slice(1).flatMap((line) => {
      const clean = line.trim().replace(/\(;.*?;\)/g, '').replace(/\s*;;.*$/, '').replace(/\)+$/, '').trim();
      if (!clean || clean.startsWith('(')) return [];
      const [op, ...operands] = clean.split(/\s+/);
      return [{ op, operands, text: clean }];
    });
    return [{ name: heading[2] ?? '(unnamed)', text, instructions }];
  });
}

/** Match decoded operations; captures bind operands rather than raw bytes. */
export function findInstructionSequences(instructions, pattern) {
  const matches = [];
  for (let start = 0; start <= instructions.length - pattern.length; start++) {
    if (pattern.length && instructions[start].op !== pattern[0].op) continue;
    if (pattern.length > 1 && instructions[start + 1].op !== pattern[1].op) continue;
    const captures = {};
    let matched = true;
    for (let step = 0; step < pattern.length && matched; step++) {
      const expected = pattern[step];
      const actual = instructions[start + step];
      if (actual.op !== expected.op) {
        matched = false;
        break;
      }
      const bind = (value, operand) => {
          if (value === '*') return true;
          if (value.startsWith('$capture:')) {
            const name = value.slice('$capture:'.length);
            if (Object.hasOwn(captures, name)) return captures[name] === operand;
            captures[name] = operand;
            return true;
          }
          return value === operand;
      };
      if (expected.operands) {
        matched = expected.operands.length === actual.operands.length
          && expected.operands.every((value, index) => bind(value, actual.operands[index]));
      }
      if (matched && expected.memoryOffset !== undefined) {
        // WABT omits zero offsets and natural alignment. Capture the decoded
        // displacement independently of those harmless printing choices.
        const offset = actual.operands.find(value => value.startsWith('offset='));
        matched = actual.operands.every(value => /^(offset|align)=\d+$/.test(value))
          && bind(String(expected.memoryOffset), offset?.slice(7) ?? '0');
      }
    }
    if (matched) matches.push({ start, end: start + pattern.length, captures });
  }
  return matches;
}

/** Only infer absolute addresses when the load has an immediate constant base. */
export function findAbsoluteMemoryAccesses(instructions) {
  const accesses = [];
  for (let index = 1; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (!/^(?:i32|i64|f32|f64)\.load(?:8_[su]|16_[su]|32_[su])?$/.test(instruction.op)) continue;
    const previous = instructions[index - 1];
    if (previous.op !== 'i32.const' || !/^-?\d+$/.test(previous.operands[0] ?? '')) continue;
    const offset = instruction.operands.find((operand) => operand.startsWith('offset='));
    const base = Number(previous.operands[0]);
    const displacement = offset ? Number(offset.slice('offset='.length)) : 0;
    accesses.push({ index, op: instruction.op, base, displacement, address: (base >>> 0) + displacement });
  }
  return accesses;
}
