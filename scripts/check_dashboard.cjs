// Runs the dashboard's Dataview queries with Dataview itself, against a made-up vault,
// and checks what each table shows. Dataview drops a row whose column fails, with no
// message in Obsidian, so a wrong expression shows up here as a missing row.
//
//   node scripts/check_dashboard.cjs <Dataview's main.js>
//
// main.js is the plugin as installed in a vault (.obsidian/plugins/dataview/main.js);
// it is not part of this repository. Checked with Dataview 0.5.68.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

const mainJs = process.argv[2] && path.resolve(process.argv[2]);
if (!mainJs || !fs.existsSync(mainJs)) {
  console.error('usage: node scripts/check_dashboard.cjs <path to Dataview main.js>');
  process.exit(2);
}

// The plugin's Obsidian and CodeMirror imports are only needed inside Obsidian:
// anything read, called or extended from them gives this back.
const stub = new Proxy(class {}, {
  get: (t, k) => (k === '__esModule' ? false : k === Symbol.toPrimitive ? () => '' : k === 'prototype' ? t.prototype : stub),
  apply: () => stub,
  construct: () => ({}),
});
const load = Module._load;
Module._load = function (request, ...rest) {
  return /^(obsidian|@codemirror\/)/.test(request) ? stub : load.call(this, request, ...rest);
};
const plugin = new Module(mainJs);
plugin.paths = Module._nodeModulePaths(path.dirname(mainJs));
plugin._compile(`${fs.readFileSync(mainJs, 'utf8')}
module.exports.__dashboardCheck = { Context, parseQuery, executeCoreExtract, parseFrontmatter, Link, Values, DEFAULT_QUERY_SETTINGS };`, mainJs);
Module._load = load;
const { Context, parseQuery, executeCoreExtract, parseFrontmatter, Link, Values, DEFAULT_QUERY_SETTINGS } = plugin.exports.__dashboardCheck;

