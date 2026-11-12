// The dashboard note: Dataview tables of reading notes and of clipped originals. Its
// content is preset, with headings in the language of the settings page; whoever
// wants other tables edits the note in Obsidian, and then it is left alone.
// No browser APIs, so it is tested under Node.

const COPY = {
  zh: {
    notes: '笔记', clips: '入库原文', note: '笔记', annotated: '最近添加', source: '来源',
    original: '原文', clipped: '剪藏日期', comments: '简评', clipNotes: '笔记', originalText: '原文',
  },
  en: {
    notes: 'Notes', clips: 'Clipped originals', note: 'Note', annotated: 'Last annotated', source: 'Source',
    original: 'Source', clipped: 'Clipped', comments: 'Comments', clipNotes: 'Notes', originalText: 'Original',
  },
};
const copyOf = (lang) => COPY[lang] || COPY.zh;

// A property name as Dataview reads it: bare when it can be, else from `row`.
const fieldRef = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `row[${JSON.stringify(name)}]`);
const quoted = (text) => JSON.stringify(String(text));

// A note's source is the web page, shown as the journal or site; its clipped originals
// are under its References heading and in the table of originals.
const SOURCE_COLUMN = 'default(elink(url, default(journal, default(site, url))), default(journal, site))';

// An earlier source column: the note's clipped original if there is one, else the web
// page, shown as the journal or site. Checked in Dataview 0.5.68 itself: `choice` computes both branches,
// and a row whose column fails is silently dropped, so only functions that take null
// are used. `link(link, text)` relabels a link, and gives null for null. A note can
// link several originals: the first is shown, once. An original no longer in the
// vault (`.file` null) gives way to the web page.
// Notes made before `references` link their originals by `reference`.
const linkRef = (linkField) => (linkField === 'references' ? 'default(references, reference)' : fieldRef(linkField));
function originColumn(linkField, lang, ref = linkRef) {
  const first = `flat(list(${ref(linkField)}))[0]`;
  const label = `default(journal, default(site, ${quoted(copyOf(lang).originalText)}))`;
  return `default(link(choice(${first}.file, ${first}, null), ${label}), default(elink(url, default(journal, default(site, url))), default(journal, site)))`;
}

const table = (title, columns, where, sort, limit) => `## ${title}

\`\`\`dataview
TABLE WITHOUT ID ${columns.map(([expr, label]) => `${expr} AS ${quoted(label)}`).join(', ')}
WHERE ${where}
SORT ${sort}
LIMIT ${limit}
\`\`\`
`;

// Notes carry `last_annotated` and clipped originals `clipped`, both written only by
// this extension, so the tables work from any vault folder. A note is never a clip:
// should a highlight ever land in a clipped original, it stays among the originals.
// `clipped` is a day, so originals of the same day come newest file first.
// A page comment is the note's `comments`: an original shows those of the notes
// linking it (its `notes`), or one an earlier version wrote into the original itself.
const COMMENTS_COLUMN = 'default(comments, join(filter(flat(list(notes.comments)), (c) => c), "; "))';

// `linkField` named the originals for the earlier source column; the preset no longer
// needs it, but keeps taking it.
export function dashboardMarkdown({ lang = 'zh', source = SOURCE_COLUMN } = {}) {
  const c = copyOf(lang);
  return [
    table(c.notes, [
      ['file.link', c.note],
      ['dateformat(last_annotated, "yyyy-MM-dd HH:mm")', c.annotated],
      [source, c.source],
    ], 'last_annotated AND !clipped', 'last_annotated DESC', 30),
    table(c.clips, [
      ['file.link', c.original],
      ['dateformat(clipped, "yyyy-MM-dd")', c.clipped],
      [COMMENTS_COLUMN, c.comments],
      ['notes', c.clipNotes],
    ], 'clipped', 'clipped DESC, file.ctime DESC', 100),
  ].join('\n');
}

// Dashboards earlier versions wrote. A file still holding one of them was never
// edited, so it may be replaced; one the person changed is left alone.
const EARLIER_COPY = [
  { title: 'Lectiophile 看板', note: '笔记', annotated: '最近添加', journal: '来源' },
  { title: 'Lectiophile Dashboard', note: 'Note', annotated: 'Last annotated', journal: 'Source' },
  { title: 'Selectiophile 看板', note: '笔记', annotated: '最近添加', journal: '来源' },
  { title: 'Selectiophile Dashboard', note: 'Note', annotated: 'Last annotated', journal: 'Source' },
];
export function earlierDashboards({ linkField = 'reference' } = {}) {
  // The preset before comments moved to the note, with the link field of then.
  const legacyField = linkField === 'references' ? 'reference' : linkField;
  const preset = ['zh', 'en'].map((lang) => {
    const c = copyOf(lang);
    return [
      table(c.notes, [
        ['file.link', c.note],
        ['dateformat(last_annotated, "yyyy-MM-dd HH:mm")', c.annotated],
        [originColumn(legacyField, lang, fieldRef), c.source],
      ], 'last_annotated AND !clipped', 'last_annotated DESC', 30),
      table(c.clips, [
        ['file.link', c.original],
        ['dateformat(clipped, "yyyy-MM-dd")', c.clipped],
        ['comments', c.comments],
        ['notes', c.clipNotes],
      ], 'clipped', 'clipped DESC, file.ctime DESC', 100),
    ].join('\n');
  });
  const titled = EARLIER_COPY.flatMap((c) => [
    ['journal', 'file.folder = this.file.folder AND last_annotated'],
    ['journal', 'startswith(file.folder, this.file.folder) AND last_annotated'],
    ['journal', 'last_annotated'],
    ['default(journal, site)', 'last_annotated'],
  ].map(([source, where]) => `# ${c.title}

\`\`\`dataview
TABLE WITHOUT ID file.link AS "${c.note}", last_annotated AS "${c.annotated}", ${source} AS "${c.journal}"
WHERE ${where}
SORT last_annotated DESC
LIMIT 30
\`\`\`
`));
  // One table, no title.
  const untitled = EARLIER_COPY.slice(0, 2).map((c) => `\`\`\`dataview
TABLE WITHOUT ID file.link AS "${c.note}", dateformat(last_annotated, "yyyy-MM-dd HH:mm") AS "${c.annotated}", default(journal, site) AS "${c.journal}"
WHERE last_annotated
SORT last_annotated DESC
LIMIT 30
\`\`\`
`);
  // The default while the tables could be changed in settings.
  const editable = ['zh', 'en'].map((lang) => {
    const c = copyOf(lang);
    return [
      table(c.notes, [
        ['file.link', c.note],
        ['dateformat(last_annotated, "yyyy-MM-dd HH:mm")', c.annotated],
        [originColumn(legacyField, lang, fieldRef), c.source],
      ], 'last_annotated', 'last_annotated DESC', 30),
      table(c.clips, [['file.link', c.original], ['comments', c.comments], ['notes', c.clipNotes]], 'clipped', 'clipped DESC', 100),
    ].join('\n');
  });
  // The preset whose source column led to the clipped original (until 2026-11-11).
  const viaOriginal = ['zh', 'en'].flatMap((lang) => ['references', linkField]
    .map((field) => dashboardMarkdown({ lang, source: originColumn(field, lang) })));
  return [...titled, ...untitled, ...editable, ...preset, ...viaOriginal];
}
