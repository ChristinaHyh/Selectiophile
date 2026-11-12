import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOCK_CRITERIA, buildBlockRequest, buildNoteRequest, buildCrossNoteRequest, decideBlock, decideNote } from './router.js';
import { leafHeadings } from './note.js';

const probs = (a, b) => ({ probabilities: { A: a, B: b, C: 1 - a - b } });

test('every block in the bundled templates has a description', () => {
  for (const file of ['Reading Template.md', 'Article Template.md']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const heading of leafHeadings(text)) assert.ok(BLOCK_CRITERIA[heading], `${file}: ${heading}`);
  }
});

test('the instructions no longer assume a research paper', () => {
  const block = buildBlockRequest({ sourceTitle: 'A Post', quote: 'q' }).questions.block.instructions;
  const note = buildNoteRequest({ pageTitle: 'P', url: 'u', quote: 'q' }, [{ name: 'A' }]).questions;
  for (const text of [block, note.note.instructions, note.belongs.instructions]) assert.ok(!/research paper/i.test(text), text);
  assert.match(note.belongs.instructions, /similar topic does not count/);
});

test('request omits empty fields and duplicate paragraph', () => {
  const { state, questions } = buildBlockRequest({ sourceTitle: 'T', quote: 'q', comment: '  ', paragraph: 'q' });
  assert.deepEqual(state, { source_title: 'T', highlighted_passage: 'q' });
  assert.equal(questions.block.type, 'choice');
});

test('discussion says where the text came from and drops chat headings', () => {
  const { state } = buildBlockRequest({ paperTitle: 'T', quote: 'q', pageSection: 'Answer', discussion: 'GPT 对话' });
  assert.match(state.source, /AI assistant/);
  assert.equal(state.page_section, undefined);
});

test('a heading the user added is offered by name alone', () => {
  const { criteria } = buildBlockRequest({ quote: 'q' }, ['Main Findings:', 'My Heading']).questions.block;
  assert.equal(criteria['Main Findings:'], BLOCK_CRITERIA['Main Findings']);
  assert.equal(criteria['My Heading'], null);
});

test('block auto-saves only at the threshold', () => {
  assert.equal(decideBlock(probs(0.95, 0.03)).auto, true);
  assert.equal(decideBlock(probs(0.9, 0.05)).auto, true);
  assert.equal(decideBlock(probs(0.89, 0.1)).auto, false);
  assert.deepEqual(decideBlock(probs(0.6, 0.3)).ranked.map((r) => r.option), ['A', 'B', 'C']);
});

test('note routing needs both a belonging page and a clear pick', () => {
  const answers = (note, belongs) => ({ note: probs(note, 0.01), belongs: { type: 'noul', noul: belongs } });
  assert.equal(decideNote(answers(0.95, 0.95)).auto, true);
  assert.equal(decideNote(answers(0.95, 0.5)).auto, false);
  assert.equal(decideNote(answers(0.6, 0.99)).auto, false);
});

test('a discussion sends its excerpt so Jev can tell which paper it is about', () => {
  const { state } = buildNoteRequest({ pageTitle: 'Chat', url: 'u', quote: 'q', conversation: 'We talked about Paper X' }, [{ name: 'A' }]);
  assert.equal(state.conversation_opening, 'We talked about Paper X');
  assert.match(state.source, /AI assistant/);
});

test('across several notes, each heading of each note is an option', () => {
  const body = buildCrossNoteRequest({ quote: 'q', comment: 'c', purpose: 'p' }, [
    { key: 'A › Main Findings', title: 'Paper A', heading: 'Main Findings' },
    { key: 'B › Custom', title: 'Paper B', heading: 'Custom' },
  ]);
  const { criteria } = body.questions.block;
  assert.match(criteria['A › Main Findings'], /Paper A.*reports/);
  assert.equal(criteria['B › Custom'], 'In the note on "Paper B".');
  assert.equal(body.state.conversation_opening, undefined, 'the conversation is not read again');
  assert.equal(body.state.highlight_purpose, 'p');
});

test('note request lists candidates and asks whether any applies', () => {
  const body = buildNoteRequest({ pageTitle: 'Blog', url: 'https://x.org', quote: 'q' }, [{ name: 'A(2020)-X', description: 'Paper X' }, { name: 'B(2021)-Y' }]);
  assert.deepEqual(body.questions.note.criteria, { 'A(2020)-X': 'Paper X', 'B(2021)-Y': null });
  assert.equal(body.questions.belongs.type, 'noul');
  assert.ok(body.questions.belongs.instructions.includes('A(2020)-X'));
});
