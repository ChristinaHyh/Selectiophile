import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, mergeBackup, backupFileName } from './backup.js';

const highlight = (over = {}) => ({ id: 'a', anchor: 'text', prefix: 'p', suffix: 's', color: 'blue', noteName: 'N.md', heading: 'H', ...over });
const storage = {
  jevKey: 'SECRET',
  noteIndex: { 'N.md': {} },
  settings: { pinned: 'N.md' },
  lastNote: 'N.md',
  sites: ['*.nature.com'],
  blockedSites: ['*.spam.org'],
  siteMode: 'blacklist',
  toolbarStyle: 'lite',
  dashboard: { auto: false, name: 'board' },
  shortcuts: { save: 'Alt+X' },
  discussionRounds: 3,
  showHighlights: false,
  showFab: false,
  autoSavePercent: 75,
  templates: [{ id: 'article', sites: ['*.x.com'] }],
  discussions: { 'chatgpt.com/c/1': { notes: ['N.md'], at: 1 } },
  lang: 'en',
  templateText: '# T',
  profiles: [{ name: 'p', triggers: ['x'], properties: [] }],
  theme: 'lagoon',
  colors: { blue: '方法论' },
  bindings: { 'doi:10.1/x': 'N.md' },
  entries: { a: { noteName: 'N.md', at: 1 } },
  'hl:https://x.org/a': { a: highlight() },
};

test('backup holds highlights and settings, never the key or caches', () => {
  const { data, app, version } = buildBackup(storage, new Date(2026, 10, 5));
  assert.equal(app, 'selectiophile');
  assert.equal(version, 1);
  assert.deepEqual(Object.keys(data).sort(), ['autoSavePercent', 'bindings', 'blockedSites', 'colors', 'dashboard', 'discussionRounds', 'discussions', 'entries', 'hl:https://x.org/a', 'lang', 'profiles', 'shortcuts', 'showFab', 'showHighlights', 'siteMode', 'sites', 'templateText', 'templates', 'theme', 'toolbarStyle']);
  assert.ok(!JSON.stringify(data).includes('SECRET'));
  assert.equal(data['hl:https://x.org/a'].a.color, 'blue');
});

test('file name carries the date', () => {
  assert.equal(backupFileName(new Date(2026, 0, 5)), 'selectiophile-backup-2026-01-05.json');
});

test('a backup survives a round trip into empty storage', () => {
  const { data } = parseBackup(JSON.stringify(buildBackup(storage)));
  const { patch, highlights } = mergeBackup({}, data);
  assert.equal(highlights, 1);
  assert.deepEqual(patch['hl:https://x.org/a'], storage['hl:https://x.org/a']);
  assert.deepEqual(patch.bindings, storage.bindings);
  assert.equal(patch.theme, 'lagoon');
});

test('foreign, broken and future files are refused', () => {
  assert.throws(() => parseBackup('not json'), (e) => e.code === 'bad-json');
  assert.throws(() => parseBackup('{"app":"other","data":{}}'), (e) => e.code === 'not-backup');
  // Made before the rename to Selectiophile.
  assert.equal(parseBackup(JSON.stringify({ app: 'lectiophile', version: 1, data: { lang: 'en' } })).data.lang, 'en');
  assert.throws(() => parseBackup('{"app":"selectiophile","version":99,"data":{}}'), (e) => e.code === 'bad-version' && e.version === 99);
});

test('unknown keys and malformed records are dropped', () => {
  const { data } = parseBackup(JSON.stringify({
    app: 'selectiophile',
    version: 1,
    data: {
      jevKey: 'INJECTED',
      settings: { pinned: 'x' },
      sites: ['*.ok.org', 'not a rule!', 3],
      'hl:u': { good: highlight(), bad: { anchor: 5 }, worse: null },
      pending: { good: { quote: 'q', page: {} }, bad: { quote: 'q' } },
      entries: { bad: { noteName: 1 } },
      colors: { blue: 'x', red: 4 },
      theme: 7,
    },
  }));
  assert.deepEqual(Object.keys(data).sort(), ['colors', 'entries', 'hl:u', 'pending', 'sites']);
  assert.deepEqual(data.sites, ['*.ok.org']);
  assert.deepEqual(Object.keys(data['hl:u']), ['good']);
  assert.deepEqual(Object.keys(data.pending), ['good']);
  assert.deepEqual(data.entries, {});
  assert.deepEqual(data.colors, { blue: 'x' });
});

test('malformed settings are dropped, false and zero are kept', () => {
  const { data } = parseBackup(JSON.stringify({ app: 'selectiophile', version: 1, data: {
    dashboard: { auto: 'yes' }, shortcuts: { save: 5 }, discussionRounds: 99, showHighlights: false,
  } }));
  assert.deepEqual(data, { showHighlights: false });
  const zero = parseBackup(JSON.stringify({ app: 'selectiophile', version: 1, data: { discussionRounds: 0 } }));
  assert.equal(mergeBackup({ discussionRounds: 5 }, zero.data).patch.discussionRounds, 0);
});

test('merging keeps newer local records and removes nothing', () => {
  const current = {
    sites: ['*.a.org'],
    colors: { blue: '本地', red: '质疑' },
    bindings: { k1: 'local.md' },
    'hl:u': { x: highlight({ id: 'x', color: 'red' }) },
  };
  const { patch, highlights } = mergeBackup(current, {
    sites: ['*.a.org', '*.b.org'],
    colors: { blue: '备份' },
    bindings: { k1: 'old.md', k2: 'other.md' },
    'hl:u': { x: highlight({ id: 'x', color: 'green' }), y: highlight({ id: 'y' }) },
  });
  assert.deepEqual(patch.sites, ['*.a.org', '*.b.org']);
  assert.deepEqual(patch.colors, { blue: '备份', red: '质疑' });
  assert.deepEqual(patch.bindings, { k1: 'local.md', k2: 'other.md' });
  assert.equal(patch['hl:u'].x.color, 'red');
  assert.ok(patch['hl:u'].y);
  assert.equal(highlights, 1);
});
