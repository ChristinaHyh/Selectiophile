import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createService } from './service.js';
import { withRetry } from './vault.js';
import { finishArchive } from './archive.js';

const template = readFileSync(new URL('../Reading Template.md', import.meta.url), 'utf8');

const chatPage = { url: 'https://chatgpt.com/c/one', docTitle: 'Chat about things', meta: {} };

const domError = (name) => Object.assign(new Error(name), { name });

// In-memory stand-in for FileSystemDirectoryHandle. `failNext` injects errors. Files
// live in one map keyed by path, and a subfolder is a view with a path prefix.
class FakeDir {
  constructor(files = {}, root = null, prefix = '') {
    this.root = root || this;
    this.prefix = prefix;
    if (!root) {
      this.files = new Map(Object.entries(files).map(([k, v]) => [k, { text: v, mtime: 1 }]));
      this.permission = 'granted';
      this.clock = 1;
      this.failNext = [];
    }
  }
  trip() {
    const e = this.root.failNext.shift();
    if (e) throw domError(e);
  }
  queryPermission() { return this.root.permission; }
  children() {
    const names = new Map();
    for (const path of this.root.files.keys()) {
      if (!path.startsWith(this.prefix)) continue;
      const [first, ...rest] = path.slice(this.prefix.length).split('/');
      names.set(first, rest.length ? 'directory' : 'file');
    }
    return names;
  }
  async getDirectoryHandle(name, { create } = {}) {
    if (this.children().get(name) !== 'directory' && !create) throw domError('NotFoundError');
    return new FakeDir({}, this.root, `${this.prefix}${name}/`);
  }
  async getFileHandle(name, { create } = {}) {
    const root = this.root;
    const path = this.prefix + name;
    if (!root.files.has(path)) {
      if (!create) throw domError('NotFoundError');
      root.files.set(path, { text: '', mtime: ++root.clock });
    }
    return {
      kind: 'file',
      getFile: async () => root.fileObject(path),
      createWritable: async () => {
        this.trip();
        let buffered = '';
        return {
          write: async (t) => { buffered = t; },
          close: async () => { root.files.set(path, { text: buffered, mtime: ++root.clock }); },
          abort: async () => {},
        };
      },
    };
  }
  fileObject(path) {
    const f = this.root.files.get(path);
    return { lastModified: f.mtime, text: async () => f.text };
  }
  async removeEntry(name) {
    this.trip();
    if (!this.root.files.delete(this.prefix + name)) throw domError('NotFoundError');
  }
  async *entries() {
    for (const [name, kind] of this.children()) {
      if (kind === 'directory') yield [name, { kind, ...(await this.getDirectoryHandle(name)), entries: () => new FakeDir({}, this.root, `${this.prefix}${name}/`).entries(), getDirectoryHandle: undefined }];
      else yield [name, { kind, getFile: async () => this.root.fileObject(this.prefix + name) }];
    }
  }
  read(name) { return this.files.get(name)?.text; }
}

function memoryKv(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v); }, all: async () => Object.fromEntries(data), data };
}

const blockAnswer = (block, p = 0.95) => {
  const runnerUp = block === 'Others' ? 'Novelty' : 'Others';
  const probabilities = { [block]: p, [runnerUp]: 1 - p };
  return { json: { answers: { block: { type: 'choice', choice: block, probabilities } } } };
};

function setup({ files = { [TEMPLATE]: template }, jev, key = 'k', settings, bundled = null, profiles = [], lang = 'zh', onNoteWritten, getClipFolder, requestClip } = {}) {
  const dir = new FakeDir(files);
  const kv = memoryKv(settings ? { settings } : {});
  const updates = [];
  const jevCalls = [];
  let n = 0;
  const service = createService({
    getFolder: async () => dir,
    kv,
    getJevKey: async () => key,
    askJev: async (_key, body) => {
      jevCalls.push(body);
      return jev(body);
    },
    notify: async (tabId, update) => { updates.push({ tabId, ...update }); },
    now: () => new Date(2026, 10, 5, 9, 30, 0),
    newId: () => `id${++n}`,
    getLang: async () => lang,
    getBundledTemplate: async (id) => (typeof bundled === 'object' && bundled ? bundled[id] : bundled),
    getDefaultProfiles: async () => profiles,
    onNoteWritten,
    getClipFolder,
    requestClip,
  });
  return { service, dir, kv, updates, jevCalls, last: () => updates.at(-1) };
}

const TEMPLATE = 'Reading Template.md';
const paperPage = {
  url: 'https://www.nature.com/articles/s1', docTitle: 'x',
  meta: { citation_title: ['Attention Is All You Need'], citation_author: ['Ashish Vaswani'], citation_publication_date: ['2017/06/12'], citation_doi: ['10.1000/abc'] },
};
const blogPage = { url: 'https://blog.org/post', docTitle: 'A Blog Post', meta: {} };
const highlight = (over = {}) => ({ quote: 'We found an effect.', exact: 'We found an effect.', comment: '关键结果', prefix: 'p', suffix: 's', rawPage: paperPage, ...over });
const NOTE = 'Vaswani(2017)-Attention All You Need.md';

test('first paper highlight creates the note and files it silently', async () => {
  const { service, dir, last } = setup({ jev: () => blockAnswer('Main Findings') });
  await service.submit(highlight(), 7);
  const u = last();
  assert.equal(u.state, 'saved');
  assert.equal(u.tabId, 7);
  assert.equal(u.created, true);
  assert.equal(u.heading, 'Main Findings');
  const md = dir.read(NOTE);
  assert.ok(md.includes('title: "Attention Is All You Need"'));
  assert.ok(md.includes('doi: "10.1000/abc"'));
  assert.ok(md.includes('last_annotated: 2026-11-05T09:30\n'), 'to the minute');
  assert.ok(md.indexOf('data-lp="id1"') > md.indexOf('## Main Findings') && md.indexOf('data-lp="id1"') < md.indexOf('## Novelty'));
});

