import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardFileName, syncDashboard, scanNotes, cleanFolderPath, listFolders } from './vault.js';
import { dashboardMarkdown, earlierDashboards } from './dashboard.js';

function memoryDir(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async getFileHandle(name, { create } = {}) {
      if (!files.has(name) && !create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      if (!files.has(name)) files.set(name, '');
      return {
        getFile: async () => ({ lastModified: 1, text: async () => files.get(name) }),
        createWritable: async () => {
          let buffered = '';
          return { write: async (t) => { buffered = t; }, close: async () => { files.set(name, buffered); }, abort: async () => {} };
        },
      };
    },
    async *entries() {
      for (const name of files.keys()) yield [name, { kind: 'file', getFile: async () => ({ lastModified: 1, text: async () => files.get(name) }) }];
    },
  };
}

test('subfolder paths stay inside the chosen folder', () => {
  assert.equal(cleanFolderPath('papers/2026'), 'papers/2026');
  assert.equal(cleanFolderPath(' /papers\\\\2026/ '), 'papers/2026');
  assert.equal(cleanFolderPath('文献 / 综述'), '文献/综述');
  assert.equal(cleanFolderPath('../../etc'), 'etc');
  assert.equal(cleanFolderPath('.obsidian/x'), 'x');
  assert.equal(cleanFolderPath('a:b*c'), 'a b c');
  assert.equal(cleanFolderPath(''), '');
  assert.equal(cleanFolderPath(undefined), '');
  assert.equal(cleanFolderPath('../..'), '');
});

test('file names come from what was typed, with a safe fallback', () => {
  assert.equal(dashboardFileName(), '_dashboard.md');
  assert.equal(dashboardFileName('  '), '_dashboard.md');
  assert.equal(dashboardFileName('我的看板'), '我的看板.md');
  assert.equal(dashboardFileName('board.md'), 'board.md');
  assert.equal(dashboardFileName('a/b:c'), 'a b c.md');
  assert.equal(dashboardFileName('...'), '_dashboard.md');
});

const zh = dashboardMarkdown({ lang: 'zh' });
const en = dashboardMarkdown({ lang: 'en' });
const generated = () => [...earlierDashboards(), zh, en];

test('a deleted dashboard comes back, under the custom name', async () => {
  const dir = memoryDir();
  assert.equal(await syncDashboard(dir, zh, '看板.md', generated()), 'created');
  assert.equal(dir.files.get('看板.md'), zh);
  dir.files.delete('看板.md');
  assert.equal(await syncDashboard(dir, zh, '看板.md', generated()), 'created');
  assert.ok(dir.files.has('看板.md'));
});

test('a generated dashboard follows the layout and language, but an edited one is kept', async () => {
  const dir = memoryDir();
  await syncDashboard(dir, zh, undefined, generated());
  assert.equal(await syncDashboard(dir, zh, undefined, generated()), 'same');
  assert.equal(await syncDashboard(dir, en, undefined, generated()), 'updated');
  assert.equal(dir.files.get('_dashboard.md'), en);
  const edited = memoryDir({ '_dashboard.md': '# my own' });
  assert.equal(await syncDashboard(edited, en, undefined, generated()), 'kept');
  assert.equal(edited.files.get('_dashboard.md'), '# my own');
  // Asked to replace it: done.
  assert.equal(await syncDashboard(edited, en, undefined, null), 'updated');
  assert.equal(edited.files.get('_dashboard.md'), en);
});

test('dashboards of earlier versions, named Lectiophile or not, move to the new layout', async () => {
  const titled = '# Lectiophile 看板\n\n```dataview\nTABLE WITHOUT ID file.link AS "笔记", last_annotated AS "最近添加", journal AS "来源"\nWHERE startswith(file.folder, this.file.folder) AND last_annotated\nSORT last_annotated DESC\nLIMIT 30\n```\n';
  const dir = memoryDir({ '_Dashboard.md': titled });
  assert.equal(await syncDashboard(dir, zh, undefined, generated()), 'updated');
  assert.deepEqual([...dir.files.keys()], ['_Dashboard.md'], 'found rather than twinned');
  assert.equal(dir.files.get('_Dashboard.md'), zh);
  // The one before layouts could be changed: one table whose source was plain text.
  const untitled = '```dataview\nTABLE WITHOUT ID file.link AS "Note", dateformat(last_annotated, "yyyy-MM-dd HH:mm") AS "Last annotated", default(journal, site) AS "Source"\nWHERE last_annotated\nSORT last_annotated DESC\nLIMIT 30\n```\n';
  const before = memoryDir({ '_dashboard.md': untitled });
  assert.equal(await syncDashboard(before, en, undefined, generated()), 'updated');
  assert.equal(before.files.get('_dashboard.md'), en);
});

test('a dashboard with a custom name is never treated as a note', async () => {
  const dir = memoryDir({ '看板.md': '# x', 'Real.md': '# y' });
  assert.deepEqual(Object.keys(await scanNotes(dir, {}, { dashboardName: '看板.md' })), ['Real.md']);
  assert.deepEqual(Object.keys(await scanNotes(dir)).sort(), ['Real.md', '看板.md']);
});

test('a subfolder that can\'t be read leaves the rest of the list', async () => {
  const folder = (name, children = [], broken = false) => ({
    kind: 'directory', name,
    async *entries() {
      if (broken) throw Object.assign(new Error('could not be read'), { name: 'NotReadableError' });
      for (const c of children) yield [c.name, c];
    },
  });
  const vault = folder('vault', [
    folder('papers', [folder('2026')]), folder('OneDrive link', [], true), folder('.obsidian', [folder('plugins')]),
    folder('notes', [folder('deep', [folder('deeper')])]), { kind: 'file', name: 'a.md' },
  ]);
  const skipped = [];
  assert.deepEqual(await listFolders(vault, skipped), ['OneDrive link', 'notes', 'notes/deep', 'notes/deep/deeper', 'papers', 'papers/2026']);
  assert.deepEqual(skipped, [{ folder: 'OneDrive link', error: 'NotReadableError: could not be read' }]);
  await assert.rejects(listFolders(folder('vault', [], true)), /could not be read/, 'the chosen folder itself failing is an error');
});
