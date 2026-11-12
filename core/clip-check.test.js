import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipProblems } from './clip-check.js';

const paragraph = 'A paragraph of the paper, long enough to read as one sentence or two. '.repeat(4);
const clip = (body) => `---\ntitle: "x"\n---\n${paragraph}\n\n${body}`;

test('a good clip has no problems', () => {
  const md = clip('The rate is $k_{on} = \\alpha^{2}$ here.\n\n> 速率为 $k_{on}$。\n\n$$\nE = mc^2 \\tag{1}\n$$\n\n^eq1');
  assert.deepEqual(clipProblems(md, { formulas: 2, failedSteps: [] }), []);
});

test('formulas count once each, translations add copies, prices are not formulas', () => {
  const md = clip('It costs $5 and $10 to run $x$ and $y$.');
  assert.deepEqual(clipProblems(md, { formulas: 4 }), []);
  assert.deepEqual(clipProblems(md, { formulas: 5 }), [{ code: 'formulas', page: 5, clip: 2 }]);
  // One formula on the page proves too little to judge by.
  assert.deepEqual(clipProblems(clip('no formula'), { formulas: 1 }), []);
});

test('an empty body, leftover marks and failed steps are each named', () => {
  assert.deepEqual(clipProblems('---\na: 1\n---\n## Abstract\n\nshort'), [{ code: 'empty' }]);
  const [left] = clipProblems(clip('see ⟦FIG1⟧ and <mjx-math>'));
  assert.equal(clipProblems(clip('a mark ⟬A:fig1⟭ left'))[0].code, 'leftovers');
  assert.equal(left.code, 'leftovers');
  assert.match(left.sample, /⟦FIG1⟧/);
  assert.deepEqual(clipProblems(clip('fine'), { failedSteps: ['copies'] }), [{ code: 'prep', steps: ['copies'] }]);
});

// ---------------------------------------------------------------------------
// Checking a clip against the page it came from
// ---------------------------------------------------------------------------
import { clipFidelity, clipCheckLine, clipReviewLine, markdownText, articleSelectors, comparable } from './clip-check.js';

const PARA = 'Scaffold splitting can be more challenging than random splitting, as the splitting is conducted using the scaffold as the smallest unit.';

test('a clip\'s words are compared without its markup, formulas, images or link targets', () => {
  const md = '---\ntitle: x\n---\n## Results  结果\n\nThe rate $k = \\alpha^{2}$ rises ([[#^ref40|40]]), see [Fig. 1](https://x.org/f1) and p < 0.01 here, Monroe,&nbsp;2014. ^p1\n\n![[assets/a_MD5.png]]\n\n<table><tr><td>cell&amp;text</td></tr></table>\n';
  const text = markdownText(md);
  assert.ok(!text.includes('alpha') && !text.includes('https') && !text.includes('MD5') && !text.includes('^p1') && !text.includes('<td>'));
  assert.ok(text.includes('rises (40)') && text.includes('see Fig. 1') && text.includes('p < 0.01 here, Monroe, 2014') && text.includes('cell&text'), text);
  assert.equal(comparable('Ünïcode – “quotes” 3.5 μm'), 'ünïcodequotes35μm');
});

test('every block of the page is found in the clip, though figure links and numbers sit inside its paragraphs', () => {
  const md = `---\ntitle: x\n---\n${PARA.replace('random splitting,', 'random splitting ([[#^fig4|Figure 4]]),')}\n\n(1)\n\nShort.\n`;
  const f = clipFidelity(md, [PARA, 'Short.', PARA]);
  assert.deepEqual(f, { blocks: 1, missing: [], duplicates: 0, twice: [] }, 'short blocks and repeats of the page don\'t count');
  const lost = clipFidelity('---\ntitle: x\n---\nSomething else entirely, nothing of the paragraph at all.\n', [PARA]);
  assert.deepEqual(lost.missing, [PARA]);
});

test('figures and paragraphs given twice are found, as when a hidden gallery is clipped too', () => {
  const caption = '**Figure 1.** Scheme of the experimental setup and a plexiglass frame with special comb guides to ensure laminar flow.';
  const md = `---\ntitle: x\n---\n![](https://x.org/g1.png)\n\n${caption}\n\nText.\n\n![](https://x.org/g1.png)\n\n${caption}\n\n![Fig](./saved files/with spaces/g2.png)\n\n![Fig](./saved files/with spaces/g3.png)\n`;
  const f = clipFidelity(md, []);
  assert.equal(f.duplicates, 2, 'the image and its caption; images named with spaces are told apart');
  assert.ok(f.twice.includes('image:https://x.org/g1.png'));
});

test('a clip with text missing or doubled is reported, and its completeness written down', () => {
  // Sixty different paragraphs, as an article has.
  const blocks = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${Array.from({ length: 10 }, (_, j) => `term${i * 10 + j}`).join(' ')}.`);
  const whole = `---\ntitle: x\n---\n${blocks.join('\n\n')}\n`;
  assert.deepEqual(clipProblems(whole, { blocks }).filter((p) => p.code === 'missing'), []);
  assert.equal(clipCheckLine(whole, { blocks, formulas: 0 }), 'text 60/60 blocks, duplicates 0');
  // One block in sixty may go (a copyright line the config drops); three may not.
  const without = (n) => `---\ntitle: x\n---\n${blocks.slice(n).join('\n\n')}\n`;
  assert.deepEqual(clipProblems(without(1), { blocks }).filter((p) => p.code === 'missing'), []);
  const [missing] = clipProblems(without(3), { blocks }).filter((p) => p.code === 'missing');
  assert.deepEqual({ ...missing, sample: missing.sample.slice(0, 11) }, { code: 'missing', blocks: 60, missing: 3, sample: 'Paragraph 0' });
  assert.equal(clipCheckLine(without(3), { blocks, formulas: 4 }), 'text 57/60 blocks, duplicates 0, formulas 0/4');
  assert.equal(clipCheckLine(whole, {}), '', 'nothing to say without the page');
});

test('a clip that looks wrong says so in words an AI reading it later can act on', () => {
  assert.equal(clipReviewLine([]), '', 'nothing when all is well');
  assert.equal(clipReviewLine([{ code: 'missing', blocks: 60, missing: 3, sample: 'Paragraph 0' }, { code: 'formulas', page: 84, clip: 0 }, { code: 'duplicates', count: 2 }]),
    'incomplete, check against the page: 3 of 60 page paragraphs missing, e.g. "Paragraph 0"; formulas 0/84; 2 repeated images or paragraphs');
  assert.equal(clipReviewLine([{ code: 'prep', steps: ['links'] }, { code: 'empty' }]), 'incomplete, check against the page: page preparation failed (links); body nearly empty');
});

test('the parts of the page a config clips are its selectorHtml\'s', () => {
  assert.deepEqual(articleSelectors({ noteContentFormat: '{{selectorHtml:#abstracts|markdown}}\n\n{{ selectorHtml:#body .x|remove_html:("a")}}\n\n{{content}}' }), ['#abstracts', '#body .x']);
  assert.deepEqual(articleSelectors({ noteContentFormat: '{{content}}' }), []);
  assert.deepEqual(articleSelectors(null), []);
});
