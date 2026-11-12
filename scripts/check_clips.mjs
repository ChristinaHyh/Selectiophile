// Clips saved pages again and compares each with the clip last approved, so a change to
// a config, to content/clip-prep.js or to the vendor bundle shows exactly what it
// changes, and a page saved after a site's redesign shows what broke.
//
//   node scripts/check_clips.mjs <dir with playwright> <samples dir> [--update] [name …]
//
// Each sample is a folder in the samples dir:
//   page.html      the page as saved by the browser (Ctrl+S), translated or not
//   case.json      { "url": "https://…", "config": "papers-science-clipper.json" }
//                  `config` is a bundled file in profiles/, or a path to a Web Clipper file;
//                  `expectWarnings` lists checks a saved page can't pass, such as
//                  "formulas" for MathJax output saved without its MathML
//   expected.md    the approved clip; --update writes it from the current clip
//
// Samples are whole articles, so they stay outside the extension and are never published.
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipProblems, articleSelectors, clipFidelity, clipCheckLine, clipReviewLine } from '../core/clip-check.js';
import { finishArchive } from '../core/archive.js';

const args = process.argv.slice(2);
const update = args.includes('--update');
const [harness, samplesDir, ...only] = args.filter((a) => a !== '--update');
if (!harness || !samplesDir) {
  console.error('usage: node scripts/check_clips.mjs <dir with playwright> <samples dir> [--update] [name …]');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(resolve(harness), 'x.js'))('playwright');

// The day a clip is made is not part of what it should be.
const stable = (md) => md.replace(/^created: .*$/m, 'created: <today>');

function firstDifferences(expected, actual, max = 6) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
    if (a[i] !== b[i]) out.push(`  line ${i + 1}\n    - ${(a[i] ?? '(none)').slice(0, 160)}\n    + ${(b[i] ?? '(none)').slice(0, 160)}`);
  }
  return out.join('\n');
}

const names = (await readdir(samplesDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && existsSync(join(samplesDir, d.name, 'case.json')))
  .map((d) => d.name)
  .filter((n) => !only.length || only.includes(n))
  .sort();
if (!names.length) {
  console.error(`No samples in ${samplesDir}`);
  process.exit(2);
}

const vendor = await readFile(join(root, 'vendor/clipper.js'), 'utf8');
const prep = await readFile(join(root, 'content/clip-prep.js'), 'utf8');
const browser = await chromium.launch();
let failed = 0;
for (const name of names) {
  const dir = join(samplesDir, name);
  const sample = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8'));
  const configPath = isAbsolute(sample.config) || sample.config.includes('/') ? resolve(dir, sample.config) : join(root, 'profiles', sample.config);
  const template = JSON.parse(await readFile(configPath, 'utf8'));
  // The saved page's own scripts don't run: what was saved is what Read Frog and
  // MathJax had made of the page.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto(`file://${resolve(dir, 'page.html')}`, { waitUntil: 'domcontentloaded' });
  const cdp = await context.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'selectiophile' });
  const run = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await run(vendor);
  await run(prep);
  // As background.js clips: the article's text as shown, then a prepared copy of the page.
  const clip = await run(`(async () => {
    const blocks = SelectiophileClipPrep.articleBlocks(document, ${JSON.stringify(articleSelectors(template))});
    const formulas = SelectiophileClipPrep.articleFormulas(document, ${JSON.stringify(articleSelectors(template))});
    const doc = document.cloneNode(true);
    const page = SelectiophileClipPrep.prepare(doc, { url: ${JSON.stringify(sample.url)}, selectors: ${JSON.stringify(articleSelectors(template))} });
    return { ...(await SelectiophileClipper.clipDocument({ template: ${JSON.stringify(template)}, doc, url: ${JSON.stringify(sample.url)} })), page: { ...page, blocks, ...(formulas === null ? {} : { formulas }) } };
  })()`);
  await context.close();
  // As core/service.js saves it.
  clip.fullContent = finishArchive(clip.fullContent);

  const actual = stable(clip.fullContent);
  const problems = clipProblems(clip.fullContent, clip.page).filter((p) => !(sample.expectWarnings || []).includes(p.code));
  const expectedPath = join(dir, 'expected.md');
  const note = problems.length ? `  warnings: ${problems.map((p) => p.code).join(', ')}` : '';
  if (process.env.FIDELITY) {
    const f = clipFidelity(clip.fullContent, clip.page.blocks);
    console.log(`     ${name}: ${clipCheckLine(clip.fullContent, clip.page)}`);
    const review = clipReviewLine(clipProblems(clip.fullContent, clip.page));
    if (review) console.log(`     ${name}: clip_review: ${review}`);
    for (const m of f.missing.slice(0, Number(process.env.FIDELITY) || 8)) console.log(`       missing: ${m.slice(0, 150)}`);
    for (const d of f.twice) console.log(`       twice: ${d.slice(0, 150)}`);
  }
  if (update) {
    await writeFile(expectedPath, actual);
    console.log(`saved ${name} (${clip.noteName})${note}`);
  } else if (!existsSync(expectedPath)) {
    failed += 1;
    console.log(`NEW  ${name}: no expected.md yet; read the clip, then run again with --update${note}`);
  } else {
    const expected = await readFile(expectedPath, 'utf8');
    if (expected === actual && !problems.length) console.log(`ok   ${name}`);
    else {
      failed += 1;
      console.log(`DIFF ${name}${note}`);
      if (expected !== actual) console.log(firstDifferences(expected, actual));
    }
  }
}
await browser.close();
if (update) console.log(`${names.length} samples approved as clipped now`);
else console.log(failed ? `${failed} of ${names.length} samples need a look` : `${names.length} samples unchanged`);
process.exit(failed ? 1 : 0);