test('later highlights on the same page reuse the note', async () => {
  const { service, dir, last } = setup({ jev: () => blockAnswer('Main Findings') });
  await service.submit(highlight(), 1);
  await service.submit(highlight({ quote: 'Second.' }), 1);
  assert.equal(last().created, false);
  assert.equal(dir.files.size, 2);
  assert.equal(dir.read(NOTE).match(/data-lp="/g).length, 2);
});

test('same paper from another URL finds the note through its DOI', async () => {
  const { service, dir, last } = setup({ jev: () => blockAnswer('Novelty') });
  await service.submit(highlight(), 1);
  await service.submit(highlight({ rawPage: { url: 'https://pubmed.org/9', meta: { citation_doi: ['10.1000/ABC'], citation_title: ['Other'] } } }), 1);
  assert.equal(last().noteVia, 'binding');
  assert.equal(dir.files.size, 2);
  assert.equal(dir.read(NOTE).match(/data-lp="/g).length, 2);
});

test('low confidence asks, then the choice is honored without calling Jev again', async () => {
  const { service, dir, updates, jevCalls, last } = setup({ jev: () => blockAnswer('Novelty', 0.6) });
  const id = await service.submit(highlight(), 1);
  assert.equal(last().state, 'confirm-block');
  assert.equal(last().reason, 'low-confidence');
  assert.equal(last().options[0].block, 'Novelty');
  assert.equal(dir.files.has(NOTE), false, 'no empty note before the choice');
  await service.confirm({ id, heading: 'Others' });
  assert.equal(last().state, 'saved');
  assert.equal(last().heading, 'Others');
  assert.equal(jevCalls.length, 1);
  assert.equal(updates.length, 2);
  assert.ok(dir.read(NOTE).indexOf('data-lp=') > dir.read(NOTE).indexOf('# Others'));
});

test('choices never include a heading the note does not have', async () => {
  const files = { [TEMPLATE]: template, 'Custom.md': '---\ntitle: "Custom"\n---\n\n# Only\n\n# Other\n' };
  const { service, last } = setup({ files, settings: { pinned: 'Custom.md' }, jev: () => blockAnswer('Main Findings', 0.97) });
  await service.submit(highlight(), 1);
  assert.equal(last().state, 'confirm-block');
  assert.deepEqual(last().options.map((o) => o.block), ['Only', 'Other']);
});

test('the auto-filing threshold is a setting, used for headings and notes alike', async () => {
  const at = async (percent, p) => {
    const { service, kv, last } = setup({ jev: () => blockAnswer('Novelty', p) });
    if (percent !== undefined) await kv.set('autoSavePercent', percent);
    await service.submit(highlight(), 1);
    return last().state;
  };
  assert.equal(await at(undefined, 0.89), 'confirm-block', 'default is 90%');
  assert.equal(await at(undefined, 0.9), 'saved');
  assert.equal(await at(70, 0.71), 'saved');
  assert.equal(await at(70, 0.69), 'confirm-block');
  assert.equal(await at(100, 0.99), 'confirm-block');
  assert.equal(await at(100, 1), 'saved');
  assert.equal(await at(10, 0.8), 'confirm-block', 'an unusable value falls back to the default');
  assert.equal(await at('70', 0.8), 'confirm-block');

  const discussion = (percent) => {
    const files = { [TEMPLATE]: template, 'First.md': instantiateNote('First Paper'), 'Second.md': instantiateNote('Second Paper') };
    const run = setup({
      files,
      jev: (body) => (body.questions.note
        ? { json: { answers: { note: { probabilities: { Second: 0.8, First: 0.2 } }, belongs: { noul: 0.8 } } } }
        : blockAnswer('Others', 0.99)),
    });
    return run.kv.set('autoSavePercent', percent).then(() => run.kv.set('lastNote', 'First.md'))
      .then(() => run.service.submit(highlight({ rawPage: { url: 'https://chatgpt.com/c/t', docTitle: 'Chat', meta: {} } }), 1))
      .then(() => run.last().noteName);
  };
  assert.equal(await discussion(90), 'First.md', 'not sure enough: the latest note');
  assert.equal(await discussion(75), 'Second.md', 'sure enough at the lower threshold');
});

test('Jev failures fall back to a manual pick, and the highlight survives', async () => {
  const { service, kv, last } = setup({ jev: () => { throw new Error('HTTP 451: region'); } });
  const id = await service.submit(highlight(), 1);
  assert.equal(last().state, 'confirm-block');
  assert.equal(last().reason, 'jev-error');
  assert.match(last().error, /451/);
  assert.equal(last().options.length, 8);
  assert.ok((await kv.get('pending'))[id]);
});

test('no key means a manual pick, not an error', async () => {
  const { service, last } = setup({ key: '', jev: () => assert.fail('must not call') });
  await service.submit(highlight(), 1);
  assert.equal(last().reason, 'no-key');
});

test('ordinary page with no notes asks before creating, using the edited title', async () => {
  const { service, dir, last } = setup({ bundled: template, jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight({ rawPage: blogPage }), 1);
  assert.equal(last().state, 'confirm-note');
  assert.deepEqual(last().candidates, []);
  assert.equal(last().suggestedTitle, 'A Blog Post');
  await service.confirm({ id, createNote: true, title: 'Better Title' });
  assert.equal(last().state, 'saved');
  assert.ok(dir.read('Better Title.md').includes('title: "Better Title"'));
});

test('ordinary page: Jev picks an existing note only when sure on both questions', async () => {
  const existing = { [TEMPLATE]: template, 'A(2020)-Paper.md': instantiateNote('Paper One') };
  const answer = (belongs, p) => ({ json: { answers: {
    note: { probabilities: { 'A(2020)-Paper': p, other: 1 - p } },
    belongs: { noul: belongs },
    block: { probabilities: { Others: 0.99, Novelty: 0.01 } },
  } } });
  const sure = setup({ files: existing, jev: () => answer(0.97, 0.99) });
  await sure.service.submit(highlight({ rawPage: blogPage }), 1);
  assert.equal(sure.last().state, 'saved');
  assert.equal(sure.last().noteVia, 'jev');

  const unsure = setup({ files: existing, jev: () => answer(0.4, 0.99) });
  await unsure.service.submit(highlight({ rawPage: blogPage }), 1);
  assert.equal(unsure.last().state, 'confirm-note');
  assert.equal(unsure.last().candidates[0].name, 'A(2020)-Paper.md');
});

function instantiateNote(title) {
  return template.replace('title:\n', `title: "${title}"\n`);
}

test('pinned note wins over page routing', async () => {
  const files = { [TEMPLATE]: template, 'Pinned.md': instantiateNote('Pinned') };
  const { service, last } = setup({ files, settings: { pinned: 'Pinned.md' }, jev: () => blockAnswer('Others') });
  await service.submit(highlight(), 1);
  assert.equal(last().noteLabel, 'Pinned');
  assert.equal(last().noteVia, 'pinned');
});

test('without permission the job waits, then flush saves it', async () => {
  const { service, dir, kv, last } = setup({ jev: () => blockAnswer('Main Findings') });
  dir.permission = 'prompt';
  const id = await service.submit(highlight(), 1);
  assert.equal(last().state, 'needs-permission');
  assert.ok((await kv.get('pending'))[id]);
  dir.permission = 'granted';
  await service.flush();
  assert.equal(last().state, 'saved');
  assert.deepEqual(await kv.get('pending'), {});
});

test('retrying a job does not duplicate an entry already written', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  const job = { ...(await kv.get('entries'))[id] };
  assert.ok(job);
  await kv.set('pending', { [id]: { id, quote: 'q', page: { url: 'u', doi: '10.1000/abc', arxiv: '', title: '', isPaper: true, authors: [] }, tabId: 1, awaiting: 'retry' } });
  await service.flush();
  assert.equal(dir.read(NOTE).match(/data-lp="id1"/g).length, 1);
});

test('undo removes the entry and a note created by that highlight', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  assert.deepEqual(await service.remove({ id }), { deletedNote: true, entryMissing: false });
  assert.equal(dir.files.has(NOTE), false);
  assert.deepEqual(await kv.get('bindings'), {});
  assert.deepEqual(await kv.get(`hl:${paperPage.url}`), {});
});

test('undo keeps a created note that gained other entries', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Main Findings') });
  const first = await service.submit(highlight(), 1);
  await service.submit(highlight({ quote: 'Second' }), 1);
  assert.deepEqual(await service.remove({ id: first }), { deletedNote: false, entryMissing: false });
  assert.equal(dir.read(NOTE).match(/data-lp="/g).length, 1);
});

test('undo keeps a created note the user has written in', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  dir.files.set(NOTE, { text: dir.read(NOTE).replace('## Novelty\n', '## Novelty\n\n我手写的内容\n'), mtime: 99 });
  assert.equal((await service.remove({ id })).deletedNote, false);
  assert.ok(dir.read(NOTE).includes('我手写的内容'));
});

test('deleting later keeps even an empty note', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  assert.deepEqual(await service.remove({ id, keepNote: true }), { deletedNote: false, entryMissing: false });
  assert.ok(dir.files.has(NOTE));
});

test('inspect follows an entry moved or renamed by hand, and reports one removed by hand', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  assert.equal((await service.inspect({ id })).heading, 'Main Findings');

  const text = dir.read(NOTE);
  dir.files.delete(NOTE);
  dir.files.set('Renamed.md', { text, mtime: 50 });
  assert.equal((await service.inspect({ id })).noteLabel, 'Renamed');

  dir.files.set('Renamed.md', { text: template, mtime: 51 });
  assert.deepEqual(await service.inspect({ id }), { exists: false });
  assert.deepEqual(await service.remove({ id }), { deletedNote: false, entryMissing: true });
  assert.deepEqual(await kv.get(`hl:${paperPage.url}`), {});
});

test('an old highlight outside the entry log can still be inspected and removed', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  await kv.set('entries', {});
  await assert.rejects(service.inspect({ id }), /找不到/);
  assert.equal((await service.inspect({ id, pageKey: paperPage.url })).exists, true);
  await service.remove({ id, pageKey: paperPage.url });
  assert.equal(dir.read(NOTE).includes(`data-lp="${id}"`), false);
});

test('removing without folder permission reports it and changes nothing', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  dir.permission = 'prompt';
  await assert.rejects(service.remove({ id }), (e) => e.code === 'needs-permission');
  assert.ok((await kv.get('entries'))[id]);
  assert.ok(dir.read(NOTE).includes(`data-lp="${id}"`));
});

test('a discussion goes to the most recent note, labelled, without binding', async () => {
  const { service, dir, kv, jevCalls, last } = setup({ jev: () => blockAnswer('Ideas for My Research') });
  await service.submit(highlight(), 1);
  await service.submit(highlight({ quote: 'AI said this', rawPage: chatPage }), 2);
  assert.equal(last().state, 'saved');
  assert.equal(last().noteVia, 'recent');
  assert.equal(dir.files.size, 2);
  assert.ok(dir.read(NOTE).includes('>GPT</a>'));
  assert.ok(!Object.keys(await kv.get('bindings')).some((k) => k.includes('chatgpt')));
  const request = jevCalls.at(-1);
  assert.equal(request.state.source_title, 'Attention Is All You Need');
  assert.match(request.state.source, /AI assistant/);
  assert.equal(readFrontmatterUrl(dir.read(NOTE)), paperPage.url);
});

const readFrontmatterUrl = (md) => md.match(/^url: "(.*)"$/m)[1];

test('correcting a discussion entry makes later ones follow, and leaves paper bindings alone', async () => {
  const files = { [TEMPLATE]: template, 'Other.md': instantiateNote('Other Paper') };
  const { service, kv, updates, last } = setup({ files, jev: () => blockAnswer('Others') });
  await service.submit(highlight(), 1);
  const id = await service.submit(highlight({ quote: 'one', rawPage: chatPage }), 2);
  assert.equal(last().noteName, NOTE);
  await service.move({ id, noteName: 'Other.md', heading: 'Others' });
  assert.equal(Object.values(await kv.get('bindings'))[0], NOTE, 'the paper keeps its note');
  await service.submit(highlight({ quote: 'two', rawPage: chatPage }), 2);
  assert.equal(updates.at(-1).noteName, 'Other.md');
});

test('a discussion with no notes yet asks, and the new note carries no chat metadata', async () => {
  const { service, dir, last } = setup({ jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().state, 'confirm-note');
  await service.confirm({ id, createNote: true, title: 'Chosen Paper' });
  assert.equal(last().state, 'saved');
  const md = dir.read('Chosen Paper.md');
  assert.ok(md.includes('title: "Chosen Paper"'));
  assert.match(md, /^url:$/m);
});

test('color purpose reaches the note and Jev, and a later rename leaves old entries alone', async () => {
  const { service, dir, kv, jevCalls } = setup({ jev: () => blockAnswer('Others') });
  await kv.set('colors', { blue: '方法论' });
  const id = await service.submit(highlight({ color: 'blue' }), 1);
  assert.equal(jevCalls[0].state.highlight_purpose, '方法论');
  assert.ok(dir.read(NOTE).includes('<sup>方法论 · <a '));
  assert.equal((await kv.get(`hl:${paperPage.url}`))[id].color, 'blue');
  assert.equal(await kv.get('lastColor'), 'blue');
  await kv.set('colors', { blue: '新名字' });
  assert.ok(!dir.read(NOTE).includes('新名字'));
  const status = await service.pageStatus(paperPage);
  assert.equal(status.colors.find((c) => c.id === 'blue').name, '新名字');
  assert.equal(status.lastColor, 'blue');
});

test('a color with no purpose, or an unknown color, still saves', async () => {
  const { service, dir, kv, jevCalls } = setup({ jev: () => blockAnswer('Others') });
  await kv.set('colors', { yellow: '' });
  await service.submit(highlight({ color: 'not-a-color' }), 1);
  assert.equal(jevCalls[0].state.highlight_purpose, undefined);
  assert.ok(dir.read(NOTE).includes('<sup><a '));
  assert.ok(dir.read(NOTE).includes('- **Comments：** 关键结果'));
});

test('recolor updates the note and the page record, and reports a missing entry', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight({ color: 'blue' }), 1);
  await service.recolor({ id, color: 'purple' });
  assert.ok(dir.read(NOTE).includes('<sup>灵感 · <a '));
  assert.equal((await kv.get(`hl:${paperPage.url}`))[id].color, 'purple');
  dir.files.set(NOTE, { text: template, mtime: 99 });
  await assert.rejects(service.recolor({ id, color: 'red' }), /已经没有/);
});

test('comments can be added and edited on a saved highlight', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight({ comment: '' }), 1);
  assert.equal((await service.inspect({ id })).comment, '');
  await service.setComment({ id, comment: '补充的评论' });
  assert.equal((await service.inspect({ id })).comment, '补充的评论');
  await service.setComment({ id, comment: '修改后的评论' });
  assert.equal((await service.inspect({ id })).comment, '修改后的评论');
  assert.equal(dir.read(NOTE).match(/Comments：/g).length, 1);
  await service.setComment({ id, comment: '' });
  assert.equal((await service.inspect({ id })).comment, '');
  dir.files.set(NOTE, { text: template, mtime: 99 });
  await assert.rejects(service.setComment({ id, comment: 'x' }), /已经没有/);
  assert.ok(await kv.get('entries'));
});

