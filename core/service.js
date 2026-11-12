// The save pipeline: routes a highlight to a note and block, then writes it. Chrome
// APIs are injected so the whole flow runs under Node with an in-memory folder.

import {
  insertEntry, removeEntry, moveEntry, extractEntry, insertEntryLines, setEntryStyle, setEntryComment, setEntryClip, readComment, hasEntry, countEntries, headingOfEntry, noteBody,
  leafHeadings, setFrontmatterField, sortFrontmatter, instantiateTemplate, noteFileName, readFrontmatter, addFrontmatterLink, NoteError,
  addReferenceLink, renameFrontmatterField, frontmatterLinks, removeFrontmatterField,
} from './note.js';
import './i18n.js';
import './profile-engine.js';
import { colorById, colorList, purposeOf } from './colors.js';
import { siteActive, conversationKey, discussionLabel } from './sites.js';
import { normalizePage, bindingKey, resolveNote } from './page.js';
import { AUTO_SAVE_PROBABILITY, MIN_AUTO_SAVE_PERCENT, buildBlockRequest, buildNoteRequest, buildCrossNoteRequest, decideBlock, decideNote } from './router.js';
import { allTemplates, pickTemplate } from './templates.js';
import { docTypesOf, profileTypeOf, pageTypeOf } from './doctypes.js';
import { clipProblems, clipCheckLine, clipReviewLine } from './clip-check.js';
import { finishArchive, paragraphOf } from './archive.js';
import { TEMPLATE_NAME, readFile, updateFile, createFile, fileExists, deleteFile, scanNotes, dashboardFileName, cleanFolderPath, listFolders, relativeFolder } from './vault.js';

const { t } = globalThis.SelectiophileI18n;

const ENTRY_LOG_LIMIT = 200;
const DISCUSSION_CANDIDATES = 15;
// A note this likely at the first look is linked to the conversation too.
const LINK_PROBABILITY = 0.2;
const MAX_LINKED_NOTES = 8;
const DISCUSSION_MEMORY = 300;
const PROFILE_CHOICE_MEMORY = 200;
const CLIP_MEMORY = 500;
const REVIEW_MEMORY = 1000;
export const MAX_REVIEW_CHARS = 2000;
// When a page is clipped by itself, and where, is set per document type
// (core/doctypes.js); `mode`, `articlePath` and `reviewAuto` (clip on a page comment)
// are earlier versions' settings, read only to derive the types.
export const DEFAULT_CLIP = { mode: 'ask', field: 'references', reviewAuto: true };
// The note's property linking its clipped originals was `reference` before; a note
// that still has it gets it renamed when the next link is added.
export const LEGACY_LINK_FIELD = 'reference';
export const linkFieldOf = (stored) => {
  const field = String(stored?.field || '').trim();
  return !field || field === LEGACY_LINK_FIELD ? DEFAULT_CLIP.field : field;
};
// Properties the extension writes in a clipped original: when it was clipped (what
// the dashboard lists by) and the notes that link it. Earlier versions also put the
// page comment there, as `comments`; it now goes in the note.
export const CLIP_FIELDS = { time: 'clipped', comments: 'comments', notes: 'notes', check: 'clip_check', review: 'clip_review' };
// The page comment, in the note.
export const COMMENTS_FIELD = 'comments';
export const CLIP_MODES = ['ask', 'auto', 'off'];
export const DEFAULT_ROUNDS = 2;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// To the minute. The `T` is what makes Dataview and Obsidian read it as a date.
const localDateTime = (d) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const displayName = (name) => name.replace(/\.md$/, '');
const baseName = (name) => name.split('/').pop();

// Where a template sends its new notes, inside the chosen folder.
const inFolder = (template, fileName) => {
  const folder = cleanFolderPath(template?.folder);
  return folder ? `${folder}/${fileName}` : fileName;
};

// A chat's URL must not become a paper's `url`, nor its metadata the note's.
const noteMeta = (job) => (job.page.discussion ? { title: job.page.title } : job.page);

