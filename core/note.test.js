import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseHeadings, insertEntry, removeEntry, formatEntry, setFrontmatterField, readFrontmatter,
  instantiateTemplate, noteFileName, textFragmentUrl, normalizeDate, NoteError, headingOfEntry, setEntryStyle, setEntryComment, readComment, stripCitations, sortFrontmatter, hasEntry, countEntries, moveEntry, addFrontmatterLink,
  leafHeadings, addReferenceLink, renameFrontmatterField, frontmatterLinks, setEntryClip, entryClip } from './note.js';

const template = readFileSync(new URL('../Reading Template.md', import.meta.url), 'utf8');
const BLOCKS = [
  'Research Question', 'Main Findings', 'Novelty', 'Limitations of Experimental Design',
  'Insufficient Evidence or Alternative Explanations', 'Ideas for My Research',
  'Potential Follow-up Experiments', 'Others',
];
const entry = (over = {}) => ({
  id: 'a1b2', quote: 'We found an effect.', comment: '可以用到我的实验。',
  url: 'https://example.org/paper', date: '2026-11-05', ...over,
});
const sectionOf = (md, heading) => {
  const lines = md.split('\n');
  const hs = parseHeadings(md);
  const i = hs.findIndex((h) => h.text === heading);
  const next = hs.slice(i + 1).find((h) => h.level <= hs[i].level);
  return lines.slice(hs[i].line + 1, next ? next.line : lines.length).join('\n');
};

test('parses every template block and ignores frontmatter', () => {
  const texts = parseHeadings(template).map((h) => h.text);
  for (const block of BLOCKS) assert.ok(texts.includes(block), block);
  assert.equal(texts.length, BLOCKS.length + 4);
  assert.equal(texts.at(-1), 'References');
});

test('References lists clipped originals and is never a place for highlights', () => {
  assert.deepEqual(leafHeadings(template), BLOCKS);
  const once = addReferenceLink(template, 'Original A');
  assert.ok(once.endsWith('# Others\n\n# References\n\n- [[Original A]]\n'), JSON.stringify(once.slice(-60)));
  const twice = addReferenceLink(once, 'Original B');
  assert.ok(twice.endsWith('# References\n\n- [[Original A]]\n- [[Original B]]\n'));
  assert.equal(addReferenceLink(twice, 'Original A'), twice, 'a link is there once');
  assert.equal(addReferenceLink(twice.replace('[[Original B]]', '[[Original B|B]]'), 'Original B'), twice.replace('[[Original B]]', '[[Original B|B]]'));
  // A note from an older template gets the section at its end.
  const old = '---\ntitle: "x"\n---\n\n# Summary\n\n# Others\n \n';
  assert.equal(addReferenceLink(old, 'Original A'), '---\ntitle: "x"\n---\n\n# Summary\n\n# Others\n\n# References\n\n- [[Original A]]\n');
  // One moved up by hand keeps its place, and what follows it.
  const moved = '# References\n\n- [[Original A]]\n\n# Others\n\ntext\n';
  assert.equal(addReferenceLink(moved, 'Original B'), '# References\n\n- [[Original A]]\n- [[Original B]]\n\n# Others\n\ntext\n');
  assert.equal(addReferenceLink('# References\n# Others\n', 'X'), '# References\n\n- [[X]]\n\n# Others\n');
  // Windows line endings stay.
  assert.ok(addReferenceLink(template.replace(/\n/g, '\r\n'), 'A').endsWith('# References\r\n\r\n- [[A]]\r\n'));
});

test('the links of a property are read inline or one per line', () => {
  assert.deepEqual(frontmatterLinks('---\nreferences: "[[A]]"\n---\n', 'references'), ['A']);
  assert.deepEqual(frontmatterLinks('---\nreferences: ["[[A]]", "[[B|b]]", "[[A]]"]\nx: "[[C]]"\n---\n', 'references'), ['A', 'B']);
  assert.deepEqual(frontmatterLinks('---\nreferences:\n  - "[[A]]"\n  - "[[B#h]]"\nx: 1\n---\n[[D]]', 'references'), ['A', 'B']);
  assert.deepEqual(frontmatterLinks('---\nreference: "[[A]]"\n---\n', 'references'), [], 'another property');
  assert.deepEqual(frontmatterLinks('no frontmatter [[A]]', 'references'), []);
});

