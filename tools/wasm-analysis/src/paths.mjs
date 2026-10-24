import { readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

function comparable(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Resolve existing symlinks, including parents of outputs that do not exist yet. */
async function canonicalPath(filePath, depth = 0) {
  if (depth > 64) throw new Error(`Too many symbolic links while resolving ${filePath}`);
  try {
    return await realpath(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // A dangling output symlink can alias another not-yet-created output.
  try {
    const target = await readlink(filePath);
    return canonicalPath(path.resolve(path.dirname(filePath), target), depth + 1);
  } catch (error) {
    if (!['EINVAL', 'ENOENT'].includes(error.code)) throw error;
  }
  const parent = path.dirname(filePath);
  if (parent === filePath) throw new Error(`Cannot resolve filesystem root ${filePath}`);
  return path.join(await canonicalPath(parent, depth + 1), path.basename(filePath));
}

async function inspectPath(label, filePath) {
  const absolute = path.resolve(filePath);
  let identity;
  try {
    identity = await stat(absolute, { bigint: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    label,
    absolute: comparable(absolute),
    canonical: comparable(await canonicalPath(absolute)),
    identity,
  };
}

function aliases(left, right) {
  return left.absolute === right.absolute || left.canonical === right.canonical
    || (left.identity?.ino > 0n && right.identity?.ino > 0n
      && left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino);
}

/** All derived output must stay separate from the original JS/WASM inputs. */
export async function assertSeparateAnalysisPaths({ wasm, js, out, wat }) {
  const [inputs, outputs] = await Promise.all([
    Promise.all([['--wasm', wasm], ['--js', js]].filter(([, value]) => value !== undefined)
      .map(([label, value]) => inspectPath(label, value))),
    Promise.all([['--out', out], ['--wat', wat]].filter(([, value]) => value !== undefined)
      .map(([label, value]) => inspectPath(label, value))),
  ]);
  for (const output of outputs) {
    for (const input of inputs) {
      if (aliases(output, input)) {
        throw new Error(`${output.label} aliases ${input.label}; analysis must never overwrite original game inputs.`);
      }
    }
    if ([output.absolute, output.canonical].some((filePath) => path.extname(filePath).toLowerCase() === '.wasm')) {
      throw new Error(`${output.label} must not target a .wasm file; analysis outputs are derived text only.`);
    }
  }
  for (let index = 0; index < outputs.length; index++) {
    for (const other of outputs.slice(index + 1)) {
      if (aliases(outputs[index], other)) {
        throw new Error(`${outputs[index].label} aliases ${other.label}; report and WAT output paths must be distinct.`);
      }
    }
  }
}
