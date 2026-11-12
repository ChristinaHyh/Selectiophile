import test from 'node:test';
import assert from 'node:assert/strict';
import './combo.js';

const { comboFromEvent, shortcutsOf } = globalThis.SelectiophileCombo;
const key = (over) => ({ code: '', key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

test('combos are built from physical keys, so Alt+S works on a Mac too', () => {
  assert.equal(comboFromEvent(key({ code: 'KeyS', key: 'ß', altKey: true })), 'Alt+S');
  assert.equal(comboFromEvent(key({ code: 'Digit1', key: '1', ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+1');
  assert.equal(comboFromEvent(key({ code: 'F2', key: 'F2' })), 'F2');
  assert.equal(comboFromEvent(key({ code: 'AltLeft', key: 'Alt', altKey: true })), '', 'a modifier alone is not a shortcut');
});

test('defaults apply until changed, and a cleared shortcut stays cleared', () => {
  assert.deepEqual(shortcutsOf(undefined), { save: 'Alt+S', comment: 'Alt+C', review: 'Alt+R' });
  assert.deepEqual(shortcutsOf({ save: 'Alt+X' }), { save: 'Alt+X', comment: 'Alt+C', review: 'Alt+R' });
  assert.equal(shortcutsOf({ comment: '' }).comment, '');
});
