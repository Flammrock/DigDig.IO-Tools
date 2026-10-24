import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMetadata, UserscriptPlugin } from '../src/index.mjs';

const required = { name: 'DigDig development', version: '0.1.0' };

test('renders a metadata block with repeated grants, localized text, and flags', () => {
  const header = renderMetadata({
    version: '0.1.0',
    name: 'DigDig development',
    'name:fr': 'Développement DigDig',
    match: ['https://digdig.io/*', 'http://127.0.0.1/*'],
    grant: ['GM_xmlhttpRequest', 'unsafeWindow'],
    connect: ['127.0.0.1'],
    'run-at': 'document-start',
    sandbox: 'JavaScript',
    noframes: true,
    unwrap: false,
  });
  assert.equal(header.split('\n')[1], '// @name DigDig development');
  assert.equal((header.match(/\/\/ @match /g) ?? []).length, 2);
  assert.equal((header.match(/\/\/ @grant /g) ?? []).length, 2);
  assert.ok(header.includes('// @name:fr Développement DigDig\n'));
  assert.ok(header.includes('// @noframes\n'));
  assert.ok(!header.includes('@unwrap'));
  assert.ok(header.endsWith('// ==/UserScript==\n'));
});

test('rejects metadata that can inject tags or close the header', () => {
  for (const value of ['A\n// @grant none', 'A\rB', 'A\u2028B', 'A\0B', '==/UserScript==']) {
    assert.throws(() => renderMetadata({ ...required, description: value }), TypeError);
  }
  for (const key of ['@grant', 'match\n// @grant', 'foo bar', '__proto__']) {
    assert.throws(() => renderMetadata({ ...required, [key]: 'none' }), TypeError);
  }
});

test('rejects invalid values and required metadata omissions', () => {
  for (const metadata of [
    null,
    [],
    {},
    { name: 'x' },
    { ...required, name: '' },
    { ...required, version: 1 },
    { ...required, grant: [] },
    { ...required, grant: [null] },
    { ...required, grant: true },
    { ...required, noframes: 'true' },
    { ...required, sandbox: 'isolated' },
    { ...required, 'run-at': 'immediately' },
    { ...required, 'run-at': ['document-start'] },
  ]) {
    assert.throws(() => renderMetadata(metadata), TypeError);
  }
});

test('validates plugin options at construction', () => {
  for (const options of [undefined, null, [], { metadata: required, include: '*.js' }, { metadata: required, typo: true }]) {
    assert.throws(() => new UserscriptPlugin(options), TypeError);
  }
  assert.doesNotThrow(() => new UserscriptPlugin({ metadata: required }));
});