const discussionFiles = () => ({ [TEMPLATE]: template, 'First.md': instantiateNote('First Paper'), 'Second.md': instantiateNote('Second Paper') });
const noteAnswer = (name, belongs, p = 0.97) => ({ json: { answers: {
  note: { probabilities: { [name]: p, other: 1 - p } }, belongs: { noul: belongs },
} } });

const twoNotes = (first, second, topP = 0.97, secondP = 0.03) => ({ json: { answers: {
  note: { probabilities: { [first]: topP, [second]: secondP } }, belongs: { noul: 0.97 },
} } });

test('the first highlight reads the conversation opening once, then only the highlight', async () => {
  const calls = [];
  const { service, last } = setup({
    files: discussionFiles(),
    jev: (body) => {
      calls.push(body);
      return body.questions.note ? noteAnswer('Second', 0.97) : blockAnswer('Others');
    },
  });
  assert.equal((await service.pageStatus(chatPage)).conversationRounds, 2, 'asks for the opening');
  await service.submit(highlight({ rawPage: chatPage, context: 'User: tell me about Second Paper' }), 1);
  assert.equal(last().noteName, 'Second.md');
  assert.equal(last().noteVia, 'discussion-jev');
  const first = calls.find((c) => c.questions.note);
  assert.equal(first.state.conversation_opening, 'User: tell me about Second Paper');
  assert.equal(first.state.highlighted_passage, 'We found an effect.');

  assert.equal((await service.pageStatus(chatPage)).conversationRounds, 0, 'no longer asks');
  const count = calls.filter((c) => c.questions.note).length;
  await service.submit(highlight({ quote: 'next', rawPage: chatPage, context: 'should be ignored' }), 1);
  assert.equal(last().noteName, 'Second.md');
  assert.equal(last().noteVia, 'discussion');
  assert.equal(calls.filter((c) => c.questions.note).length, count, 'no second judgment');
  assert.ok(!JSON.stringify(calls.at(-1)).includes('should be ignored'));
});

test('the number of rounds is a setting, and zero reads no conversation', async () => {
  const { service, kv } = setup({ files: discussionFiles(), jev: () => blockAnswer('Others') });
  await kv.set('discussionRounds', 5);
  assert.equal((await service.pageStatus(chatPage)).conversationRounds, 5);
  await kv.set('discussionRounds', 0);
  assert.equal((await service.pageStatus(chatPage)).conversationRounds, 0);
});

