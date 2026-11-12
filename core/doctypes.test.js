import test from 'node:test';
import assert from 'node:assert/strict';
import { docTypesOf, storedTypes, profileTypeOf, pageTypeOf } from './doctypes.js';

test('before anything is stored, earlier settings give the types', () => {
  const types = docTypesOf(undefined, {
    clip: { mode: 'off', articlePath: ' old/../web ' },
    templates: [{ id: 'paper', sites: [] }, { id: 'c1', name: ' Blogs ', text: '# x' }],
  });
  assert.deepEqual(types.map((x) => [x.id, x.builtin, x.name, x.autoClip, x.clipPath]), [
    ['paper', true, '', false, ''], ['article', true, '', false, 'old/web'], ['c1', false, 'Blogs', false, ''],
  ]);
  assert.deepEqual(docTypesOf(undefined).map((x) => x.autoClip), [true, false], 'papers clip by default');
});

test('stored types always include both built-in ones, first', () => {
  const types = docTypesOf([{ id: 'x', name: 'X', autoClip: true }, { id: 'article', clipPath: 'a' }]);
  assert.deepEqual(types.map((x) => x.id), ['paper', 'article', 'x']);
  assert.deepEqual(storedTypes(types), [
    { id: 'paper', autoClip: true, clipPath: '' }, { id: 'article', autoClip: false, clipPath: 'a' },
    { id: 'x', name: 'X', autoClip: true, clipPath: '' },
  ]);
});

test('one switch per type: a second one an earlier version stored is dropped', () => {
  const types = docTypesOf([{ id: 'paper', autoClip: false, reviewClip: true }, { id: 'article', autoClip: true, reviewClip: false }]);
  assert.deepEqual(types.map((x) => [x.id, x.autoClip]), [['paper', false], ['article', true]]);
  assert.ok(types.every((x) => !('reviewClip' in x)));
  assert.ok(storedTypes(types).every((x) => !('reviewClip' in x)));
});

test('a config\'s type: the general one with articles, others where put, else papers', () => {
  const types = docTypesOf([{ id: 'x', name: 'X' }]);
  assert.equal(profileTypeOf({ name: 'web-article', fallback: true }, { 'web-article': 'x' }, types), 'article');
  assert.equal(profileTypeOf({ name: 'a' }, { a: 'x' }, types), 'x');
  assert.equal(profileTypeOf({ name: 'a' }, { a: 'gone' }, types), 'paper');
  assert.equal(profileTypeOf({ name: 'a' }, {}, types, { a: { template: 'x' } }), 'x', 'an earlier template link');
});

test('a page\'s type: its config\'s, else paper or article', () => {
  const types = docTypesOf([{ id: 'x', name: 'X' }]);
  assert.deepEqual(pageTypeOf({ profile: { name: 'a' }, isPaper: false }, { a: 'x' }, types), { id: 'x', matched: true });
  assert.deepEqual(pageTypeOf({ profile: { name: 'w', fallback: true }, isPaper: false }, {}, types), { id: 'article', matched: false });
  assert.deepEqual(pageTypeOf({ profile: null, isPaper: true }, {}, types), { id: 'paper', matched: false });
  assert.deepEqual(pageTypeOf({ profile: { name: 'a' }, discussion: 'GPT' }, { a: 'x' }, types), { id: 'paper', matched: false });
});
