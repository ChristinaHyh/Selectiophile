import test from 'node:test';
import assert from 'node:assert/strict';
import { runEval, formatReport } from './evaluate.js';

const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const answer = (choice, p) => ({
  model: 'jev-test',
  answers: { block: { type: 'choice', choice, confidence: p, probabilities: { [choice]: p, Other: 1 - p } } },
  usage: { input_tokens: 100 },
});
const sample = (label, lang) => ({ label, lang, paperTitle: 'T', quote: 'q', comment: 'c' });

test('counts answers, wrong picks and regional failures separately', async (t) => {
  const replies = [
    reply(200, answer('A', 0.9)),
    reply(200, answer('A', 0.8)),
    reply(451, { title: 'not available', status: 451 }),
  ];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const run = await runEval([sample('A', 'zh'), sample('B', 'en'), sample('C', 'en')], 'key');
  assert.equal(run.results.length, 2);
  assert.equal(run.failures.length, 1);
  assert.match(run.failures[0], /^#3 HTTP 451/);
  const report = formatReport(run);
  assert.match(report, /2 answered, 1 failed · accuracy 50%/);
  assert.match(report, /zh\s+100% \(1\)/);
  assert.match(report, /en\s+0% \(1\)/);
  assert.ok(!report.includes('key'.repeat(2)));
});

test('retries rate limits, then succeeds', async (t) => {
  const replies = [reply(429, 'slow down'), reply(200, answer('A', 0.9))];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const run = await runEval([sample('A', 'en')], 'key');
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(run.results[0].correct, true);
});
