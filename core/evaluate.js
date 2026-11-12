// Runs labelled highlights through Jev. Shared by the Node script and the spike page.
import { askJev, buildBlockRequest, decideBlock, JEV_MODEL } from './router.js';

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

export async function runEval(samples, key, { model = JEV_MODEL, onProgress = () => {} } = {}) {
  const results = [];
  const failures = [];
  let inputTokens = 0;
  let returnedModel = '';
  for (const [i, sample] of samples.entries()) {
    try {
      const { json, ms } = await askJev(key, buildBlockRequest({ ...sample, sourceTitle: sample.paperTitle }, undefined, model));
      const answer = json.answers.block;
      const d = decideBlock(answer);
      inputTokens += json.usage?.input_tokens || 0;
      returnedModel = json.model;
      results.push({ ...sample, choice: answer.choice, correct: answer.choice === sample.label, top: d.top, auto: d.auto, ms, probabilities: answer.probabilities });
    } catch (e) {
      failures.push(`#${i + 1} ${e.message}`);
    }
    onProgress(i + 1, samples.length);
  }
  return { results, failures, inputTokens, model: returnedModel };
}

export function formatReport({ results, failures, inputTokens, model }) {
  const lines = results.map((r) => `${r.correct ? 'OK ' : 'BAD'} p=${r.top.toFixed(2)} ${r.lang.padEnd(4)} ${r.label} -> ${r.choice}`);
  const right = results.filter((r) => r.correct).length;
  lines.push('', `Model ${model} · ${results.length} answered, ${failures.length} failed · accuracy ${pct(right, results.length)} · median ${median(results.map((r) => r.ms)).toFixed(0)}ms · ${inputTokens} input tokens ($${((inputTokens / 1e6) * 0.042).toFixed(5)})`);
  lines.push('', 'By comment language');
  for (const lang of [...new Set(results.map((r) => r.lang))]) {
    const group = results.filter((r) => r.lang === lang);
    lines.push(`  ${lang.padEnd(5)} ${pct(group.filter((r) => r.correct).length, group.length)} (${group.length})`);
  }
  lines.push('', 'Auto-save threshold: share saved silently, and how many of those are right');
  for (const minTop of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const saved = results.filter((r) => r.top >= minTop);
    lines.push(`  p>=${minTop}  coverage ${pct(saved.length, results.length).padStart(4)}  accuracy ${pct(saved.filter((r) => r.correct).length, saved.length)}`);
  }
  if (failures.length) lines.push('', 'Failures', ...failures.slice(0, 5).map((f) => `  ${f}`));
  return lines.join('\n');
}
