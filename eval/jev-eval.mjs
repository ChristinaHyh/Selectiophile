#!/usr/bin/env node
// Measures Jev's block routing against labelled highlights.
// Usage: node eval/jev-eval.mjs [--samples file.json] [--model name]
// Key: TYPESAFE_API_KEY, or the first line of ~/.config/selectiophile/jev.key
// (~/.config/lectiophile/jev.key, from before the rename, also works)

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { JEV_MODEL } from '../core/router.js';
import { runEval, formatReport } from '../core/evaluate.js';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  for (const dir of ['selectiophile', 'lectiophile']) {
    try {
      return readFileSync(join(homedir(), `.config/${dir}/jev.key`), 'utf8').split('\n')[0].trim();
    } catch {
      // Try the next place.
    }
  }
  console.error('No key: set TYPESAFE_API_KEY or create ~/.config/selectiophile/jev.key');
  process.exit(2);
}

const samplesPath = flag('--samples', new URL('./samples.json', import.meta.url).pathname);
const samples = JSON.parse(readFileSync(samplesPath, 'utf8'));
const run = await runEval(samples, loadKey(), { model: flag('--model', JEV_MODEL) });
console.log(formatReport(run));

const out = new URL('./last-results.json', import.meta.url).pathname;
writeFileSync(out, JSON.stringify(run.results, null, 2));
console.log(`\nDetails: ${out}`);