test('each conversation is judged on its own', async () => {
  const { service, last } = setup({
    files: discussionFiles(),
    jev: (body) => {
      if (!body.questions.note) return blockAnswer('Others');
      return noteAnswer(body.state.page_url.endsWith('/one') ? 'First' : 'Second', 0.97);
    },
  });
  await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
  await service.submit(highlight({ rawPage: { ...chatPage, url: 'https://chatgpt.com/c/two' } }), 1);
  assert.equal(last().noteName, 'Second.md');
  await service.submit(highlight({ quote: 'more', rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
});

test('a temporary chat has no memory, so nothing is linked to its shared address', async () => {
  const temp = { ...chatPage, url: 'https://chatgpt.com/?temporary-chat=true' };
  let judged = 0;
  const { service, kv } = setup({
    files: discussionFiles(),
    jev: (body) => {
      if (!body.questions.note) return blockAnswer('Others');
      judged++;
      return noteAnswer('Second', 0.97);
    },
  });
  await service.submit(highlight({ rawPage: temp }), 1);
  await service.submit(highlight({ quote: 'b', rawPage: temp }), 1);
  assert.equal(judged, 2);
  assert.equal(await kv.get('discussions'), undefined);
});

test('unsure at the first look: the latest note is linked, and the conversation is not read again', async () => {
  let judged = 0;
  const { service, kv, last } = setup({
    files: discussionFiles(),
    jev: (body) => {
      if (!body.questions.note) return blockAnswer('Others');
      judged++;
      return noteAnswer('Second', 0.4);
    },
  });
  await kv.set('lastNote', 'First.md');
  await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
  assert.equal(last().noteVia, 'recent');
  await service.submit(highlight({ quote: 'b', rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
  assert.equal(judged, 1);
});

test('a Jev failure is retried next time, without linking anything', async () => {
  let fail = true;
  const { service, kv, last } = setup({
    files: discussionFiles(),
    jev: (body) => {
      if (!body.questions.note) return blockAnswer('Others');
      if (fail) throw new Error('HTTP 451');
      return noteAnswer('Second', 0.97);
    },
  });
  await kv.set('lastNote', 'First.md');
  await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
  assert.equal(await kv.get('discussions'), undefined);
  fail = false;
  await service.submit(highlight({ quote: 'b', rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'Second.md');
});

test('a conversation linked to several notes chooses across all their headings', async () => {
  const calls = [];
  const { service, dir, last } = setup({
    files: discussionFiles(),
    jev: (body) => {
      calls.push(body);
      if (body.questions.note) return twoNotes('First', 'Second', 0.92, 0.08);
      if (Object.keys(body.questions.block.criteria).some((k) => k.includes('›'))) {
        return { json: { answers: { block: { probabilities: { 'Second › Novelty': 0.95, 'First › Others': 0.05 } } } } };
      }
      return blockAnswer('Others');
    },
  });
  const id = await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
  await service.move({ id, noteName: 'Second.md', heading: 'Others' });
  await service.submit(highlight({ quote: 'about novelty', rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'Second.md');
  assert.equal(last().heading, 'Novelty');
  const asked = calls.at(-1);
  const options = Object.keys(asked.questions.block.criteria);
  assert.ok(options.includes('First › Main Findings') && options.includes('Second › Others'));
  assert.equal(asked.state.conversation_opening, undefined);
  const md = dir.read('Second.md');
  assert.ok(md.slice(md.indexOf('## Novelty')).includes('about novelty'));
});

test('several notes, unsure: the choice shows note and heading, and is honored', async () => {
  const { service, dir, kv, last } = setup({
    files: discussionFiles(),
    jev: (body) => {
      if (body.questions.note) throw new Error('not expected');
      return { json: { answers: { block: { probabilities: { 'First › Others': 0.5, 'Second › Novelty': 0.4 } } } } };
    },
  });
  await kv.set('discussions', { 'chatgpt.com/c/one': { notes: ['First.md', 'Second.md'], at: 1 } });
  const id = await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().state, 'confirm-block');
  assert.equal(last().noteLabel, '');
  assert.deepEqual(last().options[1], { block: 'Second › Novelty', p: 0.4, noteName: 'Second.md', heading: 'Novelty' });
  await service.confirm({ id, noteName: 'Second.md', heading: 'Novelty' });
  assert.equal(last().state, 'saved');
  assert.ok(dir.read('Second.md').includes(`data-lp="${id}"`));
});

test('a linked note that was deleted drops out of the conversation', async () => {
  const { service, dir, kv, last } = setup({ files: discussionFiles(), jev: () => blockAnswer('Others') });
  await kv.set('discussions', { 'chatgpt.com/c/one': { notes: ['Gone.md', 'First.md'], at: 1 } });
  await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().noteName, 'First.md');
  assert.ok(dir.files.has('First.md'));
});

test('highlights whose note or entry was deleted can be found and cleared', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others') });
  const keep = await service.submit(highlight({ quote: 'keep' }), 1);
  const gone = await service.submit(highlight({ quote: 'gone' }), 1);
  const other = await service.submit(highlight({ quote: 'other', rawPage: { ...paperPage, url: 'https://x.org/other', meta: { citation_doi: ['10.1000/zzz'], citation_title: ['Different Work'] } } }), 1);
  assert.deepEqual(await service.scanOrphans(), { pages: 0, highlights: 0 });

  dir.files.set(NOTE, { text: dir.read(NOTE).replace(new RegExp(`\\n> [^\\n]*data-lp="${gone}"[^\\n]*\\n`), '\n'), mtime: 90 });
  const otherNote = [...dir.files.keys()].find((n) => n.startsWith('Different'));
  dir.files.delete(otherNote);
  assert.deepEqual(await service.scanOrphans(), { pages: 2, highlights: 2 });
  assert.ok((await kv.get(`hl:${paperPage.url}`))[gone], 'scanning changes nothing');

  assert.deepEqual(await service.clearOrphans(), { highlights: 2 });
  assert.deepEqual(Object.keys(await kv.get(`hl:${paperPage.url}`)), [keep]);
  assert.deepEqual(await kv.get('hl:https://x.org/other'), {});
  assert.ok(!(await kv.get('entries'))[other]);
  assert.deepEqual(await service.scanOrphans(), { pages: 0, highlights: 0 });
});

test('clearing needs folder access, so an expired permission never reads as "all deleted"', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight(), 1);
  dir.permission = 'prompt';
  await assert.rejects(service.scanOrphans(), (e) => e.code === 'needs-permission');
  await assert.rejects(service.clearOrphans(), (e) => e.code === 'needs-permission');
  assert.ok((await kv.get(`hl:${paperPage.url}`))[id]);
});

test('entries in the old marker format count as present', async () => {
  const { service, dir, kv } = setup({ files: { [TEMPLATE]: template, 'Old.md': '# A\n\n%% lp:old1 %%\n> q\n\n%% /lp %%\n' }, jev: () => blockAnswer('Others') });
  await kv.set('hl:u', { old1: { id: 'old1', anchor: 'q', noteName: 'Old.md' } });
  assert.deepEqual(await service.scanOrphans(), { pages: 0, highlights: 0 });
  assert.ok(dir.files.has('Old.md'));
});

test('with highlights off, only the note is written', async () => {
  const { service, dir, kv, last } = setup({ jev: () => blockAnswer('Others') });
  await kv.set('showHighlights', false);
  const id = await service.submit(highlight(), 1);
  assert.equal(last().state, 'saved');
  assert.ok(dir.read(NOTE).includes(`data-lp="${id}"`));
  assert.equal(await kv.get(`hl:${paperPage.url}`), undefined);
  await service.setComment({ id, comment: 'still editable' });
  assert.ok(dir.read(NOTE).includes('still editable'));
  await service.remove({ id });
  assert.equal(dir.files.has(NOTE), false, 'undo still works, and removes the untouched new note');
});

test('saving reports a written note, and a dashboard failure never fails the save', async () => {
  let written = 0;
  const ok = setup({ jev: () => blockAnswer('Others'), onNoteWritten: async () => { written++; } });
  await ok.service.submit(highlight(), 1);
  assert.equal(written, 1);
  const bad = setup({ jev: () => blockAnswer('Others'), onNoteWritten: async () => { throw new Error('boom'); } });
  await bad.service.submit(highlight(), 1);
  assert.equal(bad.last().state, 'saved');
});

test('a custom dashboard name keeps that file out of the notes', async () => {
  const files = { [TEMPLATE]: template, '看板.md': '# 看板\n', 'Real.md': instantiateNote('Real') };
  const { service, kv } = setup({ files, jev: () => blockAnswer('Others') });
  assert.deepEqual((await service.listNotes()).map((n) => n.name).sort(), ['Real.md', '看板.md']);
  await kv.set('dashboard', { auto: true, name: '看板' });
  assert.deepEqual((await service.listNotes()).map((n) => n.name), ['Real.md']);
});

test('page status reports whether the site is active under each mode', async () => {
  const { service, kv } = setup({ jev: () => blockAnswer('Others') });
  assert.equal((await service.pageStatus(paperPage)).active, false);
  await kv.set('sites', ['*.nature.com']);
  assert.equal((await service.pageStatus(paperPage)).active, true);
  await kv.set('siteMode', 'blacklist');
  assert.equal((await service.pageStatus(paperPage)).active, true);
  await kv.set('blockedSites', ['*.nature.com']);
  assert.equal((await service.pageStatus(paperPage)).active, false);
  await kv.set('siteMode', 'all');
  assert.equal((await service.pageStatus(paperPage)).active, true);
});

test('the overview shows only the latest entry', async () => {
  const { service } = setup({ jev: () => blockAnswer('Others') });
  await service.submit(highlight({ quote: 'one' }), 1);
  await service.submit(highlight({ quote: 'two' }), 1);
  assert.equal((await service.overview()).entries.length, 1);
});

const articleTemplate = '---\ntitle:\nauthor:\nsite:\nurl:\nlast_annotated:\n---\n\n# Key Ideas\n\n# My Thoughts\n\n# Others\n';
const articlePage = { url: 'https://a.substack.com/p/post?r=abc', docTitle: 'A Good Post', meta: { 'og:title': ['A Good Post'], 'og:site_name': ['Good Letter'], author: ['Jane Roe'] } };
const articleSetup = (over = {}) => setup({ bundled: { paper: template, article: articleTemplate }, jev: () => blockAnswer('Key Ideas', 0.97), ...over });

test('a site tied to a template creates its note without asking', async () => {
  const { service, dir, kv, last } = articleSetup();
  await kv.set('templates', [{ id: 'article', sites: ['*.substack.com'] }]);
  await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(last().state, 'saved');
  assert.equal(last().created, true);
  const md = dir.read('A Good Post.md');
  assert.ok(md.includes('# Key Ideas') && !md.includes('# Summary'), 'the article template');
  assert.ok(md.includes('author: "Jane Roe"') && md.includes('site: "Good Letter"'));
  assert.ok(md.includes('url: "https://a.substack.com/p/post"'), 'without the share parameter');
});

test('a template sends new notes to its subfolder, created when needed', async () => {
  const { service, dir, kv, last } = articleSetup({ jev: () => blockAnswer('Others', 0.97) });
  await kv.set('templates', [{ id: 'article', sites: ['*.substack.com'], folder: '文章/ 2026 ' }, { id: 'paper', folder: 'papers' }]);
  await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(last().noteName, '文章/2026/A Good Post.md');
  assert.equal(last().noteLabel, '文章/2026/A Good Post');
  assert.ok(dir.read('文章/2026/A Good Post.md').includes('# Key Ideas'));

  await service.submit(highlight({ quote: 'more', rawPage: articlePage }), 1);
  assert.equal(last().noteName, '文章/2026/A Good Post.md', 'later highlights find it');
  assert.equal(last().created, false);

  await service.submit(highlight(), 1);
  assert.equal(last().noteName, `papers/${NOTE}`);
  assert.deepEqual(await service.listFolders(), ['papers', '文章', '文章/2026']);
  dir.permission = 'prompt';
  assert.equal(await service.listFolders(), null, 'unreadable is told apart from having no subfolders');
});

test('a saved folder can never lead outside the chosen folder, or into a hidden one', async () => {
  const { service, dir, kv, last } = articleSetup({ jev: () => blockAnswer('Others', 0.97) });
  await kv.set('templates', [{ id: 'paper', folder: '../../etc/./.obsidian/ok' }]);
  await service.submit(highlight(), 1);
  assert.equal(last().noteName, `etc/ok/${NOTE}`);
  assert.ok(dir.files.has(`etc/ok/${NOTE}`));
});

test('the same file name in another subfolder gets a suffix there only when it collides', async () => {
  const files = { [TEMPLATE]: template, [`papers/${NOTE}`]: instantiateNote('A Different Paper') };
  const { service, dir, kv, last } = articleSetup({ files, jev: () => blockAnswer('Others', 0.97) });
  await kv.set('templates', [{ id: 'paper', folder: 'papers' }]);
  await service.submit(highlight(), 1);
  assert.equal(last().noteName, 'papers/Vaswani(2017)-Attention All You Need-2.md');
  assert.ok(dir.read(`papers/${NOTE}`).includes('A Different Paper'));
});

test('undo removes a new note from its subfolder', async () => {
  const { service, dir, kv } = articleSetup({ jev: () => blockAnswer('Others', 0.97) });
  await kv.set('templates', [{ id: 'paper', folder: 'papers' }]);
  const id = await service.submit(highlight(), 1);
  assert.equal((await service.remove({ id })).deletedNote, true);
  assert.equal(dir.files.has(`papers/${NOTE}`), false);
});

test('asking first names the folder too', async () => {
  const { service, kv, last } = articleSetup();
  await kv.set('templates', [{ id: 'article', folder: 'web' }]);
  await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(last().state, 'confirm-note');
  assert.equal(last().templateFolder, 'web');
});

test('a wildcard rule ties a page to its template without asking', async () => {
  const { service, dir, kv, last } = articleSetup({ jev: () => blockAnswer('Others', 0.97) });
  await kv.set('templates', [{ id: 'article', sites: ['*.substack.com/p/*'], folder: 'posts' }]);
  await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(last().noteName, 'posts/A Good Post.md');
  await service.submit(highlight({ rawPage: { ...articlePage, url: 'https://a.substack.com/about', meta: { 'og:title': ['About This Letter'] } } }), 1);
  assert.equal(last().state, 'confirm-note', 'a page outside the pattern still asks');
  assert.ok(dir.files.has('posts/A Good Post.md'));
});

test('a page on an untied site still asks, and says which template it would use', async () => {
  const { service, dir, last } = articleSetup();
  const id = await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(last().state, 'confirm-note');
  assert.equal(last().templateId, 'article');
  await service.confirm({ id, createNote: true, title: 'A Good Post' });
  assert.ok(dir.read('A Good Post.md').includes('# Key Ideas'));
});

test('a paper on a site tied to a custom template uses it; the rule applies only at creation', async () => {
  const { service, dir, kv, last } = articleSetup({ jev: () => blockAnswer('Claims', 0.97) });
  await kv.set('templates', [{ id: 'c1', name: 'Mine', text: '---\ntitle:\n---\n\n# Claims\n', sites: ['*.nature.com'] }]);
  await service.submit(highlight(), 1);
  assert.ok(dir.read(NOTE).includes('# Claims'));
  await kv.set('templates', []);
  await service.submit(highlight({ quote: 'later' }), 1);
  assert.equal(last().created, false, 'an existing note stays as it is');
  assert.ok(!dir.read(NOTE).includes('# Summary'));
});

test('later highlights from an article go to its note, by the share-free address', async () => {
  const { service, dir, kv, last, jevCalls } = articleSetup();
  await kv.set('templates', [{ id: 'article', sites: ['*.substack.com'] }]);
  await service.submit(highlight({ rawPage: articlePage }), 1);
  await service.submit(highlight({ quote: 'more', rawPage: { ...articlePage, url: 'https://a.substack.com/p/post?utm_source=x&r=other' } }), 1);
  assert.equal(last().created, false);
  assert.equal(last().noteLabel, 'A Good Post');
  assert.equal(dir.read('A Good Post.md').match(/data-lp=/g).length, 2);
  const asked = jevCalls.at(-1);
  assert.deepEqual(Object.keys(asked.questions.block.criteria), ['Key Ideas', 'My Thoughts', 'Others'], 'its own headings');
  assert.match(asked.questions.block.criteria['Key Ideas'], /main argument/);
  assert.equal(asked.state.source_title, 'A Good Post');
  assert.ok(!/research paper/i.test(asked.questions.block.instructions));
});

test('the note is found by its url after the extension forgets the binding', async () => {
  const { service, kv, last } = articleSetup();
  await kv.set('templates', [{ id: 'article', sites: ['*.substack.com'] }]);
  await service.submit(highlight({ rawPage: articlePage }), 1);
  await kv.set('bindings', {});
  await service.submit(highlight({ quote: 'more', rawPage: articlePage }), 1);
  assert.equal(last().created, false);
  assert.equal(last().noteVia, 'url');
});

test('an article about a paper already noted can join that note when Jev is sure', async () => {
  const files = { [TEMPLATE]: template, 'Paper.md': instantiateNote('Attention Paper') };
  const answer = (belongs) => (body) => (body.questions.note
    ? { json: { answers: { note: { probabilities: { Paper: 0.98, x: 0.02 } }, belongs: { noul: belongs } } } }
    : blockAnswer('Others'));
  const sure = articleSetup({ files, jev: answer(0.97) });
  await sure.kv.set('templates', [{ id: 'article', sites: ['*.substack.com'] }]);
  await sure.service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(sure.last().noteName, 'Paper.md');
  assert.equal(sure.dir.files.has('A Good Post.md'), false);

  const unsure = articleSetup({ files, jev: answer(0.3) });
  await unsure.kv.set('templates', [{ id: 'article', sites: ['*.substack.com'] }]);
  await unsure.service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(unsure.last().created, true, 'merely related: gets its own note');
  assert.equal(unsure.last().noteName, 'A Good Post.md');
});

test('undo deletes an untouched note made from any template', async () => {
  const { service, dir, kv } = articleSetup();
  await kv.set('templates', [{ id: 'article', sites: ['*.substack.com'] }]);
  const id = await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal((await service.remove({ id })).deletedNote, true);
  assert.equal(dir.files.has('A Good Post.md'), false);
});

test('the template kept by earlier versions still applies to papers', async () => {
  const { service, dir, kv } = articleSetup({ jev: () => blockAnswer('Old', 0.97) });
  await kv.set('templateText', '---\ntitle:\n---\n\n# Old\n');
  await service.submit(highlight(), 1);
  assert.ok(dir.read(NOTE).includes('# Old'));
});

test('a folder template in earlier style never counts as a note, in either name', async () => {
  const files = { [TEMPLATE]: template, 'Article Template.md': articleTemplate, 'Real.md': instantiateNote('Real') };
  const { service } = articleSetup({ files });
  assert.deepEqual((await service.listNotes()).map((n) => n.name), ['Real.md']);
});

test('notes in subfolders are matched, written and undone in place', async () => {
  const nested = instantiateNote('Nested Paper').replace('doi:\n', 'doi: "10.1000/abc"\n');
  const files = { [TEMPLATE]: template, 'topic/deep/Nested.md': nested, '.obsidian/ignored.md': 'x', 'topic/_hidden.md': 'x' };
  const { service, dir, last } = setup({ files, jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight(), 1);
  assert.equal(last().noteName, 'topic/deep/Nested.md');
  assert.equal(last().noteLabel, 'topic/deep/Nested');
  assert.equal(last().created, false);
  assert.ok(dir.read('topic/deep/Nested.md').includes(`data-lp="${id}"`));
  assert.deepEqual((await service.listNotes()).map((n) => n.name), ['topic/deep/Nested.md']);
  assert.equal((await service.inspect({ id })).noteLabel, 'topic/deep/Nested');
  await service.remove({ id });
  assert.ok(!dir.read('topic/deep/Nested.md').includes('data-lp'));
  assert.ok(dir.files.has('topic/deep/Nested.md'));
});

test('an entry moved to a subfolder by hand is still found', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight(), 1);
  const text = dir.read(NOTE);
  dir.files.delete(NOTE);
  dir.files.set(`archive/${NOTE}`, { text, mtime: 50 });
  assert.equal((await service.inspect({ id })).noteName, `archive/${NOTE}`);
});

test('new notes go at the top level even when others are in subfolders', async () => {
  const files = { [TEMPLATE]: template, 'topic/Other.md': instantiateNote('Other') };
  const { service, dir, last } = setup({ files, jev: () => blockAnswer('Others') });
  await service.submit(highlight(), 1);
  assert.equal(last().noteName, NOTE);
  assert.ok(dir.files.has(NOTE));
});

test('template order: uploaded, then the folder, then bundled, and none is an error', async () => {
  const custom = (word) => `---\ntitle:\n---\n\n# ${word}\n`;
  const uploaded = setup({ jev: () => blockAnswer('Mine', 0.99), bundled: custom('Bundled') });
  await uploaded.kv.set('templates', [{ id: 'paper', text: custom('Mine'), sites: [] }]);
  await uploaded.service.submit(highlight(), 1);
  assert.ok(uploaded.dir.read(NOTE).includes('# Mine'));

  const folder = setup({ jev: () => blockAnswer('Others'), bundled: custom('Bundled') });
  await folder.service.submit(highlight(), 1);
  assert.ok(folder.dir.read(NOTE).includes('# Others'));

  const bundled = setup({ files: {}, jev: () => blockAnswer('Bundled', 0.99), bundled: custom('Bundled') });
  await bundled.service.submit(highlight(), 1);
  assert.ok(bundled.dir.read(NOTE).includes('# Bundled'));
  assert.equal(bundled.dir.files.has(TEMPLATE), false, 'nothing is copied into the vault');
});

test('undo deletes an untouched note made from an uploaded template', async () => {
  const { service, dir, kv } = setup({ files: {}, jev: () => blockAnswer('Mine', 0.99) });
  await kv.set('templates', [{ id: 'paper', text: '---\ntitle:\n---\n\n# Mine\n', sites: [] }]);
  const id = await service.submit(highlight(), 1);
  assert.equal((await service.remove({ id })).deletedNote, true);
  assert.equal(dir.files.has(NOTE), false);
});

const mdpiProfile = { name: 'MDPI', triggers: ['https://www.mdpi.com/'], properties: [] };

test('page status names the matching config: uploaded first, none for chats', async () => {
  const { service, kv } = setup({ profiles: [mdpiProfile], jev: () => blockAnswer('Others') });
  assert.equal((await service.pageStatus({ url: 'https://www.mdpi.com/1' })).profile.name, 'MDPI');
  assert.equal((await service.pageStatus({ url: 'https://x.org/1' })).profile, null);
  await kv.set('profiles', [{ ...mdpiProfile, properties: [{ name: 'a', value: 'b', type: 'text' }] }]);
  assert.equal((await service.pageStatus({ url: 'https://www.mdpi.com/1' })).profile.properties.length, 1);
  assert.equal((await service.allProfiles()).length, 1, 'an upload replaces the bundled one of that name');
  await kv.set('profiles', [{ ...mdpiProfile, triggers: ['https://chatgpt.com/'] }]);
  assert.equal((await service.pageStatus(chatPage)).profile, null);
});

test('a config can be chosen for one page, overriding the match, or turned off', async () => {
  const other = { name: 'Other', triggers: ['https://elsewhere.org/'], properties: [] };
  const { service } = setup({ profiles: [mdpiProfile, other], jev: () => blockAnswer('Others') });
  const url = 'https://www.mdpi.com/1/2?utm_source=x';
  const nameOf = async (u = url) => (await service.pageStatus({ url: u })).profile?.name ?? null;

  assert.deepEqual(await service.profileState({ url }), { available: true, names: ['MDPI', 'Other'], matched: 'MDPI', selected: 'auto' });
  assert.equal(await nameOf(), 'MDPI');

  await service.chooseProfile({ url, selected: 'Other' });
  assert.equal(await nameOf(), 'Other');
  assert.equal((await service.profileState({ url })).selected, 'Other');
  assert.equal(await nameOf('https://www.mdpi.com/1/2#section'), 'Other', 'the same page');
  assert.equal(await nameOf('https://www.mdpi.com/9'), 'MDPI', 'other pages are not affected');

  await service.chooseProfile({ url, selected: 'none' });
  assert.equal(await nameOf(), null);
  assert.equal((await service.profileState({ url })).selected, 'none');

  await service.chooseProfile({ url, selected: 'auto' });
  assert.equal(await nameOf(), 'MDPI');
  assert.equal((await service.profileState({ url })).selected, 'auto');
});

test('a chosen config that was removed falls back to matching', async () => {
  const { service, kv } = setup({ profiles: [mdpiProfile], jev: () => blockAnswer('Others') });
  const url = 'https://www.mdpi.com/1';
  await kv.set('profiles', [{ name: 'Mine', triggers: ['https://x.org/'], properties: [] }]);
  await service.chooseProfile({ url, selected: 'Mine' });
  assert.equal((await service.pageStatus({ url })).profile.name, 'Mine');
  await kv.set('profiles', []);
  assert.equal((await service.pageStatus({ url })).profile.name, 'MDPI');
  assert.equal((await service.profileState({ url })).selected, 'auto');
});

test('chats offer no config choice', async () => {
  const { service } = setup({ profiles: [mdpiProfile], jev: () => blockAnswer('Others') });
  assert.equal((await service.profileState({ url: chatPage.url })).available, false);
});

test('config values reach the frontmatter and name the file', async () => {
  const { service, dir, last } = setup({ jev: () => blockAnswer('Others') });
  await service.submit(highlight({
    rawPage: {
      ...paperPage,
      profile: {
        name: 'MDPI',
        values: {
          title: { value: 'Zhang(2024)-Deep Learning for', type: 'text' },
          authors: { value: ['[[Wei Zhang]]', '[[Li Ming]]'], type: 'multitext' },
          published: { value: '2024-03-05', type: 'date' },
          source: { value: 'https://www.mdpi.com/1', type: 'text' },
          keywords: { value: ['a', 'b'], type: 'multitext' },
          collection: { value: 'papers', type: 'text' },
        },
      },
    },
  }), 1);
  assert.equal(last().noteName, 'Zhang(2024)-Deep Learning for.md');
  const md = dir.read('Zhang(2024)-Deep Learning for.md');
  assert.ok(md.includes('title: "Zhang(2024)-Deep Learning for"\n'));
  assert.ok(md.includes('authors: ["[[Wei Zhang]]", "[[Li Ming]]"]\n'));
  assert.ok(md.includes('published: 2024-03-05\n'));
  assert.ok(!md.includes('source:'), 'url already holds it');
  assert.ok(md.includes('keywords: ["a", "b"]\n'));
  assert.ok(md.includes('collection: "papers"\n'));
  assert.ok(md.includes('last_annotated: '));
  const keys = md.split('\n---')[0].split('\n').slice(1).map((l) => l.split(':')[0]);
  assert.deepEqual(keys, ['title', 'authors', 'journal', 'published', 'doi', 'url', 'keywords', 'last_annotated', 'collection']);
});

test('English writes English labels, and either comment label can be edited', async () => {
  const { service, dir } = setup({ lang: 'en', jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight({ color: 'blue' }), 1);
  const md = dir.read(NOTE);
  assert.ok(md.includes('<sup>Method · <a '));
  assert.ok(md.includes('>Source</a>'));
  assert.ok(md.includes('- **Comments:** 关键结果'));
  assert.equal((await service.inspect({ id })).comment, '关键结果');
  await service.setComment({ id, comment: 'changed' });
  assert.ok(dir.read(NOTE).includes('- **Comments:** changed'));
  assert.equal((await service.pageStatus(paperPage)).colors.find((c) => c.id === 'blue').name, 'Method');
  assert.equal((await service.pageStatus(chatPage)).page.discussion, 'GPT');
});

test('saving under a pin does not rebind the page once unpinned', async () => {
  const files = { [TEMPLATE]: template, 'Pinned.md': instantiateNote('Pinned') };
  const { service, kv, last } = setup({ files, jev: () => blockAnswer('Others') });
  await service.submit(highlight(), 1);
  assert.equal(last().noteName, NOTE);
  await service.setPinned({ noteName: 'Pinned.md' });
  const id = await service.submit(highlight({ quote: 'pinned' }), 1);
  assert.equal(last().noteName, 'Pinned.md');
  assert.equal((await kv.get('entries'))[id].bindingKey, null);
  await service.setPinned({ noteName: null });
  await service.submit(highlight({ quote: 'after' }), 1);
  assert.equal(last().noteName, NOTE);
});

test('a pinned note beats a discussion, and a deleted pin clears itself', async () => {
  const files = { [TEMPLATE]: template, 'Pinned.md': instantiateNote('Pinned') };
  const { service, dir, kv, last } = setup({ files, settings: { pinned: 'Pinned.md' }, jev: () => blockAnswer('Others') });
  await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal(last().noteVia, 'pinned');
  dir.files.delete('Pinned.md');
  await service.submit(highlight({ rawPage: chatPage }), 1);
  assert.equal((await kv.get('settings')).pinned, null);
});

test('move within a note keeps a comment edited in Obsidian', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  const edited = dir.read(NOTE).replace('关键结果', '手动改过的评论');
  dir.files.set(NOTE, { text: edited, mtime: 99 });
  await service.move({ id, heading: 'Novelty' });
  const md = dir.read(NOTE);
  assert.ok(md.indexOf('data-lp="id1"') > md.indexOf('## Novelty'));
  assert.ok(md.includes('手动改过的评论'));
});

test('move to another note rebinds the page', async () => {
  const files = { [TEMPLATE]: template, 'Other.md': instantiateNote('Other Paper') };
  const { service, dir, kv, last } = setup({ files, jev: () => blockAnswer('Main Findings') });
  const id = await service.submit(highlight(), 1);
  await service.move({ id, noteName: 'Other.md', heading: 'Others' });
  assert.equal(dir.read(NOTE).includes('data-lp="id1"'), false);
  assert.ok(dir.read('Other.md').includes('data-lp="id1"'));
  assert.equal(Object.values(await kv.get('bindings'))[0], 'Other.md');
  await service.submit(highlight({ quote: 'Next' }), 1);
  assert.equal(last().noteLabel, 'Other');
});

test('a note without the chosen heading asks instead of failing', async () => {
  const files = { [TEMPLATE]: template, 'Custom.md': '---\ntitle: "Custom"\n---\n# Only\n' };
  const { service, dir, last } = setup({ files, settings: { pinned: 'Custom.md' }, jev: () => blockAnswer('Only', 0.5) });
  const id = await service.submit(highlight(), 1);
  assert.equal(last().state, 'confirm-block');
  await service.confirm({ id, heading: 'Gone' });
  assert.equal(last().state, 'confirm-block');
  assert.equal(last().reason, 'heading-missing');
  assert.deepEqual(last().options.map((o) => o.block), ['Only']);
  await service.confirm({ id, heading: 'Only' });
  assert.equal(last().state, 'saved');
  assert.ok(dir.read('Custom.md').includes('data-lp="id1"'));
});

test('missing template is reported and the highlight is kept', async () => {
  const { service, kv, last } = setup({ files: {}, jev: () => blockAnswer('Others') });
  const id = await service.submit(highlight(), 1);
  assert.equal(last().state, 'error');
  assert.match(last().message, /模板/);
  assert.ok((await kv.get('pending'))[id]);
});

test('name collision gets a suffix and keeps both notes', async () => {
  const files = { [TEMPLATE]: template, [NOTE]: instantiateNote('A Different Paper') };
  const { service, dir, last } = setup({ files, jev: () => blockAnswer('Others') });
  await service.submit(highlight(), 1);
  assert.equal(last().noteLabel, 'Vaswani(2017)-Attention All You Need-2');
  assert.ok(dir.read(NOTE).includes('A Different Paper'));
});

test('transient file errors are retried, as seen in the browser spike', async () => {
  const { service, dir, last } = setup({ jev: () => blockAnswer('Others') });
  dir.failNext = ['InvalidStateError', 'InvalidStateError'];
  await service.submit(highlight(), 1);
  assert.equal(last().state, 'saved');
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw domError('NotAllowedError'); }, [1, 1]), /NotAllowedError/);
  assert.equal(calls, 1);
});

test('concurrent highlights on one note all land', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Others') });
  await Promise.all([1, 2, 3, 4, 5].map((i) => service.submit(highlight({ quote: `q${i}` }), 1)));
  assert.equal(dir.files.size, 2);
  assert.equal(dir.read(NOTE).match(/data-lp="/g).length, 5);
});

test('template and underscore files are never note candidates', async () => {
  const files = { [TEMPLATE]: template, '_Dashboard.md': '# x', 'Real.md': instantiateNote('Real') };
  const { service } = setup({ files, jev: () => blockAnswer('Others') });
  assert.deepEqual((await service.listNotes()).map((n) => n.name), ['Real.md']);
});

// ---------------------------------------------------------------------------
// Clipping originals
// ---------------------------------------------------------------------------
const clipProfile = {
  name: 'papers-Nature', triggers: ['https://www.nature.com/'], properties: [{ name: 'doi', value: '{{meta:name:citation_doi}}', type: 'text' }],
  clip: { noteContentFormat: '{{content}}', noteNameFormat: '{{title}}', path: 'references/papers', properties: [] },
};
const clipResult = (body = 'A paragraph of the paper, long enough to read as one. '.repeat(8), doi = '10.1000/abc') => ({
  noteName: 'Attention Is All You Need', path: 'references/papers', fullContent: `---\ndoi: "${doi}"\n---\n${body}`,
});
const REF = 'references/papers/Attention Is All You Need.md';
// A clip as written: the extension adds the day it was clipped (setup's clock), and
// the notes that link it.
const stamped = (body, extra = '') => `---\ndoi: "10.1000/abc"\nclipped: 2026-11-05\n${extra}---\n${body}`;
// As saved: an archive, each paragraph with its block id.
const PARAGRAPHS = finishArchive(clipResult().fullContent).split('---\n')[2];

test('a new note\'s page is clipped at once when its type says so, and only then', async () => {
  const requests = [];
  const { service, last } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile], requestClip: (r) => requests.push(r) });
  await service.submit(highlight(), 4);
  assert.deepEqual(last().clip, { state: 'auto', isPaper: true }, 'papers clip by default');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(requests, [{ tabId: 4, pageKey: paperPage.url, noteName: NOTE }]);
  await service.submit(highlight({ quote: 'Another one.', exact: 'Another one.' }), 4);
  assert.equal(last().clip, null, 'the note already existed');
  // A paper without a config of its own is a paper too, clipped by the general config.
  const plain = setup({ jev: () => blockAnswer('Others') });
  await plain.service.submit(highlight(), 1);
  assert.deepEqual(plain.last().clip, { state: 'auto', isPaper: true });
});

