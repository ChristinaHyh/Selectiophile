import test from 'node:test';
import assert from 'node:assert/strict';
import { finishArchive, textHash, paragraphOf } from './archive.js';

const blocks = (md) => md.trim().split('\n\n');

test('marks become block ids and links within the file', () => {
  const md = finishArchive([
    'As shown before⟬L:ref1⟭¹⟬/L⟭ and in ⟬L:fig2⟭Fig. 2a⟬/L⟭.',
    '**Fig. 2:** A figure.⟬A:fig2⟭',
    '1. Smith, A. A paper. (2020).⟬A:ref1⟭\n2. Jones, B. Another. (2021).⟬A:ref2⟭',
  ].join('\n\n'));
  const [text, caption, refs] = blocks(md);
  assert.match(text, /^As shown before\[\[#\^ref1\|¹\]\] and in \[\[#\^fig2\|Fig\. 2a\]\]\. \^p-[a-z0-9]{6}$/);
  assert.equal(caption, '**Fig. 2:** A figure. ^fig2');
  assert.equal(refs, '1. Smith, A. A paper. (2020). ^ref1\n2. Jones, B. Another. (2021). ^ref2', 'each list item has its own id');
});

test('a link to a heading names the heading; one to nothing keeps its text', () => {
  const md = finishArchive('## 2\\. Methods⟬H:1⟭\n\nSee ⟬L:h1⟭Methods⟬/L⟭ and ⟬L:tbl9⟭Table 9⟬/L⟭.');
  const [heading, text] = blocks(md);
  assert.equal(heading, '## 2. Methods', 'the converter\'s escape after a number goes');
  assert.match(text, /^See \[\[#2\. Methods\|Methods\]\] and Table 9\. \^p-/);
});

test('a mark alone in a block names the block before it, and a second mark in a block points to the first', () => {
  const md = finishArchive('1 R. Author, A paper.\n\n⟬A:ref1⟭\n\nText⟬A:x1⟭⟬A:x2⟭ cites ⟬L:ref1⟭1⟬/L⟭ and ⟬L:x2⟭this⟬/L⟭.');
  assert.deepEqual(blocks(md), ['1 R. Author, A paper. ^ref1', 'Text cites [[#^ref1|1]] and [[#^x1|this]]. ^x1']);
});

test('numbered formulas, tables and fenced blocks take their id on a line of their own', () => {
  const md = finishArchive('Where\n$$\nE = mc^2 \\tag{3}\n$$\nholds.\n\n| a | b |\n| --- | --- |\n| ⟬L:eq3⟭(3)⟬/L⟭ | 2 |⟬A:tbl1⟭');
  assert.equal(md, [
    `Where ^p-${textHash('Where')}`,
    '$$\nE = mc^2 \\tag{3}\n$$\n\n^eq3',
    `holds. ^p-${textHash('holds.')}`,
    '| a | b |\n| --- | --- |\n| [[#^eq3\\|(3)]] | 2 |\n\n^tbl1\n',
  ].join('\n\n'), 'a formula inside a paragraph stands on its own');
});

test('every paragraph gets an id from its text, the same on every clip, never on an image line or a heading', () => {
  const source = '---\ntitle: "T"\n---\n# Title\n\nOne paragraph.\n\n![](https://x.org/a.png)\n\nOne paragraph.\n\n- a point\n- another point\n\n---';
  const md = finishArchive(source);
  const id = textHash('One paragraph.');
  assert.equal(md, `---\ntitle: "T"\n---\n# Title\n\nOne paragraph. ^p-${id}\n\n![](https://x.org/a.png)\n\nOne paragraph. ^p-${id}-2\n\n- a point ^p-${textHash('a point')}\n- another point ^p-${textHash('another point')}\n\n---\n`);
  assert.equal(finishArchive(md), md, 'finishing again changes nothing');
  assert.equal(textHash('One  *paragraph*.'), id, 'markup and spacing don\'t change it');
  assert.notEqual(textHash('One paragraph, changed.'), id);
});

test('the page\'s attributes and empty brackets left by removed links go', () => {
  const md = finishArchive('H<sub class="x" data-read-frog-walked="1">2</sub>O, see <a href="https://x.org" class="y">x</a>. \\[\\] \\[\\]');
  assert.match(md, /^H<sub>2<\/sub>O, see <a href="https:\/\/x\.org">x<\/a>\. \^p-/);
});

test('a highlight is found in the paragraph where it starts, formulas and citations aside', () => {
  const md = finishArchive('---\na: 1\n---\nThe rate is $k = \\alpha^{2}$ for the switch, as before[[#^ref1|¹]].\n\nA second paragraph follows here.\n\n| a | b |\n| --- | --- |\n| cell text | 2 |⟬A:tbl1⟭\n\n1. Smith, A paper.⟬A:ref1⟭');
  const first = `p-${textHash('The rate is $k = \\alpha^{2}$ for the switch, as before[[#^ref1|¹]].')}`;
  assert.equal(paragraphOf(md, 'for the switch, as before1.'), first, 'a superscript ¹ is a 1');
  assert.equal(paragraphOf(md, 'The rate is k=α2 for the switch, as before1.'), first, 'a formula shown as glyphs on the page');
  assert.equal(paragraphOf(md, 'as before1. A second paragraph'), first, 'where the highlight starts');
  assert.equal(paragraphOf(md, 'cell text'), 'tbl1', 'a table\'s id is on the line after it');
  assert.equal(paragraphOf(md, 'Smith, A paper'), 'ref1');
  assert.equal(paragraphOf(md, 'Nothing like this is in the file at all.'), null);
});
