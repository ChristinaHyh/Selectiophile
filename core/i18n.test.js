import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import './i18n.js';

const { EN, t, setLang, resolveLang } = globalThis.SelectiophileI18n;
const root = new URL('..', import.meta.url);

const FILES = ['background.js', 'content/content.js', 'core/service.js', 'core/theme.js',
  ...['options', 'popup'].flatMap((d) => readdirSync(new URL(`${d}/`, root)).filter((f) => /\.(js|html)$/.test(f)).map((f) => `${d}/${f}`))];

test('every translated string has an English version', () => {
  const missing = [];
  for (const file of FILES) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const m of text.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) if (!(m[1] in EN)) missing.push(`${file}: ${m[1]}`);
    for (const m of text.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]*)"/g)) {
      const key = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (!(key in EN)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('no untranslated Chinese is left in the interface code', () => {
  const found = [];
  for (const file of ['content/content.js', 'popup/popup.js', 'options/options.js']) {
    for (const [i, line] of readFileSync(new URL(file, root), 'utf8').split('\n').entries()) {
      const code = line.replace(/\bt\('(?:[^'\\]|\\.)*'/g, '').replace(/\/\/.*$/, '');
      if (/[㐀-鿿]/.test(code)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(found, []);
});

test('translation, interpolation and fallback', () => {
  setLang('en');
  assert.equal(t('取消'), 'Cancel');
  assert.equal(t('文件夹：{name}', { name: 'X' }), 'Folder: X');
  assert.equal(t('not in the table'), 'not in the table');
  setLang('zh');
  assert.equal(t('取消'), '取消');
  assert.equal(t('文件夹：{name}', { name: 'X' }), '文件夹：X');
});

test('an explicit language wins, otherwise the browser decides', () => {
  assert.equal(resolveLang('en', 'zh-CN'), 'en');
  assert.equal(resolveLang('zh', 'en-US'), 'zh');
  assert.equal(resolveLang(undefined, 'zh-CN'), 'zh');
  assert.equal(resolveLang(undefined, 'en-US'), 'en');
  assert.equal(resolveLang(undefined, 'de'), 'en');
});