test('a type set not to clip leaves it to the popup', async () => {
  const { service, kv, last } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await kv.set('docTypes', [{ id: 'paper', autoClip: false, clipPath: '' }, { id: 'article', autoClip: true, clipPath: '' }]);
  await service.submit(highlight(), 4);
  assert.equal(last().created, true);
  assert.equal(last().clip, null);
});

test('a clip is written under its path and linked from the note', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await service.submit(highlight(), 1);
  const r = await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult() });
  assert.deepEqual(r, { status: 'created', file: REF, label: 'Attention Is All You Need', linked: 'Vaswani(2017)-Attention All You Need', problems: [], warning: null });
  const backLink = 'notes: "[[Vaswani(2017)-Attention All You Need]]"\n';
  assert.equal(dir.read(REF), stamped(PARAGRAPHS, backLink), 'the original links its note back');
  assert.ok(dir.read(NOTE).includes('references: "[[Attention Is All You Need]]"\n'));
  assert.ok(dir.read(NOTE).endsWith('\n# References\n\n- [[Attention Is All You Need]]\n'), 'and under its References heading');
  // Again: the file is kept unless asked to clip again, and no link is doubled.
  assert.equal((await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult('new') })).status, 'existing');
  assert.equal(dir.read(REF), stamped(PARAGRAPHS, backLink));
  assert.equal((await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult('new'), force: true })).status, 'updated');
  assert.equal(dir.read(REF), stamped(finishArchive('new'), `clip_review: "incomplete, check against the page: body nearly empty"\n${backLink}`), 'one that looks wrong says so');
  await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult(), force: true });
  assert.equal(dir.read(REF), stamped(PARAGRAPHS, backLink), 'clipped again and whole, it no longer does');
  assert.equal(dir.read(NOTE).match(/\[\[Attention Is All You Need\]\]/g).length, 2, 'once in the property, once in the text');
});