export function createService({
  getFolder, kv, askJev, getJevKey, notify, now = () => new Date(), newId,
  getLang = async () => 'zh', getBundledTemplate = async () => null, getDefaultProfiles = async () => [],
  onNoteWritten = async () => {},
  // The folder clipped originals go in, normally the vault root; the notes folder if none.
  getClipFolder = async () => null,
  // Clips a tab's page in the background, for the automatic mode.
  requestClip = () => {},
}) {
  // One write at a time: two highlights must not read the same version of a note.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const getMap = async (key) => (await kv.get(key)) || {};

  // The setting is a whole percentage. Anything unusable falls back to the default.
  const autoSaveThreshold = async () => {
    const percent = await kv.get('autoSavePercent');
    return Number.isFinite(percent) && percent >= MIN_AUTO_SAVE_PERCENT && percent <= 100 ? percent / 100 : AUTO_SAVE_PROBABILITY;
  };
  const patchMap = async (key, change) => {
    const map = await getMap(key);
    change(map);
    await kv.set(key, map);
    return map;
  };

  const scan = async (dir) => scanNotes(dir, await getMap('noteIndex'), {
    dashboardName: dashboardFileName((await kv.get('dashboard'))?.name),
    skipFolders: await clipFolders(dir),
  });

  // ---------------------------------------------------------------------------
  // Clipping originals
  // ---------------------------------------------------------------------------
  const clipSettings = async () => {
    const stored = (await kv.get('clip')) || {};
    return {
      mode: CLIP_MODES.includes(stored.mode) ? stored.mode : DEFAULT_CLIP.mode,
      field: linkFieldOf(stored),
    };
  };

  // ---------------------------------------------------------------------------
  // Document types
  // ---------------------------------------------------------------------------
  const docTypes = async () => docTypesOf(await kv.get('docTypes'), {
    clip: await kv.get('clip'), templates: await kv.get('templates'),
  });
  const typeContext = async () => [await getMap('profileTypes'), await docTypes(), await getMap('profileLinks')];

  // A page's type, with `matched` when a site rule or a config chose it. A site tied
  // to a type's template comes first, the most specific rule winning.
  async function pageType(page) {
    const [assigned, types, links] = await typeContext();
    const own = (await templates()).filter((tpl) => types.some((x) => x.id === tpl.id));
    const bySite = page.discussion ? null : pickTemplate(own, page.url, false);
    if (bySite?.matched) return { id: bySite.template.id, matched: true, type: types.find((x) => x.id === bySite.template.id) };
    const profile = page.discussion ? null : await profileFor(page.url, page.url);
    const found = pageTypeOf({ profile, isPaper: page.isPaper, discussion: page.discussion }, assigned, types, links);
    return { ...found, type: types.find((x) => x.id === found.id) || types[0] };
  }

  // A type's folder for clips, from the vault root, takes the place of the config's.
  const withTypePath = (profile, type) => (profile?.clip && type?.clipPath
    ? { ...profile, clip: { ...profile.clip, path: type.clipPath } }
    : profile);

  // The general article config: the bundled file, or the one uploaded in its place.
  async function articleProfile() {
    return (await allProfiles()).find((p) => p.fallback && p.clip) || BUILTIN_ARTICLE;
  }

  // Only if the bundled file is missing.
  const BUILTIN_ARTICLE = {
    name: 'web-article',
    fallback: true,
    triggers: [],
    properties: [],
    clip: {
      noteNameFormat: '{{title}}',
      noteContentFormat: '{{content}}',
      path: 'references/articles',
      properties: [
        { name: 'title', value: '{{title}}', type: 'text' },
        { name: 'source', value: '{{url}}', type: 'text' },
        { name: 'author', value: '{{author}}', type: 'text' },
        { name: 'site', value: '{{site}}', type: 'text' },
        { name: 'published', value: '{{published}}', type: 'date' },
        { name: 'created', value: '{{date}}', type: 'date' },
        { name: 'description', value: '{{description}}', type: 'text' },
      ],
    },
  };

  const clipRoot = async () => (await getClipFolder()) || (await getFolder());

  // Folders of clipped originals that fall inside the notes folder. A clipped paper
  // has the paper's DOI, so scanning it as a note would send highlights into it. One
  // that a type's notes go into, or into a folder of, is scanned all the same; its
  // clips are told apart by their `clipped` property.
  async function clipFolders(dir) {
    const noteFolders = (await templates()).map((tpl) => cleanFolderPath(tpl.folder || '').toLowerCase()).filter(Boolean);
    const holdsNotes = (folder) => noteFolders.some((n) => n === folder.toLowerCase() || n.startsWith(`${folder.toLowerCase()}/`));
    const paths = new Set([
      ...[...(await allProfiles()), BUILTIN_ARTICLE].map((p) => p.clip?.path),
      ...(await docTypes()).map((x) => x.clipPath),
    ]
      .filter((path) => path && !path.includes('{{'))
      .map(cleanFolderPath)
      .filter(Boolean));
    if (!paths.size) return [];
    const root = (await getClipFolder()) || dir;
    const found = [];
    for (const path of paths) {
      try {
        const rel = await relativeFolder(dir, root, path);
        if (rel && !holdsNotes(rel)) found.push(rel);
      } catch {
        // A clip folder without permission can't hold notes we'd scan anyway.
      }
    }
    return found;
  }

  // A page's own config if it clips, else the general article one, with its type's
  // folder. Conversations are never clipped. Only the address may be known, as in the
  // popup, so `isPaper` tells a paper with no config of its own from an article.
  async function clipProfile(url, { isPaper = false } = {}) {
    const page = normalizePage({ url });
    if (page.discussion || !/^https?:/.test(page.url)) return null;
    const profile = await profileFor(url, page.url);
    const { type } = await pageType({ ...page, isPaper });
    return withTypePath(profile?.clip ? profile : await articleProfile(), type);
  }

  // The original already clipped for this page, if its file is still there.
  async function clippedFile(pageKey) {
    const record = (await getMap('clips'))[pageKey];
    if (!record) return null;
    const root = await clipRoot();
    if (!root || (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') return record.file;
    if (await fileExists(root, record.file)) return record.file;
    await patchMap('clips', (m) => { delete m[pageKey]; });
    return null;
  }

  const clipLabel = (file) => displayName(baseName(file));

  // One sentence for whatever looks wrong in a clip, or null.
  const clipWarning = (problems) => {
    if (!problems.length) return null;
    const says = problems.map((p) => ({
      empty: () => t('正文几乎是空的'),
      formulas: () => t('网页上有 {page} 个公式，剪藏里只有 {clip} 个', { page: p.page, clip: p.clip }),
      leftovers: () => t('有没处理完的标记：{sample}', { sample: p.sample }),
      prep: () => t('整理网页时出错（{steps}）', { steps: p.steps.join(', ') }),
      missing: () => t('网页正文有 {missing} 段没剪下来（共 {blocks} 段），例如“{sample}”', { missing: p.missing, blocks: p.blocks, sample: p.sample }),
      duplicates: () => t('有 {count} 处图片或段落重复', { count: p.count }),
    })[p.code]());
    const text = t('剪藏可能不完整：{problems}。网站可能改版了，这个网站的配置需要更新。', { problems: says.join(t('；')) });
    // Clipping reads MathJax's HTML output; a page set to SVG has none.
    return problems.some((p) => p.code === 'formulas')
      ? `${text} ${t('也可以在网页的公式上右键，在 MathJax 菜单的 Options 里勾选 Include Hidden MathML，再剪藏一次。')}`
      : text;
  };

  // A file Web Clipper wrote without properties still gets ours.
  const withFrontmatter = (md) => (/^---\r?\n/.test(md) ? md : `---\n---\n${md}`);

  // The note links its original, and the original its notes. The second is a
  // convenience, so a clip folder without permission doesn't fail the first.
  // In the note: a link in its property, and one under its References heading. A
  // note from an earlier version gets the heading too, listing every original its
  // property links, so the two agree.
  async function linkClip(dir, noteName, file, field) {
    await updateFile(dir, noteName, (md) => {
      const renamed = field === DEFAULT_CLIP.field ? renameFrontmatterField(md, LEGACY_LINK_FIELD, field) : md;
      const linked = addFrontmatterLink(renamed, field, clipLabel(file));
      return frontmatterLinks(linked, field).reduce(addReferenceLink, linked);
    });
    const root = await clipRoot();
    await updateFile(root, file, (md) => addFrontmatterLink(withFrontmatter(md), CLIP_FIELDS.notes, displayName(baseName(noteName))))
      .catch((e) => console.warn('Selectiophile: could not link the note from its original', e));
  }

  // Each entry from a page points to the paragraph of its clipped original that it
  // came from, as `data-clip="original#^block"` on its link: hidden in the note, there
  // for an AI to trace. Found by the highlight's text; an entry whose text the original
  // doesn't hold gets none. `extra` adds entries the page's records may lack.
  // `only` points just those, as a save does for its own entry.
  async function pointEntriesToClip(dir, pageKey, file, extra = [], { only = false } = {}) {
    const root = await clipRoot();
    if (!root || (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') return;
    const { text: clip } = await readFile(root, file);
    const wanted = new Map();
    if (!only) for (const e of Object.values(await getMap('entries'))) {
      if (e.pageKey === pageKey && e.noteName && e.preview) wanted.set(e.id, { noteName: e.noteName, text: e.preview });
    }
    if (!only) for (const h of Object.values(await getMap(highlightKey(pageKey)))) {
      if (h.noteName && h.anchor) wanted.set(h.id, { noteName: h.noteName, text: h.anchor });
    }
    for (const e of extra) wanted.set(e.id, e);
    const byNote = new Map();
    for (const [id, { noteName, text }] of wanted) {
      const block = paragraphOf(clip, text);
      if (!block) continue;
      if (!byNote.has(noteName)) byNote.set(noteName, []);
      byNote.get(noteName).push([id, `${clipLabel(file)}#^${block}`]);
    }
    for (const [noteName, targets] of byNote) {
      if (!(await fileExists(dir, noteName))) continue;
      await updateFile(dir, noteName, (md) => targets.reduce((out, [id, target]) => setEntryClip(out, id, target), md));
    }
  }

  const yamlText = (text) => JSON.stringify(text);
  const reviewOf = async (pageKey) => (await getMap('reviews'))[pageKey] || null;

  // What a clip gets from the extension: when it was clipped, and, when the page could
  // be compared with it, how complete it came out (`clip_check`), for whoever reads it
  // later; one that looks wrong also says what to check (`clip_review`).
  const stampClip = (md, check = '', review = '') => {
    let out = setFrontmatterField(withFrontmatter(md), CLIP_FIELDS.time, localDate(now()));
    if (check) out = setFrontmatterField(out, CLIP_FIELDS.check, yamlText(check));
    return review ? setFrontmatterField(out, CLIP_FIELDS.review, yamlText(review)) : out;
  };

  // The note of a page, as its highlights would find it, without asking anyone.
  async function noteOfPage(page, dir) {
    if (page.discussion) return null;
    const all = await notes(dir);
    const bindings = await getMap('bindings');
    const resolved = resolveNote(page, all, { boundName: bindings[bindingKey(page)] || bindings[`url:${page.url}`] });
    if (resolved.kind === 'note') return resolved.name;
    // Else the note most of the page's highlights went to.
    const counts = {};
    for (const h of Object.values(await getMap(highlightKey(page.url)))) if (h.noteName) counts[h.noteName] = (counts[h.noteName] || 0) + 1;
    const most = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
    return most && all.some((n) => n.name === most) ? most : null;
  }

  const writeComment = (dir, noteName, comment) => updateFile(dir, noteName, (md) => setFrontmatterField(md, COMMENTS_FIELD, comment ? yamlText(comment) : ''));

  // A page comment lives in the note. Until the page has one, it is kept in the
  // extension and, once the page is clipped, in the original's `comments`, so the
  // dashboard shows it. When the note comes it moves there, leaving the original.
  async function clipComment(pageKey, text) {
    const file = await clippedFile(pageKey);
    const root = file && (await clipRoot());
    if (!root || (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') return;
    await updateFile(root, file, (md) => (text
      ? setFrontmatterField(withFrontmatter(md), CLIP_FIELDS.comments, yamlText(text))
      : removeFrontmatterField(md, CLIP_FIELDS.comments)));
  }

  async function deliverComment(dir, noteName, pageKey, text) {
    await writeComment(dir, noteName, text);
    await patchMap('reviews', (m) => { delete m[pageKey]; });
    await clipComment(pageKey, '').catch(() => {});
  }

  // A page comment written before the page had a note goes into the note once it has one.
  async function reviewFollowUp(job, dir, saved) {
    if (job.page.discussion) return;
    const review = await reviewOf(job.page.url);
    if (review?.text) await deliverComment(dir, saved.name, job.page.url, review.text);
  }

  // After a save: link an original clipped earlier, or clip the page now when this
  // save made its note and the page's type says so. Otherwise the popup clips it.
  async function clipFollowUp(job, dir, saved) {
    if (job.page.discussion) return null;
    const profile = await clipProfile(job.page.url, job.page);
    if (!profile) return null;
    const file = await clippedFile(job.page.url);
    if (file) {
      await linkClip(dir, saved.name, file, (await clipSettings()).field);
      await pointEntriesToClip(dir, job.page.url, file, [{ id: job.id, noteName: saved.name, text: job.anchor || job.exact || job.quote }], { only: true })
        .catch((e) => console.warn('Selectiophile: could not point the entry to its paragraph', e));
      return { state: 'linked', label: clipLabel(file) };
    }
    if (!saved.created || !(await pageType(job.page)).type?.autoClip) return null;
    return { state: 'auto', isPaper: Boolean(job.page.isPaper) };
  }

  const sameWork = (a, b) => {
    const doi = (x) => String(x.doi || '').trim().toLowerCase();
    const source = (x) => String(x.source || x.url || '').trim();
    return Boolean((doi(a) && doi(a) === doi(b)) || (source(a) && source(a) === source(b)));
  };

  async function notes(dir) {
    const scanned = await scan(dir);
    await kv.set('noteIndex', scanned);
    return Object.values(scanned);
  }

  const savePending = (job) => patchMap('pending', (m) => { m[job.id] = job; });
  const dropPending = (id) => patchMap('pending', (m) => { delete m[id]; });

  async function routeNote(job, dir) {
    if (job.createNote) return { kind: 'create' };
    if (job.noteName) return { kind: 'note', name: job.noteName, via: 'manual' };
    const settings = (await kv.get('settings')) || {};
    const all = await notes(dir);
    if (settings.pinned) {
      if (all.some((n) => n.name === settings.pinned)) return { kind: 'note', name: settings.pinned, via: 'pinned' };
      await kv.set('settings', { ...settings, pinned: null });
    }
    const bindings = await getMap('bindings');
    const resolved = resolveNote(job.page, all, { boundName: bindings[bindingKey(job.page)], recentName: await kv.get('lastNote') });
    if (resolved.via === 'recent') return routeDiscussion(job, all, resolved);
    if (resolved.kind !== 'ask') return resolved;
    const answer = await askWhichNote(job, resolved.candidates);
    // Tying a site to a template says its pages deserve notes, so there's no need to ask.
    if (answer.kind === 'confirm' && (await chooseTemplate(job.page)).matched) return { kind: 'create' };
    return answer;
  }

  const rememberDiscussion = (key, names) => patchMap('discussions', (m) => {
    m[key] = { notes: [...new Set(names)].slice(0, MAX_LINKED_NOTES), at: now().getTime() };
    const old = Object.keys(m).sort((a, b) => m[b].at - m[a].at).slice(DISCUSSION_MEMORY);
    for (const k of old) delete m[k];
  });

  // A conversation's opening is read once, to link it to one or more notes. After that
  // only the highlight is used, to choose among the notes already linked.
  async function routeDiscussion(job, all, recent) {
    const key = conversationKey(job.page.url);
    const linked = key ? (await getMap('discussions'))[key]?.notes.filter((n) => all.some((x) => x.name === n)) : null;
    if (linked?.length === 1) return { kind: 'note', name: linked[0], via: 'discussion' };
    if (linked?.length > 1) return { kind: 'multi', notes: all.filter((n) => linked.includes(n.name)) };

    const jevKey = await getJevKey();
    if (!jevKey || all.length < 2) return recent;
    const candidates = [...all].sort((a, b) => b.lastAnnotated - a.lastAnnotated).slice(0, DISCUSSION_CANDIDATES);
    try {
      const { json } = await askJev(jevKey, buildNoteRequest({
        pageTitle: job.page.title, url: job.page.url, quote: job.quote, comment: job.comment, conversation: job.context,
      }, candidates.map((c) => ({ name: displayName(c.name), description: c.title }))));
      const d = decideNote(json.answers, await autoSaveThreshold());
      const byLabel = (label) => candidates.find((c) => displayName(c.name) === label);
      const chosen = byLabel(d.note);
      if (!d.auto || !chosen) {
        if (key) await rememberDiscussion(key, [recent.name]);
        return recent;
      }
      const also = d.ranked.filter((r) => r.p >= LINK_PROBABILITY).map((r) => byLabel(r.option)?.name).filter(Boolean);
      if (key) await rememberDiscussion(key, [chosen.name, ...also]);
      return { kind: 'note', name: chosen.name, via: 'discussion-jev', probability: d.top };
    } catch {
      return recent;
    }
  }

  // Each heading of each linked note becomes one choice.
  async function saveAcrossNotes(job, dir, linked) {
    const options = [];
    for (const note of linked) {
      const { text } = await readFile(dir, note.name);
      for (const heading of leafHeadings(text)) {
        options.push({ key: `${displayName(note.name)} › ${heading}`, title: note.title, heading, noteName: note.name });
      }
    }
    if (!options.length) return fail(job, t('{name} 里没有可写入的标题', { name: linked[0].name }));
    const view = (o, p = null) => ({ block: o.key, p, noteName: o.noteName, heading: o.heading });
    let shown = options.map((o) => view(o));
    let reason = 'no-key';
    let error;
    const key = await getJevKey();
    if (key) {
      try {
        const { json } = await askJev(key, buildCrossNoteRequest({
          quote: job.quote, comment: job.comment, paragraph: job.paragraph, purpose: job.purpose,
        }, options));
        const d = decideBlock(json.answers.block, await autoSaveThreshold());
        const pick = options.find((o) => o.key === d.block);
        if (d.auto && pick) {
          const saved = await writeToNote(job, dir, pick.noteName, pick.heading);
          return finish(job, saved, { via: 'discussion' }, { via: 'jev', probability: d.top });
        }
        const ranked = d.ranked.map((r) => {
          const o = options.find((x) => x.key === r.option);
          return o ? view(o, r.p) : null;
        }).filter(Boolean);
        if (ranked.length) shown = ranked;
        reason = 'low-confidence';
      } catch (e) {
        reason = 'jev-error';
        error = e.message;
      }
    }
    await savePending({ ...job, awaiting: 'block' });
    return send(job, { state: 'confirm-block', options: shown, reason, error, noteLabel: '' });
  }

  async function askWhichNote(job, candidates) {
    const key = await getJevKey();
    if (!key || !candidates.length) return { kind: 'confirm', candidates: candidates.map(candidateView) };
    try {
      const body = buildNoteRequest(
        { pageTitle: job.page.title, url: job.page.url, quote: job.quote, comment: job.comment },
        candidates.map((c) => ({ name: displayName(c.name), description: c.title })),
      );
      const { json } = await askJev(key, body);
      const d = decideNote(json.answers, await autoSaveThreshold());
      const chosen = candidates.find((c) => displayName(c.name) === d.note);
      if (d.auto && chosen) return { kind: 'note', name: chosen.name, via: 'jev', probability: d.top };
      const order = new Map(d.ranked.map((r, i) => [r.option, i]));
      const sorted = [...candidates].sort((a, b) => order.get(displayName(a.name)) - order.get(displayName(b.name)));
      return { kind: 'confirm', candidates: sorted.map(candidateView), jevUsed: true };
    } catch (e) {
      return { kind: 'confirm', candidates: candidates.map(candidateView), jevError: e.message };
    }
  }

  const candidateView = (n) => ({ name: n.name, label: displayName(n.name), title: n.title });

  async function routeBlock(job, headings, sourceTitle) {
    if (job.heading) return { auto: true, block: job.heading, via: 'manual' };
    const key = await getJevKey();
    const options = headings.map((h) => ({ block: h, p: null }));
    if (!key) return { auto: false, options, reason: 'no-key' };
    try {
      const { json } = await askJev(key, buildBlockRequest({
        sourceTitle, quote: job.quote, comment: job.comment, paragraph: job.paragraph, pageSection: job.pageSection, discussion: job.page.discussion, purpose: job.purpose,
      }, headings));
      const d = decideBlock(json.answers.block, await autoSaveThreshold());
      if (d.auto && headings.includes(d.block)) return { auto: true, block: d.block, via: 'jev', probability: d.top };
      const ranked = d.ranked.filter((r) => headings.includes(r.option)).map((r) => ({ block: r.option, p: r.p }));
      return { auto: false, options: ranked.length ? ranked : options, reason: 'low-confidence' };
    } catch (e) {
      return { auto: false, options, reason: 'jev-error', error: e.message };
    }
  }

  function entryOf(job) {
    return { id: job.id, quote: job.quote, exact: job.exact, comment: job.comment, url: job.page.url, date: localDate(now()), discussion: job.page.discussion, purpose: job.purpose, color: job.color, lang: job.lang };
  }

  const stamp = (md) => setFrontmatterField(md, 'last_annotated', localDateTime(now()));

  async function uniqueName(dir, name) {
    if (!(await fileExists(dir, name))) return name;
    const base = name.replace(/\.md$/, '');
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}.md`;
      if (!(await fileExists(dir, candidate))) return candidate;
    }
    throw new Error(t('无法为 {name} 生成不重复的文件名', { name }));
  }

  const templates = async () => allTemplates((await kv.get('templates')) || [], await kv.get('templateText'));

  // The template of the page's type. A discussion's note is more likely about a paper
  // than the chat site itself. A page a config matched deserves a note, so it's made
  // without asking.
  const chooseTemplate = async (page) => {
    const { type, matched } = await pageType(page);
    const found = (await templates()).find((tpl) => tpl.id === type.id);
    return { template: found || { id: type.id, builtin: false, name: type.name, folder: '', text: null }, matched, type };
  };

  // Uploaded text wins. For papers, a template kept in the folder comes next, as earlier
  // versions used it. Otherwise the one that ships, so nothing must be in the vault; a
  // type the person added starts from the article one.
  async function templateText(template, dir) {
    if (template.text) return template.text;
    if (template.id === 'paper') {
      try {
        return (await readFile(dir, TEMPLATE_NAME)).text;
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
    }
    return getBundledTemplate(template.id === 'paper' ? 'paper' : 'article');
  }

  // Uploaded configs come first and replace a bundled one of the same name.
  async function allProfiles() {
    const uploaded = (await kv.get('profiles')) || [];
    const names = new Set(uploaded.map((p) => p.name));
    return [...uploaded, ...(await getDefaultProfiles()).filter((p) => !names.has(p.name))];
  }

  // A choice made for this page wins over matching. A config that has since been
  // removed falls back to matching.
  async function profileFor(url, pageKey) {
    const all = await allProfiles();
    const choice = (await getMap('profileChoices'))[pageKey];
    if (choice?.none) return null;
    const chosen = choice && all.find((p) => p.name === choice.name);
    return chosen || globalThis.SelectiophileProfiles.matchProfile(all, url);
  }

  // Asking for a block comes first, so cancelling never leaves an empty note behind.
  async function process(job) {
    const dir = await getFolder();
    if (!dir) return send(job, { state: 'needs-folder' });
    if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      return send(job, { state: 'needs-permission' });
    }

    const route = await routeNote(job, dir);
    if (route.kind === 'confirm') {
      await savePending({ ...job, awaiting: 'note' });
      const { template: picked, type } = await chooseTemplate(job.page);
      return send(job, {
        state: 'confirm-note', candidates: route.candidates, suggestedTitle: job.page.title,
        jevError: route.jevError, templateId: picked.id, templateName: type.name || picked.name, templateFolder: cleanFolderPath(picked.folder),
      });
    }

    if (route.kind === 'multi') return saveAcrossNotes(job, dir, route.notes);

    const creating = route.kind === 'create';
    const chosen = creating ? (await chooseTemplate(job.page)).template : null;
    const template = creating ? await templateText(chosen, dir) : null;
    if (creating && !template) return fail(job, t('找不到笔记模板'));
    const base = creating ? template : (await readFile(dir, route.name)).text;
    const headings = leafHeadings(base);
    if (!headings.length) return fail(job, t('{name} 里没有可写入的标题', { name: creating ? TEMPLATE_NAME : route.name }));

    // In a discussion the chat title says little about the work, so Jev gets the note's title.
    const sourceTitle = job.page.discussion && !creating ? readFrontmatter(base).title : job.page.title;
    const block = await routeBlock(job, headings, sourceTitle);
    if (!block.auto) {
      const remembered = { ...job, awaiting: 'block', noteName: creating ? null : route.name, createNote: creating };
      await savePending(remembered);
      return send(job, {
        state: 'confirm-block', options: block.options, reason: block.reason, error: block.error,
        noteLabel: creating ? displayName(inFolder(chosen, noteFileName(noteMeta(job)))) : displayName(route.name),
      });
    }

    try {
      const saved = creating ? await writeNewNote(job, dir, template, block.block, chosen) : await writeToNote(job, dir, route.name, block.block);
      return finish(job, saved, route, block);
    } catch (e) {
      if (e instanceof NoteError && e.code === 'heading_missing') {
        await savePending({ ...job, awaiting: 'block', heading: null, noteName: route.name });
        return send(job, {
          state: 'confirm-block', options: headings.map((h) => ({ block: h, p: null })), reason: 'heading-missing',
          noteLabel: displayName(route.name),
        });
      }
      throw e;
    }
  }

  async function writeToNote(job, dir, name, heading) {
    await updateFile(dir, name, (md) => (hasEntry(md, job.id) ? md : stamp(insertEntry(md, heading, entryOf(job)))));
    return { name, heading, created: false };
  }

  async function writeNewNote(job, dir, template, heading, chosen) {
    const name = await uniqueName(dir, inFolder(chosen, noteFileName(noteMeta(job))));
    const md = sortFrontmatter(stamp(insertEntry(instantiateTemplate(template, noteMeta(job)), heading, entryOf(job))));
    await createFile(dir, name, md);
    return { name, heading, created: true };
  }

  async function finish(job, saved, route, block) {
    // A pin is temporary, so it must not decide where this page goes after unpinning.
    const key = job.page.discussion || route.via === 'pinned' ? null : bindingKey(job.page);
    if (key) await patchMap('bindings', (m) => { m[key] = saved.name; });
    await kv.set('lastNote', saved.name);
    const log = await patchMap('entries', (m) => {
      m[job.id] = {
        id: job.id, noteName: saved.name, heading: saved.heading, created: saved.created, at: now().getTime(),
        pageKey: job.page.url, bindingKey: key, title: job.page.title, preview: job.quote.slice(0, 80),
      };
    });
    const ids = Object.values(log).sort((a, b) => b.at - a.at).slice(ENTRY_LOG_LIMIT).map((e) => e.id);
    if (ids.length) await patchMap('entries', (m) => ids.forEach((id) => delete m[id]));
    // A reader who turned highlights off wants nothing kept for the page.
    if ((await kv.get('showHighlights')) !== false) await patchMap(highlightKey(job.page.url), (m) => {
      m[job.id] = { id: job.id, anchor: job.anchor || job.exact || job.quote, prefix: job.prefix, suffix: job.suffix, noteName: saved.name, heading: saved.heading, color: job.color };
    });
    // Only a judgment or the reader's own choice links a note. A fallback to the latest
    // note after a failed call doesn't, so the next highlight can still ask.
    const conversation = job.page.discussion ? conversationKey(job.page.url) : null;
    if (conversation && (route.via === 'manual' || (await getMap('discussions'))[conversation])) {
      await linkNote(conversation, saved.name);
    }
    await dropPending(job.id);
    // The dashboard is a convenience, so trouble with it must never fail a save.
    await onNoteWritten().catch(() => {});
    // Nor may clipping the original, or a page comment waiting for this note.
    const clip = await clipFollowUp(job, await getFolder(), saved).catch(() => null);
    await reviewFollowUp(job, await getFolder(), saved).catch((e) => console.warn('Selectiophile: could not write the page comment', e));
    const sent = await send(job, {
      state: 'saved', noteName: saved.name, noteLabel: displayName(saved.name), heading: saved.heading, created: saved.created,
      noteVia: route.via || 'created', blockVia: block.via, probability: block.probability ?? null, clip,
    });
    // Outside this save's turn, as clipping saves through the same queue.
    if (clip?.state === 'auto') setTimeout(() => requestClip({ tabId: job.tabId, pageKey: job.page.url, noteName: saved.name }), 0);
    return sent;
  }

  const highlightKey = (pageKey) => `hl:${pageKey}`;

  async function linkNote(key, name) {
    const known = (await getMap('discussions'))[key]?.notes || [];
    await rememberDiscussion(key, [name, ...known]);
  }

  // Every entry id in the notes, read fresh, since notes change outside the extension.
  async function liveEntryIds(dir) {
    const ids = new Set();
    for (const name of Object.keys(await scan(dir))) {
      const { text } = await readFile(dir, name);
      for (const m of text.matchAll(/data-lp="([^"]+)"|^%% lp:(\S+) %%$/gm)) ids.add(m[1] || m[2]);
    }
    return ids;
  }

  async function findOrphans(dir) {
    const live = await liveEntryIds(dir);
    const stored = await kv.all();
    const pages = {};
    for (const [key, records] of Object.entries(stored)) {
      if (!key.startsWith('hl:')) continue;
      const gone = Object.keys(records).filter((id) => !live.has(id));
      if (gone.length) pages[key] = gone;
    }
    return pages;
  }

  async function readyFolder() {
    const dir = await getFolder();
    if (!dir || (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      throw Object.assign(new Error(t('需要重新授权笔记文件夹')), { code: 'needs-permission' });
    }
    return dir;
  }

  // The log keeps recent entries only; the page's own record covers older ones.
  async function findRecord(id, pageKey) {
    const logged = (await getMap('entries'))[id];
    if (logged) return logged;
    const stored = pageKey ? (await getMap(highlightKey(pageKey)))[id] : null;
    if (!stored) throw new Error(t('找不到这条记录'));
    return { id, noteName: stored.noteName, heading: stored.heading, pageKey, created: false, bindingKey: null };
  }

  // Checks the recorded note first, then the rest, as the note may have been renamed
  // or the entry moved by hand in Obsidian.
  async function locateEntry(dir, id, hint) {
    const others = Object.keys(await scan(dir)).filter((n) => n !== hint);
    for (const name of [hint, ...others]) {
      try {
        const { text } = await readFile(dir, name);
        if (hasEntry(text, id)) return { name, text };
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
    }
    return null;
  }

  // Only a note identical to a template holds nothing the user wrote.
  async function isPristine(dir, md) {
    const body = noteBody(md);
    for (const template of await templates()) {
      const text = await templateText(template, dir);
      if (text && noteBody(text) === body) return true;
    }
    return false;
  }

  function send(job, update) {
    return notify(job.tabId, { id: job.id, ...update });
  }

  async function fail(job, message) {
    await savePending({ ...job, awaiting: 'retry' });
    return send(job, { state: 'error', message });
  }

  const guarded = (job) => process(job).catch((e) => fail(job, `${e.name}: ${e.message}`));

  return {
    submit(input, tabId) {
      return serial(async () => {
        // The purpose is fixed at save time: renaming a color later leaves old entries as written.
        const color = colorById(input.color).id;
        const lang = await getLang();
        const job = {
          ...input, id: input.id || newId(), tabId, page: normalizePage({ ...input.rawPage, lang }), rawPage: undefined,
          color, lang, purpose: purposeOf(color, await getMap('colors'), lang),
        };
        await kv.set('lastColor', color);
        await savePending(job);
        await guarded(job);
        return job.id;
      });
    },

    // The user picked a note and/or block for a job waiting on them.
    confirm({ id, noteName, createNote, heading, title }) {
      return serial(async () => {
        const job = (await getMap('pending'))[id];
        if (!job) return;
        const next = { ...job, awaiting: null };
        if (noteName) Object.assign(next, { noteName, createNote: false });
        if (createNote) Object.assign(next, { createNote: true, noteName: null });
        if (title) next.page = { ...next.page, title };
        if (heading) next.heading = heading;
        await savePending(next);
        await guarded(next);
      });
    },

    cancel: ({ id }) => serial(() => dropPending(id)),

    // Runs every job held back, such as those waiting for folder permission.
    flush() {
      return serial(async () => {
        for (const job of Object.values(await getMap('pending'))) {
          if (job.awaiting !== 'note' && job.awaiting !== 'block') await guarded(job);
        }
      });
    },

    resume({ id }, tabId) {
      return serial(async () => {
        const job = (await getMap('pending'))[id];
        if (job) await guarded({ ...job, tabId, awaiting: null });
      });
    },

    // Removes an entry and its page highlight. `keepNote` is for deleting later on,
    // when even an empty note may be one the user wants to keep.
    remove({ id, pageKey, keepNote = false }) {
      return serial(async () => {
        const record = await findRecord(id, pageKey);
        const dir = await readyFolder();
        const found = await locateEntry(dir, id, record.noteName);
        let deletedNote = false;
        if (found) {
          const after = await updateFile(dir, found.name, (md) => (hasEntry(md, id) ? removeEntry(md, id) : md));
          if (!keepNote && record.created && countEntries(after) === 0 && (await isPristine(dir, after))) {
            await deleteFile(dir, found.name);
            deletedNote = true;
            await patchMap('bindings', (m) => {
              for (const [k, v] of Object.entries(m)) if (v === found.name) delete m[k];
            });
          }
        }
        await patchMap('entries', (m) => { delete m[id]; });
        await patchMap(highlightKey(record.pageKey), (m) => { delete m[id]; });
        return { deletedNote, entryMissing: !found };
      });
    },

    // Where a highlight's entry really is now, for the card shown on clicking it.
    inspect({ id, pageKey }) {
      return serial(async () => {
        const record = await findRecord(id, pageKey);
        const dir = await readyFolder();
        const found = await locateEntry(dir, id, record.noteName);
        if (!found) return { exists: false };
        return {
          exists: true, noteName: found.name, noteLabel: displayName(found.name), heading: headingOfEntry(found.text, id),
          comment: readComment(found.text, id),
        };
      });
    },

    // Moves an entry within its note or to another one. The target is written first,
    // so a failure in between can duplicate the entry but never lose it.
    // Stamping the target makes it the most recent note, so later highlights from a
    // discussion follow the correction.
    move({ id, pageKey, noteName, heading }) {
      return serial(async () => {
        const record = await findRecord(id, pageKey);
        const dir = await readyFolder();
        const found = await locateEntry(dir, id, record.noteName);
        if (!found) throw new Error(t('笔记里已经没有这条划线'));
        const target = noteName || found.name;
        if (target === found.name) {
          await updateFile(dir, target, (md) => stamp(moveEntry(md, id, heading)));
        } else {
          const lines = extractEntry(found.text, id);
          await updateFile(dir, target, (md) => (hasEntry(md, id) ? md : stamp(insertEntryLines(md, heading, lines))));
          await updateFile(dir, found.name, (md) => removeEntry(md, id));
          if (record.bindingKey) await patchMap('bindings', (m) => { m[record.bindingKey] = target; });
          // A move out of a conversation links it to that note as well.
          const conversation = discussionLabel(record.pageKey) ? conversationKey(record.pageKey) : null;
          if (conversation) await linkNote(conversation, target);
        }
        await kv.set('lastNote', target);
        await patchMap('entries', (m) => { if (m[id]) Object.assign(m[id], { noteName: target, heading, created: false }); });
        await patchMap(highlightKey(record.pageKey), (m) => { if (m[id]) Object.assign(m[id], { noteName: target, heading }); });
        return { noteName: target, noteLabel: displayName(target), heading };
      });
    },

    setComment({ id, pageKey, comment }) {
      return serial(async () => {
        const record = await findRecord(id, pageKey);
        const dir = await readyFolder();
        const found = await locateEntry(dir, id, record.noteName);
        if (!found) throw new Error(t('笔记里已经没有这条划线'));
        const lang = await getLang();
        await updateFile(dir, found.name, (md) => stamp(setEntryComment(md, id, comment, lang)));
        return { comment: comment.trim() };
      });
    },

    recolor({ id, pageKey, color }) {
      return serial(async () => {
        const record = await findRecord(id, pageKey);
        const dir = await readyFolder();
        const found = await locateEntry(dir, id, record.noteName);
        if (!found) throw new Error(t('笔记里已经没有这条划线'));
        const next = colorById(color).id;
        const purpose = purposeOf(next, await getMap('colors'), await getLang());
        await updateFile(dir, found.name, (md) => setEntryStyle(md, id, { color: next, purpose }));
        await patchMap(highlightKey(record.pageKey), (m) => { if (m[id]) m[id].color = next; });
        return { color: next };
      });
    },

    // Highlights whose entry is in no note: the note or the entry was deleted.
    async scanOrphans() {
      const pages = await findOrphans(await readyFolder());
      return { pages: Object.keys(pages).length, highlights: Object.values(pages).flat().length };
    },

    clearOrphans() {
      return serial(async () => {
        const pages = await findOrphans(await readyFolder());
        let cleared = 0;
        for (const [key, ids] of Object.entries(pages)) {
          await patchMap(key, (m) => { for (const id of ids) delete m[id]; });
          await patchMap('entries', (m) => { for (const id of ids) delete m[id]; });
          cleared += ids.length;
        }
        return { highlights: cleared };
      });
    },

    async pageStatus(rawPage) {
      const lang = await getLang();
      const page = normalizePage({ ...rawPage, lang });
      const pending = Object.values(await getMap('pending')).filter((j) => j.page.url === page.url && j.awaiting);
      const highlights = Object.values(await getMap(highlightKey(page.url)));
      const { pinned } = (await kv.get('settings')) || {};
      const dir = await getFolder();
      let note = null;
      if (dir && (await dir.queryPermission({ mode: 'readwrite' })) === 'granted') {
        const all = await serial(() => notes(dir));
        const bindings = await getMap('bindings');
        const resolved = pinned && all.some((n) => n.name === pinned)
          ? { kind: 'note', name: pinned, via: 'pinned' }
          : resolveNote(page, all, { boundName: bindings[bindingKey(page)], recentName: await kv.get('lastNote') });
        if (resolved.kind === 'note') note = { name: resolved.name, label: displayName(resolved.name), via: resolved.via };
      }
      return {
        page, note, pinned: pinned || null, highlights, pendingIds: pending.map((j) => j.id),
        colors: colorList(await getMap('colors'), lang), lastColor: colorById(await kv.get('lastColor')).id, lang,
        profile: page.discussion ? null : await profileFor(rawPage.url, page.url),
        // Once a conversation is linked, its text is not read again.
        conversationRounds: page.discussion && !(await getMap('discussions'))[conversationKey(page.url)]
          ? (await kv.get('discussionRounds')) ?? DEFAULT_ROUNDS
          : 0,
        active: siteActive({ mode: await kv.get('siteMode'), sites: (await kv.get('sites')) || [], blocked: (await kv.get('blockedSites')) || [] }, rawPage.url),
      };
    },

    async listNotes() {
      const dir = await getFolder();
      if (!dir || (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return [];
      const all = await serial(() => notes(dir));
      return all.sort((a, b) => b.lastAnnotated - a.lastAnnotated).map(candidateView);
    },

    // Every folder of the vault. null, unlike an empty list, says it couldn't be read.
    // Null without a granted folder.
    async listFolders() {
      const dir = await getFolder();
      if (!dir || (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
      const skipped = [];
      const found = await listFolders(dir, skipped);
      if (skipped.length) console.warn('Selectiophile: subfolders that could not be read:', skipped);
      return found;
    },

    async listHeadings({ noteName }) {
      const dir = await getFolder();
      return leafHeadings((await readFile(dir, noteName)).text);
    },

    allProfiles,

    clipProfile,

    // What the popup shows about clipping this page.
    async clipStatus({ url, isPaper = false }) {
      const profile = await clipProfile(url, { isPaper });
      if (!profile) return { available: false };
      const file = await clippedFile(normalizePage({ url }).url);
      const path = String(profile.clip.path || '');
      return {
        available: true, profileName: profile.name, file, label: file ? clipLabel(file) : null,
        folder: path.includes('{{') ? '' : cleanFolderPath(path), ...(await clipSettings()),
      };
    },

    docTypes,

    // Each config's type, for the settings page.
    async profileTypes() {
      const [assigned, types, links] = await typeContext();
      return Object.fromEntries((await allProfiles()).map((p) => [p.name, profileTypeOf(p, assigned, types, links)]));
    },

    // ---------------------------------------------------------------------------
    // Page comments: a short review of the whole page, kept as `comments` in its note.
    // Written before the page has a note, it waits in the extension, and in the
    // original once clipped. When the page's type clips by itself (`autoClip`), the
    // page is clipped too, and the note links it.
    // `rawPage` is what the page itself says (its DOI); the popup knows the address only.
    // ---------------------------------------------------------------------------
    async reviewStatus({ url, rawPage }) {
      const page = normalizePage({ ...(rawPage || {}), url });
      const profile = await clipProfile(url);
      if (!profile) return { available: false };
      const file = await clippedFile(page.url);
      let text = (await reviewOf(page.url))?.text || '';
      let note = null;
      // Before there is a note, the original holds it, perhaps edited in Obsidian.
      if (file && text) {
        const root = await clipRoot();
        if (root && (await root.queryPermission({ mode: 'readwrite' })) === 'granted') {
          const stored = readFrontmatter((await readFile(root, file).catch(() => ({ text: '' }))).text)[CLIP_FIELDS.comments];
          if (typeof stored === 'string' && stored) text = stored;
        }
      }
      // One written in Obsidian is the one to edit.
      const dir = await getFolder();
      if (dir && (await dir.queryPermission({ mode: 'readwrite' })) === 'granted') {
        note = await serial(() => noteOfPage(page, dir));
        if (note) {
          const stored = readFrontmatter((await readFile(dir, note)).text)[COMMENTS_FIELD];
          if (typeof stored === 'string' && stored) text = stored;
        }
      }
      const { type } = await pageType(page);
      return {
        available: true, text, title: page.title || '', note: note ? displayName(note) : null,
        clipped: file ? clipLabel(file) : null, auto: Boolean(type?.autoClip), maxChars: MAX_REVIEW_CHARS,
      };
    },

    // `state`: `updated` when written into the note, `saved` when it waits for one
    // (in the extension, and in the original once clipped).
    // `clipping` says the page is being clipped as well.
    saveReview({ url, rawPage, text, tabId }) {
      return serial(async () => {
        const page = normalizePage({ ...(rawPage || {}), url });
        if (!(await clipProfile(url))) throw new Error(t('这个网页不能写简评'));
        const comment = String(text ?? '').trim().slice(0, MAX_REVIEW_CHARS);
        const dir = await readyFolder();
        const note = await noteOfPage(page, dir);
        await patchMap('reviews', (m) => {
          if (comment && !note) m[page.url] = { text: comment, at: now().getTime() };
          else delete m[page.url];
          const old = Object.keys(m).sort((a, b) => m[b].at - m[a].at).slice(REVIEW_MEMORY);
          for (const k of old) delete m[k];
        });
        // In the note, or until there is one in the original, if clipped.
        if (note) await deliverComment(dir, note, page.url, comment);
        else await clipComment(page.url, comment);
        const file = await clippedFile(page.url);
        // An original clipped before the note existed is linked now.
        if (note && file) await linkClip(dir, note, file, (await clipSettings()).field).catch(() => {});
        const clipping = Boolean(comment && !file && tabId != null && (await pageType(page)).type?.autoClip);
        if (clipping) setTimeout(() => requestClip({ tabId, pageKey: page.url, noteName: note || undefined }), 0);
        return note
          ? { state: 'updated', label: displayName(note), text: comment, clipping }
          : { state: 'saved', text: comment, clipping };
      });
    },

    // Writes a clipped original and links it from `noteName`, if given. A file of the
    // same work is kept unless `force` asks to clip again; one of another work with
    // the same name gets a numbered name.
    saveClip({ url, noteName, result: clipped, force = false }) {
      return serial(async () => {
        const result = { ...clipped, fullContent: finishArchive(clipped.fullContent) };
        const pageKey = normalizePage({ url }).url;
        const root = await clipRoot();
        if (!root || (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          throw Object.assign(new Error(t('需要重新授权剪藏文件夹')), { code: 'needs-permission' });
        }
        const folder = cleanFolderPath(result.path);
        const base = String(result.noteName || 'Untitled').replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
        let file = folder ? `${folder}/${base}.md` : `${base}.md`;
        let status = 'created';
        if (await fileExists(root, file)) {
          const known = (await getMap('clips'))[pageKey]?.file === file;
          if (known || sameWork(readFrontmatter((await readFile(root, file)).text), readFrontmatter(result.fullContent))) {
            status = force ? 'updated' : 'existing';
          } else {
            file = await uniqueName(root, file);
          }
        }
        const problems = status === 'existing' ? [] : clipProblems(result.fullContent, result.page);
        if (status !== 'existing') await createFile(root, file, stampClip(result.fullContent, clipCheckLine(result.fullContent, result.page), clipReviewLine(problems)));
        // One clipped before, perhaps by Web Clipper, joins the dashboard now.
        else await updateFile(root, file, (md) => (readFrontmatter(md)[CLIP_FIELDS.time] ? md : stampClip(md)));
        await patchMap('clips', (m) => {
          m[pageKey] = { file, at: now().getTime() };
          const old = Object.keys(m).sort((a, b) => m[b].at - m[a].at).slice(CLIP_MEMORY);
          for (const k of old) delete m[k];
        });
        // From the popup no note is named: the one this page's highlights went to, or
        // the one bound to its DOI or address.
        // The note the page is bound to, by DOI or address; else the one most of the
        // page's highlights are in (some may have been moved to other notes).
        if (noteName === undefined) {
          const doi = String(readFrontmatter(result.fullContent).doi || '').toLowerCase();
          const bindings = await getMap('bindings');
          const counts = {};
          for (const h of Object.values(await getMap(highlightKey(pageKey)))) if (h.noteName) counts[h.noteName] = (counts[h.noteName] || 0) + 1;
          const mostHighlighted = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
          noteName = (doi && bindings[`doi:${doi}`]) || bindings[`url:${pageKey}`] || mostHighlighted || null;
          if (noteName && !(await fileExists(await readyFolder(), noteName))) noteName = null;
          // A note this extension has no record of, as one from before it was
          // installed again: by the paper's DOI or the page's address.
          if (!noteName) noteName = await noteOfPage({ ...normalizePage({ url }), doi }, await readyFolder()).catch(() => null);
        }
        let linked = null;
        if (noteName) {
          const dir = await readyFolder();
          await linkClip(dir, noteName, file, (await clipSettings()).field);
          linked = displayName(noteName);
        }
        // Entries saved before the page was clipped now point to their paragraphs.
        await pointEntriesToClip(await readyFolder(), pageKey, file)
          .catch((e) => console.warn('Selectiophile: could not point entries to their paragraphs', e));
        // A page comment waiting for a note: into the note, if there is one now, else
        // into the original.
        const review = await reviewOf(pageKey);
        if (review?.text) {
          if (noteName) await deliverComment(await readyFolder(), noteName, pageKey, review.text);
          else await clipComment(pageKey, review.text);
        }
        return { status, file, label: clipLabel(file), linked, problems, warning: clipWarning(problems) };
      });
    },

    // What the popup needs to offer a choice of config for this page.
    async profileState({ url }) {
      const page = normalizePage({ url });
      const all = await allProfiles();
      const choice = (await getMap('profileChoices'))[page.url];
      const exists = choice?.name && all.some((p) => p.name === choice.name);
      return {
        available: !page.discussion,
        names: all.map((p) => p.name),
        matched: globalThis.SelectiophileProfiles.matchProfile(all, url)?.name || null,
        selected: choice?.none ? 'none' : exists ? choice.name : 'auto',
      };
    },

    // `auto` clears the choice, so a page returns to matching by its address.
    async chooseProfile({ url, selected }) {
      const { url: pageKey } = normalizePage({ url });
      await patchMap('profileChoices', (m) => {
        delete m[pageKey];
        if (selected === 'none') m[pageKey] = { none: true, at: now().getTime() };
        else if (selected !== 'auto') m[pageKey] = { name: selected, at: now().getTime() };
        const old = Object.keys(m).sort((a, b) => m[b].at - m[a].at).slice(PROFILE_CHOICE_MEMORY);
        for (const k of old) delete m[k];
      });
    },

    async setPinned({ noteName }) {
      const settings = (await kv.get('settings')) || {};
      await kv.set('settings', { ...settings, pinned: noteName || null });
    },

    async overview() {
      const pending = Object.values(await getMap('pending')).sort((a, b) => a.id.localeCompare(b.id));
      const entries = Object.values(await getMap('entries')).sort((a, b) => b.at - a.at).slice(0, 1);
      const { pinned } = (await kv.get('settings')) || {};
      return {
        pending: pending.map((j) => ({ id: j.id, preview: j.quote.slice(0, 60), url: j.page.url, awaiting: j.awaiting })),
        entries: entries.map((e) => ({ ...e, noteLabel: displayName(e.noteName) })),
        pinned: pinned || null,
        pinnedLabel: pinned ? displayName(pinned) : null,
      };
    },
  };
}
