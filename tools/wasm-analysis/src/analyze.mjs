import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import wabtFactory from 'wabt';
import { findAbsoluteMemoryAccesses, readFunctions } from './instructions.mjs';
import { findCameraPointerCandidates, findCoordinateCandidates, findStaticCameraCandidates } from './patterns.mjs';
import { assertSeparateAnalysisPaths } from './paths.mjs';

const { values } = parseArgs({
  options: {
    wasm: { type: 'string' },
    js: { type: 'string' },
    out: { type: 'string', default: 'reports/wasm-analysis.txt' },
    wat: { type: 'string' },
    help: { type: 'boolean' }
  }
});

if (values.help || !values.wasm) {
  console.log('Usage: npm run analyze:wasm -- --wasm path/to/client.wasm [--js path/to/client.js] [--out reports/analysis.txt] [--wat .local/client.wat]');
  process.exitCode = values.help ? 0 : 1;
} else {
  await analyze(values);
}

async function analyze(options) {
  // Check every destination before producing either derived file.
  await assertSeparateAnalysisPaths(options);
  const bytes = await readFile(options.wasm);
  const jsBytes = options.js ? await readFile(options.js) : null;
  const wabt = await wabtFactory();
  const module = wabt.readWasm(bytes, { readDebugNames: true });
  let wat;
  try {
    module.generateNames();
    module.applyNames();
    wat = module.toText({ foldExprs: false, inlineExport: false });
  } finally {
    module.destroy();
  }
  const functions = readFunctions(wat);
  const coordinateCandidates = findCoordinateCandidates(functions);
  const references = functions.flatMap((fn) => findAbsoluteMemoryAccesses(fn.instructions).map((access) => ({ ...access, function: fn.name })));
  const layouts = [
    { name: 'Last active legacy enum (unverified for this binary)', addresses: [415160, 415164, 415168, 601600, 601604, 601608, 601612, 601616] },
    { name: 'Commented older legacy enum (unverified for this binary)', addresses: [1857464, 1857468, 1857472, 2043864, 2043868, 2043872, 2043876, 2043880] },
    { name: 'Oldest addresses in legacy comments (unverified for this binary)', addresses: [1871992, 1871996, 1872000, 2181104, 2181108, 2181112, 2181116, 2181120] }
  ];
  const output = [
    'DigDig static WASM inspection',
    '============================',
    '',
    `WASM file: ${path.resolve(options.wasm)}`,
    `WASM bytes: ${bytes.byteLength}`,
    `WASM SHA-256: ${sha256(bytes)}`,
    ...(jsBytes ? [`JavaScript file: ${path.resolve(options.js)}`, `JavaScript SHA-256: ${sha256(jsBytes)}`] : []),
    '',
    'Method: decode with WABT; inspect instructions without instantiating the module or running its JavaScript.',
    'WAT function names are generated for this file and are not stable identifiers across builds.',
    `Defined functions decoded: ${functions.length}`,
    '',
    'Memory declarations and exports:',
    ...wat.split('\n').filter((line) => /^  \(memory\b/.test(line) || /^  \(import\b.*\(memory\b/.test(line) || /^  \(export\b.*\(memory\b/.test(line)),
    '',
    'All export declarations:',
    ...wat.split('\n').filter((line) => /^  \(export\b/.test(line)),
    '',
    'Legacy coordinate address evidence:',
    'Counts below include only decoded loads with an immediately preceding i32.const base.',
    'An absent direct load does not prove an address is unused: pointers and computed addresses are possible.'
  ];

  for (const layout of layouts) {
    output.push('', layout.name);
    for (const address of layout.addresses) {
      const hits = references.filter((reference) => reference.address === address);
      const constants = functions.flatMap((fn) => fn.instructions.filter((instruction) => instruction.op === 'i32.const' && Number(instruction.operands[0]) === address).map(() => fn.name));
      output.push(`  ${address}: direct loads=${hits.length}, i32.const occurrences=${constants.length}; functions=${[...new Set([...hits.map((hit) => hit.function), ...constants])].slice(0, 16).join(', ') || '(none)'}`);
    }
  }

  output.push('', 'Decoded coordinate signature candidates:',
    'Pattern: viewport scale selection + camera scale + two origin-relative screen coordinates.',
    'Captures map addresses and local identifiers; checks neighboring x/y/size globals.',
    'Recognizes both archived reciprocal multiplication and current viewport division forms.',
    'Camera field offsets and viewport constants are constrained by those traced patterns.',
    `Candidate count: ${coordinateCandidates.length}`);
  for (const candidate of coordinateCandidates) {
    output.push(`  ${JSON.stringify(candidate)}`);
    const pointers = findCameraPointerCandidates(functions, candidate);
    output.push(`  Constructor-derived camera pointer candidates: ${pointers.length}`);
    for (const pointer of pointers) output.push(`    ${JSON.stringify(pointer)}`);
    const statics = findStaticCameraCandidates(functions, candidate);
    output.push(`  Constructor-derived static camera candidates: ${statics.length}`);
    for (const camera of statics) output.push(`    ${JSON.stringify(camera)}`);
    const fn = functions.find((entry) => entry.name === candidate.function);
    output.push('  Evidence excerpt:');
    for (const instruction of fn.instructions.slice(candidate.instruction, candidate.instruction + 59)) output.push(`    ${instruction.text}`);
  }
  output.push(coordinateCandidates.length === 1
    ? 'Status: one static coordinate candidate; require a unique camera resolver and runtime confirmation before accepting a new build.'
    : 'Status: unsupported/ambiguous; do not select offsets automatically.');

  if (sha256(bytes) === 'f33b4b100c2b520eecbe3012a0125385975fc64f7c45864086ce7258ed471ff2') {
    output.push('', 'Additional manually traced evidence for this exact archived SHA-256:',
      '  $f1088 and exported $ag call $f844 with i32.const 1857672.',
      '  $f844 constructs a camera subobject at parameter + 186184 (vtable address 49340).',
      '  $f3418 subtracts 186184 from its camera parameter to access the enclosing object.',
      '  Therefore the reference camera base is 1857672 + 186184 = 2043856.',
      '  Reference fields: x=2043864, y=2043868, scale=2043872, width=2043876, height=2043880.',
      '  This supports the commented enum, not the last active enum or the oldest comment values.',
      '  $f3418 confirms (origin - camera) * scale + viewport / 2 using f32/f64 conversions.',
      '  The exact normalized-position division formula has not been independently located.',
      '  The loader assigns memory from m.asm.Lf; m.asm.Mf is a startup function.',
      '  These numbers describe only this archived binary, never the current game.');
  }

  if (sha256(bytes) === '8ff0e9d2bc58c6f9c52ef4fe2ee99173aa577bd51dc264cbef0b02e1f298f58d') {
    output.push('', 'Additional manually traced evidence for this exact current SHA-256:',
      '  $f2510 passes map radius * viewport scale to $f474, which emits canvas opcode 31.',
      '  client.js opcode 31 calls CanvasRenderingContext2D.arc, confirming radius semantics.',
      '  Camera coordinates can be smoothed or spectating; live movement still needs visual validation.',
      '  $f1407/$f1409 allocate 64x64 terrain canvases.',
      '  $f1375 reads terrain grid indices as u16 at chunk offsets 2572/2574 and shifts each left by 10.',
      '  It calls $f586 with x=gridX*1024-1, y=gridY*1024-1, width=height=1026.',
      '  $f586 emits opcode 35; client.js draws the source canvas with those four rectangle arguments.',
      '  Grid spacing is therefore 1024 world units; the 1026 drawing rectangle overlaps adjacent chunks.',
      '  The old assumption drawImage(source,0,0,1,1) is not sufficient for this build.',
      '  See reports/current-game-layout.json for the exact-hash manifest and runtime-validation status.');
  }

  output.push('', 'Arithmetic neighborhoods touching legacy addresses (bounded excerpts):');
  const knownAddresses = new Set(layouts.flatMap((layout) => layout.addresses));
  let excerptCount = 0;
  for (const fn of functions) {
    const relevant = findAbsoluteMemoryAccesses(fn.instructions).filter((access) => knownAddresses.has(access.address));
    const starts = relevant.filter((access) => fn.instructions.slice(Math.max(0, access.index - 5), access.index + 15).some(({ op }) => op === 'f32.sub' || op === 'f32.div' || op === 'f32.mul')).slice(0, 2);
    for (const access of starts) {
      output.push('', `  ${fn.name}, instruction ${access.index}, absolute ${access.op} address ${access.address}`);
      for (const instruction of fn.instructions.slice(Math.max(0, access.index - 5), access.index + 15)) output.push(`    ${instruction.text}`);
      if (++excerptCount >= 14) break;
    }
    if (excerptCount >= 14) break;
  }
  if (!excerptCount) output.push('  No direct-address arithmetic neighborhoods matched these reference layouts.');

  if (jsBytes) {
    const source = jsBytes.toString('utf8');
    output.push('', 'Loader evidence (bounded excerpts):');
    for (const term of ['.asm.Lf', '.asm.Mf', 'instantiateStreaming', 'client.wasm']) {
      const index = source.indexOf(term);
      output.push(`  ${term}: ${index < 0 ? '(not found)' : source.slice(Math.max(0, index - 65), index + term.length + 95).replace(/\s+/g, ' ')}`);
    }
    output.push(`  Archive wrapper detected: ${source.includes('_____WB$wombat$assign$function_____')}`);
  }

  output.push('', 'Interpretation and next step:',
    'A sequence such as "48 8D 05 ?? ?? ?? ?? 48 89 01" describes x86 machine code, not portable WASM instructions.',
    'WASM operands use variable-length LEB128 encoding; address changes can change instruction byte lengths.',
    'Match decoded opcode structure with captured addresses/local relationships, then require a unique candidate and runtime validation.',
    'A shared arithmetic sequence alone is not a proof of semantic meaning or a stable cross-version signature.',
    'Use the archived binary as a labelled reference; compare a current JS/WASM pair before claiming current offsets.',
    'Validate candidate coordinates against movement, zoom, resize, map origin and map-size observations.',
    'Never silently choose the first match when zero or multiple candidates remain.', '');

  // Disassembly can take time: recheck aliases immediately before writing.
  await assertSeparateAnalysisPaths(options);
  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await writeFile(options.out, output.join('\n'));
  if (options.wat) {
    await mkdir(path.dirname(path.resolve(options.wat)), { recursive: true });
    await writeFile(options.wat, wat);
  }
  console.log(`Static inspection written to ${path.resolve(options.out)}`);
  console.log(`WASM SHA-256: ${sha256(bytes)}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
