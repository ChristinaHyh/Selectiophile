import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardMarkdown, earlierDashboards } from './dashboard.js';

const blocks = (md) => [...md.matchAll(/```dataview\n([\s\S]*?)```/g)].map((m) => m[1]);

test('the dashboard: notes with a clickable source, then clipped originals', () => {
  const md = dashboardMarkdown({ lang: 'zh' });
  const [notes, clips] = blocks(md);
  assert.ok(md.startsWith('## 笔记\n\n```dataview\n'));
  assert.ok(md.includes('\n## 入库原文\n\n```dataview\n'), 'the clips table comes under the notes');
  assert.ok(notes.startsWith('TABLE WITHOUT ID file.link AS "笔记", dateformat(last_annotated, "yyyy-MM-dd HH:mm") AS "最近添加", '));
  // The source is the web page, shown as the journal or site; the original is under
  // the note's References and in the second table. scripts/check_dashboard.cjs runs
  // this in Dataview itself.
  assert.ok(notes.includes(', default(elink(url, default(journal, default(site, url))), default(journal, site)) AS "来源"\n'));
  assert.ok(!/references|reference/.test(notes), 'never the clipped original');
  assert.ok(notes.endsWith('WHERE last_annotated AND !clipped\nSORT last_annotated DESC\nLIMIT 30\n'), 'no clipped original among the notes');
  // Page comments are in the notes linking the original; an earlier version wrote them into the original.
  assert.equal(clips, 'TABLE WITHOUT ID file.link AS "原文", dateformat(clipped, "yyyy-MM-dd") AS "剪藏日期", default(comments, join(filter(flat(list(notes.comments)), (c) => c), "; ")) AS "简评", notes AS "笔记"\nWHERE clipped\nSORT clipped DESC, file.ctime DESC\nLIMIT 100\n');
  assert.ok(!md.includes('Selectiophile') && !md.includes('this.file.folder'), 'works from any folder');
});

test('the headings follow the language of the settings', () => {
  const md = dashboardMarkdown({ lang: 'en' });
  assert.ok(md.startsWith('## Notes\n'));
  assert.ok(md.includes('file.link AS "Note", dateformat(last_annotated, "yyyy-MM-dd HH:mm") AS "Last annotated"'));
  assert.ok(md.includes('## Clipped originals') && md.includes('AS "Clipped", default(comments, join(filter(flat(list(notes.comments)), (c) => c), "; ")) AS "Comments", notes AS "Notes"'));
  assert.ok(!/[一-鿿]/.test(md));
});

test('the source is the web page whatever the link field', () => {
  assert.equal(dashboardMarkdown({ linkField: 'original paper' }), dashboardMarkdown({}));
});

test('a dashboard an earlier version wrote is known, so it can be replaced', () => {
  const earlier = earlierDashboards({ linkField: 'references' });
  // The default while the tables were editable, in both languages.
  const editable = earlier.filter((md) => md.startsWith('## ') && md.includes('WHERE last_annotated\n'));
  assert.equal(editable.length, 2);
  assert.ok(editable.every((md) => md.includes('SORT clipped DESC\n') && md.includes('flat(list(reference))[0]')));
  // The preset while comments were kept in the original.
  const preset = earlier.filter((md) => md.includes('WHERE last_annotated AND !clipped\n') && !md.includes('notes.comments'));
  assert.equal(preset.length, 2);
  assert.ok(preset.every((md) => /, comments AS "(简评|Comments)"/.test(md) && md.includes('flat(list(reference))[0]')));
  assert.ok(!earlier.includes(dashboardMarkdown({ lang: 'zh' })) && !earlier.includes(dashboardMarkdown({ lang: 'en' })));
  // The preset whose source led to the clipped original, for the default link field and the settings' one.
  const viaOriginal = earlier.filter((md) => md.includes('default(link(choice(flat(list(default(references, reference)))[0].file'));
  assert.equal(viaOriginal.length, 4);
  assert.ok(earlierDashboards({ linkField: 'original paper' }).some((md) => md.includes('flat(list(row["original paper"]))[0].file') && md.includes('notes.comments')));
});