test('each entry points to its paragraph in the original, whether clipped before or after', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await service.submit(highlight({ exact: 'We found an effect.', quote: 'We found an effect.' }), 1);
  const body = 'Some background, long enough to read as a paragraph of its own here.\n\nWe found an effect. It held in every trial we ran, across all of the samples.\n';
  await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult(body) });
  const clip = dir.read(REF);
  const block = clip.match(/We found an effect\..* \^(p-[a-z0-9]+)$/m)[1];
  const target = `Attention Is All You Need#^${block}`;
  assert.ok(dir.read(NOTE).includes(` data-clip="${target}"`), 'an entry saved before the clip');
  // After the clip: at once. A highlight running into the next paragraph points to where it starts.
  await service.submit(highlight({ id: 'later', exact: 'long enough to read as a paragraph of its own here. We found', quote: 'long enough to read as a paragraph of its own here. We found' }), 1);
  const first = clip.match(/Some background.* \^(p-[a-z0-9]+)$/m)[1];
  assert.match(dir.read(NOTE), new RegExp(`data-clip="Attention Is All You Need#\\^${first}"`));
  // Text the original doesn't hold gets nothing.
  await service.submit(highlight({ exact: 'Words found nowhere in it.', quote: 'Words found nowhere in it.' }), 1);
  assert.equal(dir.read(NOTE).match(/data-clip=/g).length, 2);
});

test('a clip that looks broken is saved, with a warning naming what is wrong', async () => {
  const { service, dir } = setup({ profiles: [clipProfile] });
  const result = { ...clipResult(), page: { formulas: 12, failedSteps: [] } };
  const r = await service.saveClip({ url: paperPage.url, result });
  assert.equal(dir.read(REF), stamped(PARAGRAPHS, 'clip_check: "formulas 0/12"\nclip_review: "incomplete, check against the page: formulas 0/12"\n'), 'how complete it is, and that it needs checking, for whoever reads it later');
  assert.deepEqual(r.problems, [{ code: 'formulas', page: 12, clip: 0 }]);
  assert.match(r.warning, /12 个公式，剪藏里只有 0 个/);
  assert.match(r.warning, /Options 里勾选 Include Hidden MathML/, 'with what to try on the page');
  // Kept as it was: nothing new to judge.
  assert.equal((await service.saveClip({ url: paperPage.url, result })).warning, null);
});