test('a property can be renamed, keeping its value', () => {
  const md = '---\ntitle: "x"\nreference: "[[A]]"\n---\nbody\n';
  assert.equal(renameFrontmatterField(md, 'reference', 'references'), '---\ntitle: "x"\nreferences: "[[A]]"\n---\nbody\n');
  const both = '---\nreference: "[[A]]"\nreferences: "[[B]]"\n---\n';
  assert.equal(renameFrontmatterField(both, 'reference', 'references'), both, 'not over one already there');
  assert.equal(renameFrontmatterField('---\nreferences: x\n---\n', 'reference', 'references'), '---\nreferences: x\n---\n', 'a longer name is not the same property');
  assert.equal(renameFrontmatterField('no frontmatter', 'a', 'b'), 'no frontmatter');
});

for (const block of BLOCKS) {
  test(`insert then undo restores the template: ${block}`, () => {
    const inserted = insertEntry(template, block, entry());
    assert.ok(sectionOf(inserted, block).includes('data-lp="a1b2"'));
    assert.equal(parseHeadings(inserted).length, parseHeadings(template).length);
    assert.equal(removeEntry(inserted, 'a1b2'), template);
  });
}

test('entry stays above the --- closing a section', () => {
  const md = insertEntry(template, 'Novelty', entry());
  assert.ok(md.indexOf('data-lp="a1b2"') < md.indexOf('# Shortcomings'));
  assert.match(md, /- \*\*Comments：\*\* 可以用到我的实验。\n\n+---\n# Shortcomings/);
});

test('entries in a block keep reading order', () => {
  let md = insertEntry(template, 'Main Findings', entry({ id: 'one', quote: 'first' }));
  md = insertEntry(md, 'Main Findings', entry({ id: 'two', quote: 'second' }));
  assert.ok(md.indexOf('data-lp="one"') < md.indexOf('data-lp="two"'));
  assert.ok(md.indexOf('data-lp="two"') < md.indexOf('## Novelty'));
  assert.equal(removeEntry(removeEntry(md, 'two'), 'one'), template);
});

test('the note format: a plain quote with its link, then a Comments item', () => {
  assert.deepEqual(formatEntry(entry({ purpose: '方法', color: 'blue', exact: 'We found an effect.' })), [
    '> <span style="color:#7ea6d4">■</span> We found an effect. <sup>方法 · <a href="https://example.org/paper#:~:text=We%20found%20an%20effect." data-lp="a1b2" title="2026-11-05">原文</a></sup>',
    '',
    '- **Comments：** 可以用到我的实验。',
  ]);
});

test('no markers, callouts or position data are written', () => {
  const text = formatEntry(entry({ color: 'red', purpose: '质疑', prefix: 'PREFIX', suffix: 'SUFFIX' })).join('\n');
  for (const absent of ['%%', '[!', 'PREFIX', 'SUFFIX']) assert.ok(!text.includes(absent), absent);
  assert.ok(text.startsWith('> <span style="color:#df8f8f">■</span> '));
});

test('a highlight with no comment or purpose is just the quote and link', () => {
  const lines = formatEntry(entry({ comment: '  ' }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^> <span [^>]*>■<\/span> We found an effect\. <sup><a /);
});

test('a multi-paragraph quote keeps the link on its last line', () => {
  const lines = formatEntry(entry({ quote: 'one\n\ntwo', comment: '' }));
  assert.match(lines[0], /^> <span [^>]*>■<\/span> one$/);
  assert.equal(lines[1], '>');
  assert.match(lines[2], /^> two <sup>/);
});

test('a multi-line comment stays inside the list item, and removes as one', () => {
  const lines = formatEntry(entry({ comment: 'first\n\nsecond\nthird' }));
  assert.deepEqual(lines.slice(2), ['- **Comments：** first', '', '  second', '  third']);
  const md = insertEntry(template, 'Novelty', entry({ comment: 'first\n\nsecond\nthird' }));
  assert.equal(removeEntry(md, 'a1b2'), template);
});

test('discussion entries are labelled and have no text fragment', () => {
  const [line] = formatEntry(entry({ url: 'https://chatgpt.com/c/a(1)', discussion: 'GPT', comment: '' }));
  assert.match(line, /<a href="https:\/\/chatgpt\.com\/c\/a%281%29" data-lp="a1b2" title="2026-11-05">GPT<\/a>/);
});

test('link attributes are escaped', () => {
  const [line] = formatEntry(entry({ url: 'https://x.org/a?b=1&c="d"', comment: '' }));
  assert.ok(line.includes('?b=1&amp;c=%22d%22'));
});

test('citations are removed from the quote, but not from formulas or the link', () => {
  assert.equal(stripCitations('Shown before [12], and again [1, 2] or [3-5].'), 'Shown before, and again or.');
  assert.equal(stripCitations('中文引用［1］不变，半角[1，2]去掉'), '中文引用［1］不变，半角去掉');
  assert.equal(stripCitations('The set $x \\in [1,2]$ holds [3].'), 'The set $x \\in [1,2]$ holds.');
  assert.equal(stripCitations('Keep [a] and [1a].'), 'Keep [a] and [1a].');
  assert.equal(stripCitations('[12]'), '[12]', 'never leaves an empty quote');
  const [line] = formatEntry(entry({ quote: 'A result [12].', exact: 'A result [12].', comment: '' }));
  assert.match(line, /■<\/span> A result\. <sup>/);
  assert.ok(line.includes('%5B12%5D'), 'the link still matches the page text');
});

test('a quote or comment containing HTML cannot pose as an entry link', () => {
  const fake = '<a href="x" data-lp="zzzz">';
  const md = insertEntry(template, 'Novelty', entry({ quote: `quote ${fake}`, comment: `note ${fake}` }));
  assert.equal(hasEntry(md, 'zzzz'), false);
  assert.equal(countEntries(md), 1);
  assert.equal(removeEntry(md, 'a1b2'), template);
});

test('removing an entry leaves neighbors and handwritten text alone', () => {
  let md = insertEntry(template, 'Novelty', entry({ id: 'aaaa', comment: '第一条' }));
  md = insertEntry(md, 'Novelty', entry({ id: 'bbbb', comment: '第二条' }));
  md = md.replace('- **Comments：** 第二条', '- **Comments：** 第二条\n\n我手写的段落');
  const out = removeEntry(md, 'bbbb');
  assert.ok(out.includes('我手写的段落'));
  assert.ok(out.includes('第一条'));
  assert.ok(!out.includes('第二条'));
  assert.ok(!removeEntry(md, 'aaaa').includes('第一条'));
  assert.ok(removeEntry(md, 'aaaa').includes('第二条'));
});

test('moving keeps a comment edited by hand', () => {
  const md = insertEntry(template, 'Novelty', entry()).replace('可以用到我的实验。', '改过的评论\n  第二行');
  const out = moveEntry(md, 'a1b2', 'Others');
  assert.equal(headingOfEntry(out, 'a1b2'), 'Others');
  assert.ok(out.slice(out.indexOf('# Others')).includes('改过的评论\n  第二行'));
});

test('a color change edits only the color block and purpose', () => {
  const md = insertEntry(template, 'Novelty', entry({ purpose: '方法', color: 'blue' }));
  const changed = setEntryStyle(md, 'a1b2', { color: 'red', purpose: '质疑' });
  assert.ok(changed.includes('<span style="color:#df8f8f">■</span> We found'));
  assert.ok(changed.includes('<sup>质疑 · <a '));
  assert.ok(!changed.includes('方法') && !changed.includes('#7ea6d4'));
  assert.ok(changed.includes('- **Comments：** 可以用到我的实验。'));
  const cleared = setEntryStyle(changed, 'a1b2', { color: 'red', purpose: '' });
  assert.ok(cleared.includes('<sup><a '));
  assert.equal(removeEntry(cleared, 'a1b2'), template);
});

test('a color change adds the block to an entry saved before blocks existed', () => {
  const md = insertEntry(template, 'Novelty', entry({ comment: '' })).replace(/<span [^>]*>■<\/span> /, '');
  assert.ok(setEntryStyle(md, 'a1b2', { color: 'green', purpose: '' }).includes('> <span style="color:#7fae8c">■</span> We found'));
});

test('a comment can be added, changed and removed', () => {
  const bare = insertEntry(template, 'Novelty', entry({ comment: '' }));
  assert.equal(readComment(bare, 'a1b2'), '');
  const added = setEntryComment(bare, 'a1b2', '后来补的评论');
  assert.equal(readComment(added, 'a1b2'), '后来补的评论');
  assert.match(added, /<\/sup>\n\n- \*\*Comments：\*\* 后来补的评论\n/);
  const changed = setEntryComment(added, 'a1b2', '第一段\n\n第二段');
  assert.equal(readComment(changed, 'a1b2'), '第一段\n\n第二段');
  assert.ok(!changed.includes('后来补的评论'));
  assert.equal(setEntryComment(changed, 'a1b2', '  '), bare);
  assert.equal(removeEntry(changed, 'a1b2'), template);
});

test('editing a comment leaves neighbors and handwritten text alone', () => {
  let md = insertEntry(template, 'Novelty', entry({ id: 'aaaa', comment: '第一条' }));
  md = insertEntry(md, 'Novelty', entry({ id: 'bbbb', comment: '第二条' }));
  md = md.replace('- **Comments：** 第二条', '- **Comments：** 第二条\n\n我手写的段落');
  const out = setEntryComment(md, 'aaaa', '改过');
  assert.ok(out.includes('- **Comments：** 改过') && out.includes('第二条') && out.includes('我手写的段落'));
  const second = setEntryComment(md, 'bbbb', '改过');
  assert.ok(second.includes('第一条') && second.includes('我手写的段落') && !second.includes('第二条'));
});

test('special characters in a comment survive being edited again', () => {
  const text = '# 标题样式\n---\np<0.05 且 a<b\n```';
  const md = setEntryComment(insertEntry(template, 'Novelty', entry({ comment: '' })), 'a1b2', text);
  assert.equal(readComment(md, 'a1b2'), text);
  assert.equal(parseHeadings(md).length, parseHeadings(template).length);
  assert.equal(readComment(setEntryComment(md, 'a1b2', readComment(md, 'a1b2')), 'a1b2'), text);
});

test('comments on older entries are left for editing in Obsidian', () => {
  const old = '# A\n\n%% lp:old1 %%\n> quote\n\n> [!info] 方法\n> comment\n\n%% /lp %%\n';
  assert.equal(readComment(old, 'old1'), null);
  assert.throws(() => setEntryComment(old, 'old1', 'x'), (e) => e.code === 'entry_legacy');
});

test('frontmatter is ordered by what each field is, and nothing is lost', () => {
  const md = '---\nresearch notes:\nlast_annotated: 2026-01-01T10:00\nkeywords:\n  - a\n  - b\ncreated: 2026-01-01\nurl: "u"\ndoi: "d"\npublished: 2024\njournal: "J"\nauthors: ["A"]\ncustom: 1\ntitle: "T"\n---\n\n# Body\n';
  assert.equal(sortFrontmatter(md), '---\ntitle: "T"\nauthors: ["A"]\njournal: "J"\npublished: 2024\ndoi: "d"\nurl: "u"\nkeywords:\n  - a\n  - b\ncreated: 2026-01-01\nlast_annotated: 2026-01-01T10:00\nresearch notes:\ncustom: 1\n---\n\n# Body\n');
  assert.equal(sortFrontmatter('# no frontmatter\n'), '# no frontmatter\n');
  assert.equal(sortFrontmatter(sortFrontmatter(md)), sortFrontmatter(md), 'stable');
  const crlf = sortFrontmatter(md.replace(/\n/g, '\r\n'));
  assert.ok(crlf.startsWith('---\r\ntitle: "T"\r\n'));
});

test('a config\'s source is not written, as url already holds the address', () => {
  const md = instantiateTemplate(template, { title: 'T', url: 'https://x.org/a', properties: { source: { value: 'https://x.org/a', type: 'text' }, kept: { value: 'yes', type: 'text' } } });
  assert.ok(!md.includes('source:'));
  assert.ok(md.includes('url: "https://x.org/a"'));
  assert.ok(md.includes('kept: "yes"'));
});

test('config values are written by type', () => {
  const md = instantiateTemplate(template, {
    title: 'Full',
    properties: {
      title: { value: 'Short', type: 'text' },
      authors: { value: ['[[A B]]', 'C "D"'], type: 'multitext' },
      keywords: { value: 'solo', type: 'multitext' },
      published: { value: '2024/3/5', type: 'date' },
      paper_id: { value: ['1', '2'], type: 'text' },
      count: { value: '7', type: 'number' },
    },
  });
  assert.ok(md.includes('title: "Short"\n'));
  assert.ok(md.includes('authors: ["[[A B]]", "C \\"D\\""]\n'));
  assert.ok(md.includes('keywords: ["solo"]\n'));
  assert.ok(md.includes('published: 2024-03-05\n'));
  assert.ok(md.includes('paper_id: "1, 2"\n'));
  assert.ok(md.includes('count: 7\n'));
  assert.ok(md.includes('last_annotated:\n'), 'template fields stay');
});

test('a config title names the file; a safe name is still enforced', () => {
  assert.equal(noteFileName({ title: 'x', properties: { title: { value: 'Li(2024)-A/B: Tests' } } }), 'Li(2024)-A B Tests.md');
  assert.equal(noteFileName({ authors: ['A B'], published: '2020', title: 'T', properties: {} }), 'B(2020)-T.md');
});

test('an article is named by its title, and gets article fields', () => {
  assert.equal(noteFileName({ isPaper: false, title: 'Why Attention: A Long Look', authors: ['Jane'], published: '2024' }), 'Why Attention A Long Look.md');
  assert.equal(noteFileName({ isPaper: false, title: 'x'.repeat(200) }).length, 83);
  assert.equal(noteFileName({ isPaper: false, title: '' }), 'Untitled.md');
  const md = instantiateTemplate('---\ntitle:\nauthor:\nsite:\n---\n\n# A\n', {
    isPaper: false, title: 'T', authors: ['A B', 'C D'], site: 'Good Letter', journal: 'nope', url: 'https://x.org', published: '2024-05-06T10:00:00Z',
  });
  assert.ok(md.includes('author: "A B, C D"\n'));
  assert.ok(md.includes('site: "Good Letter"\n'));
  assert.ok(md.includes('published: 2024-05-06\n'));
  assert.ok(md.includes('url: "https://x.org"\n'));
  assert.ok(!md.includes('journal') && !md.includes('authors:'));
});

test('entries written by earlier versions still work', () => {
  const v4 = '# A\n\n%% lp:old1 %%\n> quote\n>\n> — [↗ 原文](https://x.org) · 2026-11-05 · 方法\n\n> [!info] 方法\n> comment\n\n%% /lp %%\n\n# B\n';
  assert.equal(hasEntry(v4, 'old1'), true);
  assert.equal(countEntries(v4), 1);
  assert.equal(headingOfEntry(v4, 'old1'), 'A');
  assert.ok(setEntryStyle(v4, 'old1', { color: 'red', purpose: '质疑' }).includes('· 2026-11-05 · 质疑'));
  assert.equal(removeEntry(v4, 'old1'), '# A\n\n# B\n');
  const v3 = '# A\n\n%% lp:old3 %%\n> [!lectio] [↗ 原文](https://x.org) · 2026-11-05\n> quote\n\ncomment\n%% /lp %%\n';
  assert.equal(setEntryStyle(v3, 'old3', { color: 'red', purpose: 'x' }), v3);
});

test('hostile quote and comment cannot change note structure', () => {
  const hostile = entry({
    quote: '# fake heading\n```\n%% /lp %%',
    comment: '# Main Findings\n---\n```\nunclosed fence\n%% /lp %%\n%% lp:zzzz %%',
  });
  const md = insertEntry(template, 'Research Question', hostile);
  assert.equal(parseHeadings(md).length, parseHeadings(template).length);
  assert.equal(removeEntry(md, 'a1b2'), template);
  assert.equal(hasEntry(md, 'zzzz'), false);
});

test('headings inside code fences are ignored', () => {
  const md = '---\ntitle: x\n---\n# Real\n```\n# Others\n```\ntext\n# Others\nmore\n';
  assert.deepEqual(parseHeadings(md).map((h) => h.text), ['Real', 'Others']);
  const out = insertEntry(md, 'Others', entry());
  assert.ok(out.indexOf('data-lp="a1b2"') > out.lastIndexOf('# Others'));
});

test('user-added subheadings stay inside the target block', () => {
  const md = insertEntry(template.replace('## Novelty\n', '## Novelty\n\n### Sub\ntext\n'), 'Novelty', entry());
  assert.ok(md.indexOf('data-lp="a1b2"') > md.indexOf('### Sub'));
  assert.ok(md.indexOf('data-lp="a1b2"') < md.indexOf('# Shortcomings'));
});

test('heading match tolerates colons and case; missing and duplicate fail loudly', () => {
  const md = '# A\n## Main Findings:\n\n# B\n';
  assert.ok(insertEntry(md, 'main findings', entry()).includes('data-lp="a1b2"'));
  assert.throws(() => insertEntry(md, 'Nope', entry()), (e) => e instanceof NoteError && e.code === 'heading_missing');
  assert.throws(() => insertEntry('# X\n# X\n', 'X', entry()), (e) => e.code === 'heading_ambiguous');
});

test('CRLF notes stay CRLF', () => {
  const crlf = template.replace(/\n/g, '\r\n');
  const md = insertEntry(crlf, 'Novelty', entry());
  assert.equal(md.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(removeEntry(md, 'a1b2'), crlf);
});

test('undo reports missing and damaged entries', () => {
  assert.throws(() => removeEntry(template, 'none'), (e) => e.code === 'entry_missing');
  assert.throws(() => removeEntry('%% lp:x %%\ntext', 'x'), (e) => e.code === 'entry_damaged');
});

test('frontmatter edit touches one line only', () => {
  const md = setFrontmatterField(template, 'last_annotated', '2026-11-05T10:00:00');
  assert.equal(readFrontmatter(md).last_annotated, '2026-11-05T10:00:00');
  assert.equal(md.split('\n').length, template.split('\n').length);
  assert.equal(setFrontmatterField(md, 'last_annotated', ''), template);
  assert.ok(setFrontmatterField(template, 'new_key', '1').includes('new_key: 1\n---'));
});

test('template instantiation survives YAML-hostile values', () => {
  const md = instantiateTemplate(template, {
    title: 'Foo: "bar" baz', authors: ['Li, Wei', 'Ann Smith'], journal: 'Nature',
    published: '2017/6/12', doi: '10.1000/xyz', url: 'https://x.org/a',
  });
  assert.ok(md.includes('title: "Foo: \\"bar\\" baz"\n'));
  assert.ok(md.includes('authors: ["Li, Wei", "Ann Smith"]\n'));
  assert.ok(md.includes('published: 2017-06-12\n'));
  assert.equal(readFrontmatter(md).doi, '10.1000/xyz');
  assert.ok(md.includes('last_annotated:\n'), 'empty template fields stay');
});

test('file name follows 第一作者(年份)-标题缩写', () => {
  assert.equal(noteFileName({ authors: ['Ashish Vaswani'], published: '2017-06-12', title: 'Attention Is All You Need' }),
    'Vaswani(2017)-Attention All You Need.md');
  assert.equal(noteFileName({ authors: ['Li, Wei'], published: '2024', title: 'Deep Learning of the Brain: A Survey of Methods' }),
    'Li(2024)-Deep Learning Brain.md');
  assert.equal(noteFileName({ authors: ['张三'], published: '2023-01', title: '基于深度学习的文献笔记自动归类方法研究' }),
    '张三(2023)-基于深度学习的文献笔记自.md');
  assert.equal(noteFileName({ title: 'A/B Tests: why?' }), 'A B Tests.md');
  assert.equal(noteFileName({}), 'Untitled.md');
});

test('text fragment links', () => {
  assert.equal(textFragmentUrl('https://x.org/a', 'well-known fact'), 'https://x.org/a#:~:text=well%2Dknown%20fact');
  assert.equal(textFragmentUrl('https://x.org/a#S3', 'fact'), 'https://x.org/a#S3:~:text=fact');
  assert.equal(textFragmentUrl('https://x.org/a#:~:text=old', 'new'), 'https://x.org/a#:~:text=new');
  assert.ok(!textFragmentUrl('https://x.org/a_(b)', 'c').includes('('));
  const long = textFragmentUrl('https://x.org/a', Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '));
  assert.ok(long.endsWith('text=w0%20w1%20w2%20w3%20w4,w35%20w36%20w37%20w38%20w39'));
});

test('dates normalize', () => {
  assert.equal(normalizeDate('2017/6/12'), '2017-06-12');
  assert.equal(normalizeDate('2024'), '2024');
  assert.equal(normalizeDate(''), '');
});

test('a reference link is added once, keeping links already there', () => {
  const md = '---\ntitle: "x"\nreference:\n---\nbody';
  const one = addFrontmatterLink(md, 'reference', 'Paper A');
  assert.equal(one, '---\ntitle: "x"\nreference: "[[Paper A]]"\n---\nbody');
  assert.equal(addFrontmatterLink(one, 'reference', 'Paper A'), one);
  assert.equal(addFrontmatterLink(one, 'reference', 'Paper B'), '---\ntitle: "x"\nreference: ["[[Paper A]]", "[[Paper B]]"]\n---\nbody');
  assert.equal(addFrontmatterLink('---\ntitle: "x"\n---\n', 'source_doc', 'P'), '---\ntitle: "x"\nsource_doc: "[[P]]"\n---\n');
  const block = '---\nreference:\n  - "[[Paper A]]"\ntags: []\n---\n';
  assert.equal(addFrontmatterLink(block, 'reference', 'Paper B'), '---\nreference:\n  - "[[Paper A]]"\n  - "[[Paper B]]"\ntags: []\n---\n');
  assert.equal(addFrontmatterLink(block, 'reference', 'Paper A'), block);
});

test('an entry\'s link holds where its text is in the original, hidden, and keeps it when restyled', () => {
  const md = formatEntry({ id: 'e1', quote: 'We found it.', url: 'https://x.org/a', date: '2026-11-11', color: 'yellow' }).join('\n');
  const linked = setEntryClip(md, 'e1', 'A "Paper"#^p-abc123');
  assert.match(linked, /data-lp="e1" data-clip="A &quot;Paper&quot;#\^p-abc123"/);
  assert.equal(entryClip(linked, 'e1'), 'A "Paper"#^p-abc123');
  const again = setEntryClip(linked, 'e1', 'A#^p-2');
  assert.equal((again.match(/data-clip=/g) || []).length, 1, 'replaced, not added');
  assert.equal(entryClip(setEntryStyle(again, 'e1', { color: 'green' }), 'e1'), 'A#^p-2');
  assert.equal(setEntryClip(md, 'other', 'A#^p-1'), md, 'another id changes nothing');
});