// Values as this extension and Web Clipper write them: quoted strings, inline lists,
// bare dates. Dataview turns "[[…]]" into links and dates into dates.
const VAULT = {
  // Linked by `reference`, as before `references`.
  'Notes/Paper with original.md': { title: '"A"', journal: '"Nature"', url: '"https://nature.com/a"', last_annotated: '2026-11-09T10:05', reference: '"[[Original A]]"' },
  'Notes/Commented paper.md': { journal: '"Cell"', url: '"https://cell.com/g"', last_annotated: '2026-11-04T08:00', references: '"[[Original G]]"', comments: '"Read the methods twice."' },
  'Notes/Second note on G.md': { site: '"Lab blog"', url: '"https://lab.example/g"', last_annotated: '2026-11-03T08:00', references: '["[[Original G]]"]', comments: '"A follow-up."' },
  'Notes/Blog post.md': { title: '"B"', site: '"Example Blog"', url: '"https://blog.example/b"', last_annotated: '2026-11-10T08:00' },
  'Notes/Two originals.md': { journal: '"Science"', url: '"https://science.org/c"', last_annotated: '2026-11-08T08:00', references: '["[[Original C]]", "[[Original A]]"]' },
  'Notes/No address.md': { title: '"D"', last_annotated: '2026-11-07T08:00' },
  'Notes/Original deleted.md': { journal: '"Cell"', url: '"https://cell.com/e"', last_annotated: '2026-11-06T08:00', references: '"[[Gone]]"' },
  'Notes/Spaced field.md': { journal: '"PNAS"', authors: '["A. One", "B. Two"]', url: '"https://pnas.org/f"', last_annotated: '2026-11-05T08:00', 'original paper': '"[[Original A]]"', reference: '"[[Gone]]"' },
  'Notes/Not ours.md': { title: '"no last_annotated"' },
  'refs/Original A.md': { source: '"https://nature.com/a"', clipped: '2026-11-09', comments: '"Worth rereading."', notes: '"[[Paper with original]]"' },
  'refs/Original C.md': { clipped: '2026-11-10', notes: '"[[Two originals]]"' },
  'refs/Original G.md': { clipped: '2026-11-08', notes: '["[[Commented paper]]", "[[Second note on G]]"]' },
  // Commented on, never highlighted: no note, the comment kept in the original.
  'refs/Original H.md': { clipped: '2026-11-07', comments: '"Only a comment."' },
  // Clipped by an earlier version, to the minute.
  'refs/Older original.md': { clipped: '2026-11-04T09:00' },
  // A clipped original a highlight once went into: it stays an original.
  'refs/Annotated original.md': { clipped: '2026-11-09', last_annotated: '2026-11-09T12:00' },
  'refs/Web Clipper file.md': { created: '2026-01-01' },
};
// When each file was made, for originals clipped the same day.
const CREATED = { 'refs/Original A.md': '2026-11-09T10:06', 'refs/Annotated original.md': '2026-11-09T12:01' };
const pages = new Map(Object.entries(VAULT).map(([file, raw]) => {
  const fields = {};
  for (const [k, v] of Object.entries(raw)) fields[k] = parseFrontmatter(/^["[]/.test(v) ? JSON.parse(v) : v);
  const ctime = parseFrontmatter(CREATED[file] || '2026-01-01T00:00');
  return [file, { ...fields, file: { path: file, name: path.basename(file, '.md'), link: Link.file(file), ctime } }];
}));
const find = (l) => [...pages.keys()].find((p) => p === l || path.basename(p, '.md') === l);
const linkHandler = { resolve: (l) => (find(l) ? pages.get(find(l)) : null), normalize: (l) => find(l) || l, exists: (l) => Boolean(find(l)) };

const show = (v) => {
  if (v == null) return '';
  if (v instanceof Link) return `[[${path.basename(v.path, '.md')}${v.display ? `|${v.display}` : ''}]]`;
  if (v.$widget) return `<${v.url}|${v.display}>`;
  if (Array.isArray(v)) return v.map(show).join(', ');
  return Values.toString(v, DEFAULT_QUERY_SETTINGS);
};

function run(markdown) {
  return [...markdown.matchAll(/```dataview\n([\s\S]*?)```/g)].map(([, block]) => {
    const parsed = parseQuery(block);
    assert.ok(parsed.successful, `Dataview can't parse:\n${block}\n${parsed.error}`);
    const query = parsed.value;
    const fields = Object.fromEntries(query.header.fields.map((f) => [f.name, f.field]));
    const rows = [...pages].map(([file, data]) => ({ id: Link.file(file), data }));
    const result = executeCoreExtract(rows, new Context(linkHandler, DEFAULT_QUERY_SETTINGS, { this: {} }), query.operations, fields);
    assert.ok(result.successful, result.error);
    const dropped = result.value.diagnostics.flatMap((d) => d.errors);
    assert.deepEqual(dropped, [], `rows Dataview would drop:\n${block}`);
    return result.value.data.map((row) => query.header.fields.map((f) => show(row.data[f.name])));
  });
}

(async () => {
  const { dashboardMarkdown } = await import(path.join(__dirname, '../core/dashboard.js'));

  const [notes, clips] = run(dashboardMarkdown({ lang: 'zh' }));
  assert.deepEqual(notes, [
    ['[[Blog post]]', '2026-11-10 08:00', '<https://blog.example/b|Example Blog>'],
    ['[[Paper with original]]', '2026-11-09 10:05', '<https://nature.com/a|Nature>'],
    ['[[Two originals]]', '2026-11-08 08:00', '<https://science.org/c|Science>'],
    ['[[No address]]', '2026-11-07 08:00', ''],
    ['[[Original deleted]]', '2026-11-06 08:00', '<https://cell.com/e|Cell>'],
    ['[[Spaced field]]', '2026-11-05 08:00', '<https://pnas.org/f|PNAS>'],
    ['[[Commented paper]]', '2026-11-04 08:00', '<https://cell.com/g|Cell>'],
    ['[[Second note on G]]', '2026-11-03 08:00', '<https://lab.example/g|Lab blog>'],
  ], 'notes: every note but no clipped original, its source a link to the web page, shown as journal or site');
  assert.deepEqual(clips, [
    ['[[Original C]]', '2026-11-10', '', '[[Two originals]]'],
    ['[[Annotated original]]', '2026-11-09', '', ''],
    ['[[Original A]]', '2026-11-09', 'Worth rereading.', '[[Paper with original]]'],
    ['[[Original G]]', '2026-11-08', 'Read the methods twice.; A follow-up.', '[[Commented paper]], [[Second note on G]]'],
    ['[[Original H]]', '2026-11-07', 'Only a comment.', ''],
    ['[[Older original]]', '2026-11-04', '', ''],
  ], 'clipped originals by day, then newest file first; a time written before is shown as its day; comments come from the notes, or an earlier version\'s in the original');

  // In English too, no row dropped.
  const [english] = run(dashboardMarkdown({ lang: 'en' }));
  assert.deepEqual(english, notes);
  console.log('ok   the dashboard runs in Dataview as intended');
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