test('a clip from the popup finds the note through the page\'s highlights', async () => {
  const { service, dir } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await service.submit(highlight(), 1);
  const r = await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.equal(r.linked, 'Vaswani(2017)-Attention All You Need');
  assert.ok(dir.read(NOTE).includes('references: "[[Attention Is All You Need]]"'));
  const fresh = setup({ profiles: [clipProfile] });
  assert.equal((await fresh.service.saveClip({ url: paperPage.url, result: clipResult() })).linked, null, 'no note yet');
});

test('a file of another work with the same name is not overwritten', async () => {
  const other = '---\ndoi: "10.9/other"\n---\nother paper';
  const { service, dir } = setup({ files: { [TEMPLATE]: template, [REF]: other }, profiles: [clipProfile] });
  const r = await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.equal(r.file, 'references/papers/Attention Is All You Need-2.md');
  assert.equal(dir.read(REF), other);
  // One of the same work, such as a Web Clipper clip, is found and kept.
  const same = setup({ files: { [TEMPLATE]: template, [REF]: '---\ndoi: "10.1000/ABC"\n---\nfrom Web Clipper' }, profiles: [clipProfile] });
  assert.equal((await same.service.saveClip({ url: paperPage.url, result: clipResult() })).status, 'existing');
  assert.equal(same.dir.read(REF), '---\ndoi: "10.1000/ABC"\nclipped: 2026-11-05\n---\nfrom Web Clipper', 'kept, and now on the dashboard');
});

test('later highlights link the clipped original, and clip folders are never notes', async () => {
  // A clipped paper carries the paper's DOI, so scanning it would route highlights into it.
  const files = { [TEMPLATE]: template, [REF]: '---\ndoi: "10.1000/abc"\n---\n## Others\n' };
  const { service, dir, last } = setup({ files, jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await service.saveClip({ url: paperPage.url, result: clipResult() }).catch(() => {});
  await service.submit(highlight(), 1);
  assert.equal(last().noteName, NOTE, 'a new reading note, not the clipped original');
  assert.deepEqual(last().clip, { state: 'linked', label: 'Attention Is All You Need' });
  assert.ok(dir.read(NOTE).includes('references: "[[Attention Is All You Need]]"'));
  assert.ok(dir.read(NOTE).includes('# References\n\n- [[Attention Is All You Need]]'));
  assert.ok(!dir.read(REF).includes('data-lp'));
});

test('clips go to the chosen vault root, which may hold the notes folder', async () => {
  const vault = new FakeDir({ [`notes/${TEMPLATE}`]: template });
  const notesDir = await vault.getDirectoryHandle('notes');
  const kv = memoryKv();
  const service = createService({
    getFolder: async () => notesDir, getClipFolder: async () => vault, kv, getJevKey: async () => '', askJev: async () => ({}),
    notify: async () => {}, now: () => new Date(2026, 10, 5), newId: () => 'a', getDefaultProfiles: async () => [clipProfile],
  });
  const r = await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.equal(r.file, REF);
  assert.ok(vault.read(REF));
  assert.ok(!vault.read(`notes/${REF}`));
  const status = await service.clipStatus({ url: paperPage.url });
  assert.equal(status.file, REF);
  assert.equal(status.mode, 'ask');
  const blog = await service.clipStatus({ url: 'https://blog.org/post' });
  assert.equal(blog.available, true, 'the general article config');
  assert.equal((await service.clipProfile('https://blog.org/post')).clip.path, 'references/articles');
  assert.deepEqual(await service.clipStatus({ url: 'https://chatgpt.com/c/1' }), { available: false }, 'never a conversation');
});

test('every folder of the vault is offered for notes; a clipped original there is still no note', async () => {
  const files = { [TEMPLATE]: template, [REF]: '---\ndoi: "10.1000/abc"\nclipped: 2026-11-04\n---\n## Others\n', 'reading/a.md': '---\n---\n' };
  const { service, kv, dir, last } = setup({ files, jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  assert.deepEqual(await service.listFolders(), ['reading', 'references', 'references/papers']);
  // Notes kept with the clipped originals.
  await kv.set('templates', [{ id: 'paper', folder: 'references/papers' }]);
  await service.submit(highlight(), 1);
  assert.equal(last().noteName, `references/papers/${NOTE}`, 'a new reading note, not the clipped original');
  assert.ok(!dir.read(REF).includes('data-lp'));
  // And found again by the next highlight.
  await service.submit(highlight({ quote: 'another' }), 2);
  assert.equal(last().noteName, `references/papers/${NOTE}`);
});

// ---------------------------------------------------------------------------
// Page comments
// ---------------------------------------------------------------------------
test('a page comment goes into the note\'s comments; before there is a note, it waits for one', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await kv.set('docTypes', [{ id: 'paper', autoClip: false }]);
  assert.deepEqual(await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: '  值得精读，方法部分写得清楚。 ', tabId: 3 }), { state: 'saved', text: '值得精读，方法部分写得清楚。', clipping: false });
  const waiting = await service.reviewStatus({ url: paperPage.url, rawPage: paperPage });
  assert.equal(waiting.text, '值得精读，方法部分写得清楚。');
  assert.equal(waiting.note, null);
  assert.equal(waiting.auto, false);
  // The page's first highlight makes the note, which takes the comment.
  await service.submit(highlight(), 1);
  assert.ok(dir.read(NOTE).includes('comments: "值得精读，方法部分写得清楚。"\n'), dir.read(NOTE));
  assert.deepEqual(await kv.get('reviews'), {}, 'no longer kept in the extension');
  const status = await service.reviewStatus({ url: paperPage.url });
  assert.equal(status.note, 'Vaswani(2017)-Attention All You Need', 'the popup finds it by the address');
  assert.equal(status.text, '值得精读，方法部分写得清楚。');
  // A clip gets no comment of its own.
  await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.ok(!dir.read(REF).includes('comments'));
});

test('one switch per type clips both with a new note and with a page comment', async () => {
  const requests = [];
  const { service, kv } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile], requestClip: (r) => requests.push(r) });
  // A second switch an earlier version stored is of no account.
  await kv.set('docTypes', [{ id: 'paper', autoClip: true, reviewClip: false }, { id: 'article', autoClip: false, reviewClip: true }]);
  await service.submit(highlight(), 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(requests.map((r) => r.tabId), [1], 'a paper clips with its new note');
  assert.equal((await service.reviewStatus({ url: blogPage.url, rawPage: blogPage })).auto, false);
  assert.equal((await service.saveReview({ url: blogPage.url, rawPage: blogPage, text: 'y', tabId: 3 })).clipping, false, 'an article doesn\'t, with a comment either');
  assert.equal((await service.reviewStatus({ url: paperPage.url, rawPage: paperPage })).auto, true);
  assert.equal((await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'x', tabId: 2 })).clipping, true, 'a paper does, with a comment too');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(requests.map((r) => r.tabId), [1, 2]);
});

test('a page comment on a page with no note shows on the dashboard: it is in the original until the note comes', async () => {
  const requests = [];
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile], requestClip: (r) => requests.push(r) });
  const r = await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'Only commented, never highlighted.', tabId: 5 });
  assert.deepEqual(r, { state: 'saved', text: 'Only commented, never highlighted.', clipping: true });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(requests, [{ tabId: 5, pageKey: paperPage.url, noteName: undefined }]);
  // The clip it asked for: the comment goes into the original, the one place there is.
  await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.equal(dir.read(REF), stamped(PARAGRAPHS, 'comments: "Only commented, never highlighted."\n'));
  // Edited in Obsidian, then again from the page.
  dir.files.set(REF, { text: dir.read(REF).replace('Only commented', 'Edited'), mtime: 2 });
  assert.equal((await service.reviewStatus({ url: paperPage.url, rawPage: paperPage })).text, 'Edited, never highlighted.');
  await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'Second thoughts.', tabId: 5 });
  assert.ok(dir.read(REF).includes('comments: "Second thoughts."\n'));
  assert.equal(requests.length, 1, 'clipped already');
  // The first highlight makes the note: the comment moves there, and the original
  // links it instead.
  await service.submit(highlight(), 1);
  assert.ok(dir.read(NOTE).includes('comments: "Second thoughts."\n'));
  assert.ok(dir.read(NOTE).includes('references: "[[Attention Is All You Need]]"'));
  assert.equal(dir.read(REF), stamped(PARAGRAPHS, 'notes: "[[Vaswani(2017)-Attention All You Need]]"\n'));
  assert.deepEqual(await kv.get('reviews'), {});
});

test('an original clipped before its comment gets it at once, and an old one in the original gives way to the note\'s', async () => {
  const { service, dir, kv } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await kv.set('docTypes', [{ id: 'paper', autoClip: false }]);
  await service.saveClip({ url: paperPage.url, result: clipResult() });
  await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'After the clip.' });
  assert.ok(dir.read(REF).includes('comments: "After the clip."\n'));
  await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: '' });
  assert.ok(!dir.read(REF).includes('comments'), 'deleted');
  // An earlier version wrote comments into originals; the note's takes over.
  await service.submit(highlight(), 1);
  dir.files.set(REF, { text: dir.read(REF).replace('clipped:', 'comments: "old, in the original"\nclipped:'), mtime: 3 });
  await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'In the note.' });
  assert.ok(dir.read(NOTE).includes('comments: "In the note."\n'));
  assert.ok(!dir.read(REF).includes('comments'));
});

test('with clipping on, a page comment goes into the note, and the clip is linked from it', async () => {
  const requests = [];
  const { service, dir } = setup({ jev: () => blockAnswer('Others'), profiles: [clipProfile], requestClip: (r) => requests.push(r) });
  await service.submit(highlight(), 1);
  await new Promise((r) => setTimeout(r, 5));
  requests.length = 0;
  const r = await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'first take', tabId: 7 });
  assert.deepEqual(r, { state: 'updated', label: 'Vaswani(2017)-Attention All You Need', text: 'first take', clipping: true });
  assert.ok(dir.read(NOTE).includes('comments: "first take"\n'));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(requests, [{ tabId: 7, pageKey: paperPage.url, noteName: NOTE }]);
  await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult() });
  const note = dir.read(NOTE);
  assert.ok(note.includes('references: "[[Attention Is All You Need]]"\n'));
  assert.ok(note.endsWith('# References\n\n- [[Attention Is All You Need]]\n'));
  // Edited in Obsidian: that is the text to edit next.
  dir.files.set(NOTE, { text: dir.read(NOTE).replace('first take', 'edited in Obsidian'), mtime: 2 });
  assert.equal((await service.reviewStatus({ url: paperPage.url, rawPage: paperPage })).text, 'edited in Obsidian');
  const again = await service.saveReview({ url: paperPage.url, rawPage: paperPage, text: 'second "take"\nwith a line', tabId: 7 });
  assert.equal(again.clipping, false, 'clipped already');
  assert.ok(dir.read(NOTE).includes('comments: "second \\"take\\"\\nwith a line"\n'), 'one YAML line');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(requests.length, 1, 'no second clip');
  await service.saveReview({ url: paperPage.url, text: '' });
  assert.ok(dir.read(NOTE).includes('comments:\n'), 'cleared');
  assert.equal((await service.reviewStatus({ url: paperPage.url })).text, '');
});

