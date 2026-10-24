const PLUGIN_NAME = 'UserscriptPlugin';
const FLAGS = new Set(['noframes', 'unwrap']);
const RUN_AT = new Set(['document-start', 'document-body', 'document-end', 'document-idle', 'context-menu']);
const SANDBOXES = new Set(['raw', 'JavaScript', 'DOM']);
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*(?::[a-zA-Z0-9-]+)?$/;
const INVALID_TEXT = /[\r\n\u0000\u2028\u2029]|==\/?UserScript==/;

/** @typedef {Record<string, string | string[] | boolean>} UserscriptMetadata */

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateText(value, key) {
  if (typeof value !== 'string' || value.trim().length === 0 || INVALID_TEXT.test(value)) {
    throw new TypeError(`Invalid userscript metadata value for "${key}": expected a nonempty, single-line string.`);
  }
  if (key === 'run-at' && !RUN_AT.has(value)) {
    throw new TypeError(`Invalid userscript run-at value: ${value}`);
  }
  if (key === 'sandbox' && !SANDBOXES.has(value)) {
    throw new TypeError(`Invalid userscript sandbox value: ${value}`);
  }
}

/**
 * Render a complete metadata block. Name is always first; other keys preserve
 * insertion order. Arrays produce repeated tags and boolean flags have no value.
 * @param {UserscriptMetadata} metadata
 * @returns {string}
 */
export function renderMetadata(metadata) {
  if (!isRecord(metadata)) {
    throw new TypeError('Userscript metadata must be a plain object.');
  }
  for (const key of ['name', 'version']) {
    if (!Object.hasOwn(metadata, key) || typeof metadata[key] !== 'string') {
      throw new TypeError(`Userscript metadata requires a string "${key}".`);
    }
  }
  const entries = Object.entries(metadata);
  entries.sort(([a], [b]) => (a === 'name' ? -1 : b === 'name' ? 1 : 0));
  const lines = ['// ==UserScript=='];
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) {
      throw new TypeError(`Invalid userscript metadata key: ${key}`);
    }
    if (FLAGS.has(key)) {
      if (typeof value !== 'boolean') {
        throw new TypeError(`Userscript metadata flag "${key}" must be a boolean.`);
      }
      if (value) lines.push(`// @${key}`);
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) {
      throw new TypeError(`Userscript metadata array "${key}" must not be empty.`);
    }
    if (['name', 'version', 'namespace', 'run-at', 'sandbox'].includes(key) && Array.isArray(value)) {
      throw new TypeError(`Userscript metadata "${key}" must be a single string.`);
    }
    for (const entry of values) {
      validateText(entry, key);
      lines.push(`// @${key} ${entry}`);
    }
  }
  lines.push('// ==/UserScript==', '');
  return lines.join('\n');
}

/** Prepend metadata to selected webpack JavaScript assets. */
export class UserscriptPlugin {
  /**
   * @param {{metadata: UserscriptMetadata, include?: RegExp}} options
   */
  constructor(options) {
    if (!isRecord(options) || Object.keys(options).some((key) => !['metadata', 'include'].includes(key))) {
      throw new TypeError('UserscriptPlugin expects { metadata, include?: RegExp }.');
    }
    if (options.include !== undefined && !(options.include instanceof RegExp)) {
      throw new TypeError('UserscriptPlugin include must be a RegExp.');
    }
    this.header = renderMetadata(options.metadata);
    this.include = options.include ? new RegExp(options.include.source, options.include.flags) : /\.user\.js$/;
  }

  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          // Terser has already run, while source-map generation still follows.
          // This keeps metadata intact and lets maps account for the prefix.
          stage: Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING - 1,
        },
        () => {
          for (const asset of compilation.getAssets()) {
            this.include.lastIndex = 0;
            if (!this.include.test(asset.name)) continue;
            compilation.updateAsset(asset.name, new sources.ConcatSource(this.header, asset.source));
          }
        },
      );
    });
  }
}

export default UserscriptPlugin;