// Notes as earlier versions left them: no References heading, links in `reference`.
const olderNote = (property) => `---\ntitle: "Attention Is All You Need"\ndoi: "10.1000/abc"\n${property}last_annotated: 2026-11-01T10:00\n---\n\n# Summary\n\n## Main Findings\n\n> quote\n\n# Others\n`;

test('a note from an earlier version gets `references` and a References heading listing all its originals', async () => {
  const files = { [TEMPLATE]: template, [NOTE]: olderNote('reference: "[[Older Original]]"\n') };
  const { service, dir } = setup({ files, profiles: [clipProfile] });
  await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult() });
  const note = dir.read(NOTE);
  assert.ok(note.includes('references: ["[[Older Original]]", "[[Attention Is All You Need]]"]\n'), note);
  assert.ok(!/^reference:/m.test(note));
  assert.ok(note.endsWith('> quote\n\n# Others\n\n# References\n\n- [[Older Original]]\n- [[Attention Is All You Need]]\n'), note);
  // Clipped again: nothing doubled.
  await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult(), force: true });
  assert.equal(dir.read(NOTE), note);
});

test('an earlier note found by its DOI is linked when the page is clipped, its links one per line kept so', async () => {
  const files = { [TEMPLATE]: template, [NOTE]: olderNote('reference:\n  - "[[Older Original]]"\n') };
  const { service, dir } = setup({ files, profiles: [clipProfile] });
  const r = await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.equal(r.linked, 'Vaswani(2017)-Attention All You Need', 'found without a highlight on this page');
  const note = dir.read(NOTE);
  assert.ok(note.includes('references:\n  - "[[Older Original]]"\n  - "[[Attention Is All You Need]]"\n'), note);
  assert.ok(note.endsWith('# References\n\n- [[Older Original]]\n- [[Attention Is All You Need]]\n'), note);
});

test('an earlier note already listing originals under References keeps them, adding the new one', async () => {
  const md = `${olderNote('references: "[[Older Original]]"\n')}\n# References\n\n- [[Older Original|older]]\n- see also the book\n`;
  const { service, dir } = setup({ files: { [TEMPLATE]: template, [NOTE]: md }, profiles: [clipProfile] });
  await service.saveClip({ url: paperPage.url, noteName: NOTE, result: clipResult() });
  assert.ok(dir.read(NOTE).endsWith('# References\n\n- [[Older Original|older]]\n- see also the book\n- [[Attention Is All You Need]]\n'), dir.read(NOTE));
});

test('page comments are refused where nothing can be clipped, and kept short', async () => {
  const { service } = setup();
  await assert.rejects(service.saveReview({ url: 'https://chatgpt.com/c/1', text: 'x' }));
  assert.deepEqual(await service.reviewStatus({ url: 'https://chatgpt.com/c/1' }), { available: false });
  const { text } = await service.saveReview({ url: 'https://blog.org/post', text: 'a'.repeat(5000) });
  assert.equal(text.length, 2000);
});

test('a note linking an original clipped earlier is linked back from it', async () => {
  const files = { [TEMPLATE]: template, [REF]: '---\ndoi: "10.1000/abc"\n---\nbody' };
  const { service, dir } = setup({ files, jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await service.saveClip({ url: paperPage.url, result: clipResult() }).catch(() => {});
  await service.submit(highlight(), 1);
  assert.ok(dir.read(REF).includes('notes: "[[Vaswani(2017)-Attention All You Need]]"'));
});

test('a clip without a named note links the page\'s bound note, not one a highlight was moved to', async () => {
  const { service, kv, dir } = setup({ files: { [TEMPLATE]: template, 'Other.md': '---\ntitle: "Other"\n---\n## Others\n' }, jev: () => blockAnswer('Others'), profiles: [clipProfile] });
  await service.submit(highlight(), 1);
  // The page's first highlight now sits in another note.
  await kv.set(`hl:${paperPage.url}`, { a: { id: 'a', anchor: 'x', noteName: 'Other.md' }, ...(await kv.get(`hl:${paperPage.url}`)) });
  const r = await service.saveClip({ url: paperPage.url, result: clipResult() });
  assert.equal(r.linked, 'Vaswani(2017)-Attention All You Need');
  assert.ok(dir.read(REF).includes('notes: "[[Vaswani(2017)-Attention All You Need]]"'));
});

// ---------------------------------------------------------------------------
// Configs linked to a template and a clip folder
// ---------------------------------------------------------------------------
const natureProfile = { name: 'papers-Nature', triggers: ['https://www.nature.com/articles/'], properties: [{ name: 'journal', value: 'Nature', type: 'text' }], clip: { ...clipProfile.clip } };
const articleProfile = { name: 'web-article', fallback: true, triggers: [], properties: [], clip: { noteContentFormat: '{{content}}', noteNameFormat: '{{title}}', path: 'references/articles', properties: [] } };

test('a config\'s linked template starts its new notes, without asking', async () => {
  const { service, dir, kv, last } = articleSetup({ jev: () => blockAnswer('Claims', 0.97), profiles: [natureProfile, articleProfile] });
  await kv.set('templates', [{ id: 'c1', name: 'Mine', text: '---\ntitle:\n---\n\n# Claims\n', sites: [] }]);
  await kv.set('profileLinks', { 'papers-Nature': { template: 'c1' } });
  await service.submit(highlight(), 1);
  assert.equal(last().created, true);
  assert.ok(dir.read(NOTE).includes('# Claims'));
});

test('a site tied to a template comes before the config\'s link', async () => {
  const { service, dir, kv } = articleSetup({ jev: () => blockAnswer('Key Ideas', 0.97), profiles: [natureProfile, articleProfile] });
  await kv.set('templates', [
    { id: 'c1', name: 'Mine', text: '---\ntitle:\n---\n\n# Claims\n', sites: [] },
    { id: 'article', sites: ['*.substack.com'] },
  ]);
  // The general config's link would send every other page to Mine.
  await kv.set('profileLinks', { 'web-article': { template: 'c1' } });
  await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.ok(dir.read('A Good Post.md').includes('# Key Ideas'), 'the site rule wins');
});

test('a type\'s folder is where its originals are clipped, and is no place for notes', async () => {
  const { service, dir, kv } = setup({ profiles: [natureProfile, articleProfile] });
  assert.equal((await service.clipProfile(paperPage.url)).clip.path, 'references/papers', 'the config\'s own folder');
  await kv.set('docTypes', [{ id: 'paper', autoClip: true, clipPath: ' 文献/原文 ' }, { id: 'article', autoClip: false, clipPath: 'web' }]);
  assert.equal((await service.clipProfile(paperPage.url)).clip.path, '文献/原文');
  assert.equal((await service.clipProfile('https://blog.org/post')).clip.path, 'web');
  assert.equal((await service.clipProfile('https://blog.org/post')).name, 'web-article', 'the bundled file');
  // A paper with no config of its own: the general config, in the papers' folder.
  const bare = await service.clipProfile('https://journal.org/paper/1', { isPaper: true });
  assert.deepEqual([bare.name, bare.clip.path], ['web-article', '文献/原文']);
  const r = await service.saveClip({ url: paperPage.url, result: { ...clipResult(), path: '文献/原文' } });
  assert.equal(r.file, '文献/原文/Attention Is All You Need.md');
  dir.files.set('文献/原文/x.md', { text: '---\n---\n', mtime: 1 });
  dir.files.set('reading/a.md', { text: '---\n---\n', mtime: 1 });
  assert.deepEqual(await service.listFolders(), ['reading', '文献', '文献/原文']);
});

test('an earlier version\'s clip settings become the types\' until they are changed', async () => {
  const { service, kv } = setup({ profiles: [articleProfile] });
  await kv.set('clip', { mode: 'auto', field: 'reference', articlePath: 'old/articles' });
  assert.equal((await service.clipProfile('https://blog.org/post')).clip.path, 'old/articles');
  assert.deepEqual((await service.docTypes()).map((x) => [x.id, x.autoClip]), [['paper', true], ['article', true]]);
  await kv.set('docTypes', [{ id: 'article', autoClip: false, clipPath: 'new' }]);
  assert.equal((await service.clipProfile('https://blog.org/post')).clip.path, 'new');
});

test('a config put in a type the person added gives its pages that type\'s template, without asking', async () => {
  const blogProfile = { name: 'blog', triggers: ['https://a.substack.com/'], properties: [{ name: 'site', value: 'x', type: 'text' }] };
  const { service, dir, kv, last, jevCalls } = articleSetup({ jev: () => blockAnswer('Claims', 0.97), profiles: [natureProfile, articleProfile, blogProfile] });
  await kv.set('docTypes', [{ id: 'b1', name: 'Blogs', autoClip: false, clipPath: 'blogs' }]);
  await kv.set('templates', [{ id: 'b1', text: '---\ntitle:\n---\n\n# Claims\n', folder: 'blog-notes' }]);
  await kv.set('profileTypes', { blog: 'b1' });
  assert.deepEqual(await service.profileTypes(), { 'papers-Nature': 'paper', 'web-article': 'article', blog: 'b1' });
  await service.submit(highlight({ rawPage: articlePage }), 1);
  assert.equal(last().created, true);
  assert.equal(last().noteName, 'blog-notes/A Good Post.md');
  assert.ok(dir.read('blog-notes/A Good Post.md').includes('# Claims'));
  assert.equal(last().clip, null);
  assert.equal((await service.clipProfile(articlePage.url)).clip.path, 'blogs', 'its originals go to the type\'s folder');
  // Without a template of its own, the type starts from the article one, still
  // without asking which note.
  await kv.set('templates', []);
  await service.submit(highlight({ rawPage: { ...articlePage, url: 'https://a.substack.com/p/other', docTitle: 'Other', meta: { 'og:title': ['Other'] } } }), 1);
  assert.equal(last().state, 'confirm-block');
  assert.equal(last().noteLabel, 'Other');
  assert.ok(jevCalls.at(-1).questions.block.criteria['Key Ideas'], 'the article template\'s headings');
});
