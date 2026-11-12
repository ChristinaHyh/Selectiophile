#!/usr/bin/env node
// Drives the real extension in headless Chromium.
// Stand-ins: the browser's private file system replaces the chosen folder, since the
// folder picker cannot be automated, and Jev's responses are faked. Real folder
// permissions and real Jev answers need a person and a key.
//
// Usage: node e2e/run.mjs <dir with playwright and mathjax@3.2.2 installed> [screenshot dir]

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const [harness, shots] = process.argv.slice(2);
const { chromium } = createRequire(join(resolve(harness), 'x.js'))('playwright');
const root = new URL('..', import.meta.url).pathname;

const NOTE = 'Vaswani(2017)-Attention All You Need.md';
const NOTE_NAME = NOTE;
const PAPER = `<!doctype html><html><head><title>Attention | A Journal</title>
<meta name="citation_title" content="Attention Is All You Need">
<meta name="citation_author" content="Ashish Vaswani"><meta name="citation_author" content="Noam Shazeer">
<meta name="citation_journal_title" content="A Journal"><meta name="citation_publication_date" content="2017/06/12">
<meta name="citation_doi" content="10.1000/attention"></head>
<body style="max-width:680px;margin:40px auto;font:16px/1.6 serif"><h1>Attention Is All You Need</h1>
<h2>Results</h2>
<p id="find">The Transformer achieves 28.4 BLEU on the English-to-German translation task.</p>
<p id="second">Training took far less time than recurrent alternatives on the same hardware.</p>
<p id="third">Our model generalizes well to other tasks with limited training data.</p>
<p id="dup1">We repeat this sentence here.</p><p>Some text between the two copies.</p><p id="dup2">We repeat this sentence here.</p>
<p id="color1">Color one sentence goes here.</p><p id="color2">Color two sentence goes here.</p>
<p id="color3">Color three sentence goes here.</p><p id="color4">Color four sentence goes here.</p>
<p id="color5">Color five sentence goes here.</p><p id="color6">Color six sentence goes here.</p><p id="color7">Color seven sentence goes here.</p>
<p id="fresh1">A fresh sentence for recency.</p><p id="fresh2">A fresh sentence saved under a pin.</p>
<p id="math">The energy is <math alttext="E=mc^{2}"><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math> in this frame.</p>
</body></html>`;
const BLOG = `<!doctype html><html><head><title>A Blog About Models</title></head>
<body style="max-width:680px;margin:40px auto;font:16px/1.6 serif"><h1>A Blog About Models</h1>
<p id="post">This post walks through why attention helps sequence models.</p></body></html>`;

const PAPER_TWO = `<!doctype html><html><head><title>Second</title>
<meta name="citation_title" content="Second Paper On Other Things"><meta name="citation_author" content="Grace Hopper">
<meta name="citation_publication_date" content="2020/01/01"><meta name="citation_doi" content="10.1000/second"></head>
<body><h1>Second Paper On Other Things</h1><p id="s2">The second paper reports a different result entirely.</p><p id="s3">A sentence kept for the English test.</p></body></html>`;
// Stands in for a chat app: it switches conversations without reloading and re-renders.
const CHAT = `<!doctype html><html><head><title>Chat about attention</title></head>
<body style="max-width:680px;margin:40px auto;font:16px/1.6 sans-serif"><h1>Answer</h1>
<div id="thread"><p id="c1">Attention lets the model weigh every input token against the others.</p>
<p id="c2">A follow-up could test this on longer sequences.</p></div>
<script>
  window.switchChat = (path, text) => { history.pushState({}, '', path); document.getElementById('thread').innerHTML = '<p id="c1">' + text + '</p>'; };
  window.rerender = () => { const t = document.getElementById('thread'); t.innerHTML = t.innerHTML; };
</script></body></html>`;

const MDPI = `<!doctype html><html><head><title>Paper | MDPI</title>
<meta name="citation_author" content="Zhang, Wei"><meta name="citation_author" content="Li, Ming">
<meta name="citation_publication_date" content="2024/03/05"><meta name="citation_title" content="Deep Learning for Protein Folding Studies">
<meta name="citation_doi" content="10.3390/ijms25053071"><meta name="citation_journal_title" content="Int. J. Mol. Sci.">
<meta name="dc.subject" content="proteins"><meta name="dc.subject" content="folding"></head>
<body style="max-width:680px;margin:40px auto;font:16px/1.6 serif"><h1>Deep Learning for Protein Folding Studies</h1>
<p id="m1">Proteins fold quickly under these conditions.</p><p id="m2">They also misfold when heated.</p></body></html>`;
const THIRD = `<!doctype html><html><head><title>Computing</title><meta name="citation_title" content="Computing Machinery and Intelligence">
<meta name="citation_author" content="Alan Turing"><meta name="citation_publication_date" content="1950/10/01"><meta name="citation_doi" content="10.1093/mind/lix.236.433"></head>
<body><h1>Computing Machinery and Intelligence</h1><p id="t1">Can machines think, the author asks.</p></body></html>`;
const NESTED = `<!doctype html><html><head><title>Time</title><meta name="citation_title" content="Time, Clocks, and the Ordering of Events"><meta name="citation_doi" content="10.1145/359545.359563"></head>
<body><h1>Time, Clocks</h1><p id="n1">Events are partially ordered by this relation.</p></body></html>`;

const TRANSLATED = `<!doctype html><html><head><title>Bilingual</title><meta name="citation_title" content="Bilingual Reading Test"><meta name="citation_doi" content="10.1000/bilingual"></head>
<body><h1>Bilingual</h1><p id="tr">Original words stay here.<span class="read-frog-translated-content-wrapper"> 译文不进笔记。 </span> Second part follows.</p></body></html>`;
const DOOMED = `<!doctype html><html><head><title>Doomed</title><meta name="citation_title" content="Doomed Paper"><meta name="citation_author" content="Marie Curie"><meta name="citation_publication_date" content="2001"><meta name="citation_doi" content="10.1000/doomed"></head>
<body><h1>Doomed Paper</h1><p id="d1">This note will be deleted later.</p></body></html>`;
const BILINGUAL_NOTE = 'Bilingual Reading Test.md';

const SUBSTACK = `<!doctype html><html><head><title>Why Attention Keeps Winning - by Jane</title>
<meta property="og:title" content="Why Attention Keeps Winning"><meta property="og:site_name" content="Jane's Letter">
<meta name="author" content="Jane Roe"><meta property="article:published_time" content="2024-05-06T10:00:00Z"></head>
<body style="max-width:680px;margin:40px auto;font:16px/1.6 serif"><h1>Why Attention Keeps Winning</h1>
<p id="a1">Attention keeps winning benchmarks because it scales.</p><p id="a2">A second thought on scale.</p></body></html>`;

// Nature's article layout, trimmed: abstract, body with a citation, a figure and an
// equation MathJax hasn't rendered, then the reference list.
const NATURE = `<!doctype html><html><head><title>Quantum supremacy | Nature</title>
<meta name="citation_title" content="Quantum supremacy using a programmable superconducting processor">
<meta name="citation_author" content="Arute, Frank"><meta name="citation_author" content="Arya, Kunal">
<meta name="citation_publication_date" content="2019/10"><meta name="citation_online_date" content="2019/10/23">
<meta name="citation_doi" content="10.1038/s41586-019-1666-5"><meta name="citation_journal_title" content="Nature"></head>
<body><ul class="c-article-author-list"><li><a data-test="author-name">Frank Arute</a></li><li><a data-test="author-name">Kunal Arya</a></li></ul>
<div class="c-article-body"><section aria-labelledby="Abs1" data-title="Abstract"><div class="c-article-section"><h2 class="c-article-section__title">Abstract</h2>
<div class="c-article-section__content" id="Abs1-content"><p id="nabs">The promise of quantum computers is that some tasks run faster<sup><a data-track="click" data-track-action="reference anchor" data-test="citation-ref" title="Feynman, R. P." href="/articles/s41586-019-1666-5#ref-CR1" id="ref-link-1">1</a></sup>.</p></div></div></section>
<div class="main-content"><section data-title="Main"><div class="c-article-section"><h2 class="c-article-section__title" id="Sec1">Main</h2><div class="c-article-section__content">
<p id="nmain">Feynman proposed quantum computers<sup><a data-test="citation-ref" href="#ref-CR1">1</a>,<a data-test="citation-ref" href="#ref-CR2">2</a></sup>, as in Fig. <a data-track-action="figure anchor" href="/articles/s41586-019-1666-5#Fig1">1</a>.</p>
<div class="c-article-section__figure"><figure><figcaption><b id="Fig1" class="c-article-section__figure-caption">Fig. 1: The Sycamore processor.</b></figcaption><div><picture><img src="//media.springernature.com/lw685/fig1.png" alt="Fig. 1: The Sycamore processor."></picture><div class="c-article-section__figure-link"><a class="c-article__pill-button" href="/figures/1"><span>Full size image</span></a></div><div class="c-article-section__figure-description"><p><b>a</b>, Layout of the processor.</p></div></div></figure></div>
<div id="Equ1" class="c-article-equation"><div class="c-article-equation__content"><span class="mathjax-tex">$$F={2}^{n}-1$$</span></div><div class="c-article-equation__number">
 (1)
</div></div><p>where <span class="mathjax-tex">\\(n\\)</span> is the number of qubits.</p></div></div></section></div>
<section data-title="References"><div id="Bib1-content"><ol class="c-article-references"><li class="c-article-references__item" data-counter="1."><p class="c-article-references__text" id="ref-CR1">Feynman, R. P. Simulating physics with computers. <i>Int. J. Theor. Phys</i>. <b>21</b>, 467–488 (1982).</p><p class="c-article-references__links"><a href="https://doi.org/x">Article</a></p></li>
<li class="c-article-references__item" data-counter="2."><p class="c-article-references__text" id="ref-CR2">Devoret, M. H. Tunneling. (1985).</p></li></ol></div></section></div></body></html>`;

// science.org's layout, typeset by MathJax 3 without hidden MathML, so a formula's
// LaTeX is only to be had from the page's MathJax. The page then plays Read Frog:
// a translation holding a copy of the formula, and no userscript marks anything.
const SCIENCE = `<!doctype html><html><head><title>Nanoswitch screening | Science</title>
<meta name="dc.Title" content="Discovering molecular modulators with nanoswitch screening">
<meta name="dc.Creator" content="Clinton H. Hansen"><meta name="dc.Date" scheme="WTN8601" content="2026-11-05">
<meta name="citation_journal_title" content="Science">
<script>window.MathJax = { options: { menuOptions: { settings: { assistiveMml: false } } }, startup: { pageReady: () => MathJax.startup.defaultPageReady().then(() => {
  const p = document.getElementById('sabs');
  const copy = p.querySelector('mjx-container').cloneNode(true);
  copy.classList.add('read-frog-inline-atom');
  const wrap = document.createElement('span');
  wrap.className = 'notranslate read-frog-translated-content-wrapper';
  const block = document.createElement('span');
  block.className = 'notranslate read-frog-translated-block-content';
  block.append('速率为 ', copy, '，适用于这个开关。');
  wrap.append(document.createElement('br'), block);
  p.append(wrap);
  document.documentElement.dataset.ready = '1';
}) } };</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script></head>
<body><span property="author"><span property="familyName">Hansen</span></span>
<section id="abstract"><h2>Abstract</h2><div role="paragraph" id="sabs">The rate is \\(k = \\alpha^2\\) for the switch, which we measured on many scaffolds of DNA.</div></section>
<section id="bodymatter"><div role="paragraph">FIND works on proteins of many kinds and sizes, as shown before (<a href="#core-collateral-R1" role="doc-biblioref" data-xml-rid="R1"><i>1</i></a>).</div>
<div class="display-formula" id="E"><div class="equation">\\[E = mc^2\\]</div></div></section>
<section id="bibliography"><div class="biblioentry"><div class="label">1</div><div id="R1" class="citations"><div class="citation"><div class="citation-content">R. Santos, A map of drug targets. <em>Nat. Rev. Drug Discov.</em> (2017).</div></div></div></div></section>
</body></html>`;

// MDPI's layout, with formulas drawn by MathJax 3's SVG output: no mjx-math to read,
// with or without hidden MathML. The page plays Read Frog as above.
const mdpi = (hidden) => `<!doctype html><html><head><title>Entropy | MDPI</title>
<meta name="citation_title" content="Formulas Drawn as Pictures${hidden ? ' Again' : ''}">
<meta name="citation_author" content="Lovelace, Ada"><meta name="citation_publication_date" content="2026/03/12">
<meta name="citation_doi" content="10.3390/e2603000${hidden ? 2 : 1}"><meta name="citation_journal_title" content="Entropy">
<script>window.MathJax = { options: { menuOptions: { settings: { assistiveMml: ${hidden} } } }, startup: { pageReady: () => MathJax.startup.defaultPageReady().then(() => {
  const p = document.getElementById('mabs');
  const copy = p.querySelector('mjx-container').cloneNode(true);
  copy.classList.add('read-frog-inline-atom');
  const wrap = document.createElement('span');
  wrap.className = 'notranslate read-frog-translated-content-wrapper';
  const block = document.createElement('span');
  block.className = 'notranslate read-frog-translated-block-content';
  block.append('熵为 ', copy, '，按比特计。');
  wrap.append(document.createElement('br'), block);
  p.append(wrap);
  document.documentElement.dataset.ready = '1';
}) } };</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script></head>
<body><article><div id="article-contents"><section><h2>1. Introduction</h2>
<div class="html-p" id="mabs">The entropy is \\(H = -\\sum p_i\\) in bits.</div>
<div class="html-disp-formula-info" id="FD1">\\[S = k W^2\\]</div>
<div class="html-p">Both quantities count the same thing: how many ways a system can be arranged without changing what we see of it from outside. The first is used for messages, the second for gases; the constant only changes the units in which the answer is given.</div></section></div></article></body></html>`;

// A page with MathJax's lazy typesetting (MDPI turns it on): a formula far down the page
// isn't drawn until scrolled to, and a macro of the page's own (\\RR), which Obsidian
// wouldn't know.
const LAZY = `<!doctype html><html><head><title>Lazy | MDPI</title>
<meta name="citation_title" content="Formulas Not Drawn Yet">
<meta name="citation_author" content="Noether, Emmy"><meta name="citation_publication_date" content="2026/04/01">
<meta name="citation_doi" content="10.3390/e2604000"><meta name="citation_journal_title" content="Entropy">
<script>window.MathJax = { loader: { load: ['ui/lazy'] }, tex: { macros: { RR: '\\\\mathbb{R}' } }, startup: { pageReady: () => MathJax.startup.defaultPageReady().then(() => {
  document.documentElement.dataset.ready = '1';
}) } };</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script></head>
<body><article><div id="article-contents"><section><h2>1. Introduction</h2>
<div class="html-p">Let \\(x \\in \\RR\\) be a real number, as the whole of this section assumes throughout.</div>
<div class="html-p" style="margin-top: 4000px">Far below, the rate is \\(\\frac{a}{b} % a comment
+ c\\) and nothing else, which holds for every case considered in the study above.</div>
<div class="html-disp-formula-info" id="FD1">\\begin{equation}E = mc^2 \\label{eq:e}\\end{equation}</div>
</section></div></article></body></html>`;

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url.startsWith('/blog')) res.end(BLOG);
  else if (req.url.startsWith('/second')) res.end(PAPER_TWO);
  else if (req.url.startsWith('/third')) res.end(THIRD);
  else if (req.url.startsWith('/translated')) res.end(TRANSLATED);
  else if (req.url.startsWith('/doomed')) res.end(DOOMED);
  else if (req.url.startsWith('/nested')) res.end(NESTED);
  else res.end(PAPER);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// The test copy may touch every site, so no permission prompt blocks it.
const extDir = await mkdtemp(join(tmpdir(), 'selectiophile-ext-'));
await cp(root, extDir, { recursive: true, filter: (p) => !p.includes('/e2e') });
const manifest = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('<all_urls>');
await writeFile(join(extDir, 'manifest.json'), JSON.stringify(manifest));

const profile = await mkdtemp(join(tmpdir(), 'selectiophile-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  reducedMotion: 'reduce',
  ignoreDefaultArgs: ['--hide-scrollbars'],
  viewport: { width: 1100, height: 760 },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

await context.addInitScript(() => {
  window.__lpRanges = () => [...CSS.highlights.keys()].filter((k) => k.startsWith('selectiophile-')).flatMap((k) => [...CSS.highlights.get(k)]);
  window.__lpColorOf = (text) => [...CSS.highlights.keys()].find((k) => [...CSS.highlights.get(k)].some((r) => r.toString().includes(text)));
});

context.setDefaultTimeout(8000);

const failures = [];
const consoleErrors = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`);
    if (shots) await page?.screenshot({ path: join(shots, `fail-${failures.length}.png`) }).catch(() => {});
  }
}

let page;

try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  // Set before any page opens, because changing the language reloads open pages.
  // A worker that has only just started may not have its extension APIs yet.
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await sw.evaluate(() => chrome.storage.local.set({ lang: 'zh' }));
  const admin = await context.newPage();
  await admin.goto(`chrome-extension://${extId}/options/options.html`);

  const template = await readFile(join(root, 'Reading Template.md'), 'utf8');
  await admin.evaluate(async ({ template }) => {
    const { saveFolder } = await import('/core/handle.js');
    const opfs = await navigator.storage.getDirectory();
    const dir = await opfs.getDirectoryHandle('Selectiophile', { create: true });
    const w = await (await dir.getFileHandle('Reading Template.md', { create: true })).createWritable();
    await w.write(template);
    await w.close();
    await saveFolder(dir);
    // Papers clip on their first note by default; only the clipping checks want that.
    await chrome.storage.local.set({ sites: ['127.0.0.1', '*.chatgpt.com'], jevKey: 'fake-key', docTypes: [{ id: 'paper', autoClip: false, clipPath: '' }] });
    const res = await chrome.runtime.sendMessage({ type: 'folder:ready' });
    if (!res.ok) throw new Error(res.error);
  }, { template });

  // Fake Jev: the comment text selects the behavior under test.
  const installFakeJev = () => sw.evaluate(() => {
    if (globalThis.__jevFaked) return;
    globalThis.__jevFaked = true;
    globalThis.__jevRequests = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('api.typesafe.ai')) return real(url, options);
      const body = JSON.parse(options.body);
      globalThis.__jevRequests.push(body);
      const comment = body.state.reader_comment || '';
      if (body.questions.note) {
        const options = Object.keys(body.questions.note.criteria);
        if (body.state.conversation_opening?.includes('Second Paper On Other Things')) {
          const sure = options.find((n) => n.startsWith('Hopper'));
          return new Response(JSON.stringify({ model: 'fake', answers: { note: { type: 'choice', choice: sure, probabilities: Object.fromEntries(options.map((n) => [n, n === sure ? 0.97 : 0.03 / options.length])) }, belongs: { type: 'noul', noul: 0.98 } } }), { status: 200 });
        }
        const probabilities = Object.fromEntries(options.map((n, i) => [n, i === 0 ? 0.6 : 0.4 / Math.max(1, options.length - 1)]));
        return new Response(JSON.stringify({ model: 'fake', answers: { note: { type: 'choice', choice: options[0], probabilities }, belongs: { type: 'noul', noul: 0.4 } } }), { status: 200 });
      }
      if (comment.includes('region')) return new Response('{"title":"not available"}', { status: 451 });
      const unsure = comment.includes('unsure');
      const names = Object.keys(body.questions.block?.criteria || {});
      const wanted = comment.includes('idea') ? 'Ideas for My Research' : 'Main Findings';
      const first = names.includes(wanted) ? wanted : names[0];
      const probabilities = Object.fromEntries(names.map((n) => [n, 0]));
      probabilities[first] = unsure ? 0.55 : 0.97;
      const second = first !== 'Novelty' && names.includes('Novelty') ? 'Novelty' : names.find((n) => n !== first);
      if (second) probabilities[second] = unsure ? 0.35 : 0.03;
      return new Response(JSON.stringify({ model: 'fake', answers: { block: { type: 'choice', choice: first, probabilities } }, usage: { input_tokens: 1 } }), { status: 200 });
    };
  });
  await installFakeJev();

  const read = (name) => admin.evaluate(async (n) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
    try {
      return await (await (await dir.getFileHandle(n)).getFile()).text();
    } catch {
      return null;
    }
  }, name);
  const files = () => admin.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
    const names = [];
    for await (const [n] of dir.entries()) names.push(n);
    return names.sort();
  });
  const entryCount = async (name) => ((await read(name)) || '').match(/data-lp="/g)?.length || 0;

  // A toast from the previous save may still be showing, so wait on the file itself.
  const waitForEntries = async (name, count) => {
    for (let i = 0; i < 50; i++) {
      if ((await entryCount(name)) >= count) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`expected ${count} entries in ${name}, found ${await entryCount(name)}`);
  };

  page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  const open = async (path) => {
    await page.goto(origin + path);
    await page.locator('selectiophile-ui').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  };
  const select = (id) => page.locator(`#${id}`).click({ clickCount: 3 });
  // Triple-click stops at inline math, so this selects the paragraph directly.
  const selectAll = (id) => page.evaluate((i) => window.getSelection().selectAllChildren(document.getElementById(i)), id);
  const toolbarButton = (name) => page.locator('selectiophile-ui .toolbar button', { hasText: name });
  const toast = () => page.locator('selectiophile-ui .toast');
  const panelButton = (name) => page.locator('selectiophile-ui .panel button', { hasText: name });
  const highlightTexts = () => page.evaluate(() => window.__lpRanges().map((r) => r.toString()));

  await page.goto(`${origin}/paper`);
  const bodyBefore = await page.evaluate(() => document.body.innerHTML);

  await check('a script Lectiophile registered before the rename is removed', async () => {
    await sw.evaluate(() => chrome.scripting.registerContentScripts([{ id: 'lectiophile-content', js: ['content/content.js'], matches: ['https://lectiophile.invalid/*'] }]));
    // Any change to the site lists syncs the scripts; the blocklist is unused in allowlist mode.
    await sw.evaluate(async () => {
      const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
      await chrome.storage.local.set({ blockedSites: [...blockedSites, 'lectiophile.invalid'] });
      await chrome.storage.local.set({ blockedSites });
    });
    const ids = async () => (await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())).map((s) => s.id);
    for (let i = 0; i < 40 && (await ids()).includes('lectiophile-content'); i++) await page.waitForTimeout(100);
    assert.deepEqual(await ids(), ['selectiophile-content']);
  });

  await check('toolbar appears after selecting text', async () => {
    await select('find');
    await toolbarButton('评论').waitFor({ timeout: 4000 });
    assert.equal(await page.locator('selectiophile-ui .toolbar .dot-btn').count(), 6);
    if (shots) await page.screenshot({ path: join(shots, '1-toolbar.png') });
  });

  await check('comment box saves, creating the note from the template', async () => {
    await toolbarButton('评论').click();
    await page.locator('selectiophile-ui textarea').fill('这是核心结果');
    if (shots) await page.screenshot({ path: join(shots, '2-comment.png') });
    await page.keyboard.press('Control+Enter');
    await toast().filter({ hasText: '新建并存入' }).waitFor({ timeout: 5000 });
    assert.match(await toast().innerText(), /Main Findings/);
    assert.equal(await toast().locator('a').getAttribute('href'),
      `obsidian://open?file=${encodeURIComponent('Vaswani(2017)-Attention All You Need#Main Findings')}`);
    if (shots) await page.screenshot({ path: join(shots, '3-saved.png') });
    assert.deepEqual(await files(), ['Reading Template.md', NOTE, '_dashboard.md'].sort());
    const md = await read(NOTE);
    assert.ok(md.includes('title: "Attention Is All You Need"'));
    assert.ok(md.includes('authors: ["Ashish Vaswani", "Noam Shazeer"]'));
    assert.ok(md.includes('published: 2017-06-12'));
    assert.ok(md.includes('doi: "10.1000/attention"'));
    assert.ok(/last_annotated: \d{4}-\d\d-\d\dT/.test(md));
    const section = md.slice(md.indexOf('## Main Findings'), md.indexOf('## Novelty'));
    assert.ok(section.includes('> The Transformer achieves 28.4 BLEU'));
    assert.ok(!section.includes('%%') && !section.includes('[!'), 'no markers or callouts');
    assert.match(section, /<sup>重点 · <a href="[^"]*" data-lp="\w+" title="[\d-]+">原文<\/a><\/sup>\n\n- \*\*Comments：\*\* 这是核心结果/);
    assert.ok(section.includes(`#:~:text=The%20Transformer`), 'link jumps back to the text');
  });

  await check('Jev receives the page section and comment', async () => {
    const requests = await sw.evaluate(() => globalThis.__jevRequests);
    assert.equal(requests[0].state.page_section, 'Results');
    assert.equal(requests[0].state.reader_comment, '这是核心结果');
    assert.equal(requests[0].state.source_title, 'Attention Is All You Need');
    assert.equal(Object.keys(requests[0].questions.block.criteria).length, 8);
  });

  await check('saved text stays highlighted and the selection clears', async () => {
    assert.ok((await highlightTexts()).some((t) => t.includes('28.4 BLEU')));
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
  });

  await check('page DOM is untouched by highlighting', async () => {
    assert.equal(await page.evaluate(() => document.body.innerHTML), bodyBefore);
  });

  await check('keyboard shortcut saves to the same note', async () => {
    await select('second');
    await page.keyboard.press('Alt+KeyS');
    await toast().filter({ hasText: '已存入' }).waitFor({ timeout: 5000 });
    assert.equal(await entryCount(NOTE), 2);
    assert.equal((await files()).length, 3);
  });

  await check('low confidence prompts; a number key picks the block', async () => {
    await select('third');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('unsure about this');
    await page.keyboard.press('Control+Enter');
    await page.locator('selectiophile-ui .panel', { hasText: 'Jev 不太确定' }).waitFor({ timeout: 5000 });
    if (shots) await page.screenshot({ path: join(shots, '4-confirm-block.png') });
    assert.match(await page.locator('selectiophile-ui .panel .list button').first().innerText(), /Main Findings[\s\S]*55%/);
    assert.equal(await toast().count(), 0, 'an old toast must not sit under the prompt');
    await page.keyboard.press('2');
    await toast().filter({ hasText: 'Novelty' }).waitFor({ timeout: 5000 });
    const md = await read(NOTE);
    assert.ok(md.slice(md.indexOf('## Novelty'), md.indexOf('# Shortcomings')).includes('Our model generalizes'));
    assert.equal(await page.locator('selectiophile-ui .panel').count(), 0);
  });

  await check('cancelling a prompt writes nothing and removes the highlight', async () => {
    await select('dup1');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('unsure again');
    await page.keyboard.press('Control+Enter');
    await page.locator('selectiophile-ui .panel', { hasText: 'Jev 不太确定' }).waitFor({ timeout: 5000 });
    const before = await entryCount(NOTE);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await entryCount(NOTE), before);
    assert.ok(!(await highlightTexts()).some((t) => t.includes('We repeat')));
  });

  await check('Jev failure (451) falls back to a manual pick and still saves', async () => {
    await select('dup1');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('region block');
    await page.keyboard.press('Control+Enter');
    await page.locator('selectiophile-ui .panel', { hasText: '451' }).waitFor({ timeout: 5000 });
    assert.equal(await page.locator('selectiophile-ui .panel .list button').count(), 8);
    await panelButton('Others').click();
    await toast().filter({ hasText: 'Others' }).waitFor({ timeout: 5000 });
  });

  await check('the second copy of a repeated sentence restores in the right place', async () => {
    const count = await entryCount(NOTE);
    await select('dup2');
    await page.keyboard.press('Alt+KeyS');
    await waitForEntries(NOTE, count + 1);
    await page.waitForTimeout(200);
    await page.reload();
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.waitForFunction(() => window.__lpRanges().length >= 5, null, { timeout: 5000 });
    const owners = await page.evaluate(() => window.__lpRanges().map((r) => r.startContainer.parentElement.id));
    assert.ok(owners.includes('dup1') && owners.includes('dup2'), `owners: ${owners}`);
  });

  await check('after reload the floating icon names the note', async () => {
    assert.match(await page.locator('selectiophile-ui .fab').getAttribute('title'), /Vaswani\(2017\)/);
    if (shots) await page.screenshot({ path: join(shots, '5-reload-fab.png') });
  });

  await check('formulas are written as $tex$', async () => {
    const count = await entryCount(NOTE);
    await selectAll('math');
    await page.keyboard.press('Alt+KeyS');
    await waitForEntries(NOTE, count + 1);
    assert.ok((await read(NOTE)).includes('The energy is $E=mc^{2}$ in this frame.'));
  });

  await check('undo removes the entry and its highlight', async () => {
    const before = await entryCount(NOTE);
    await toast().locator('button', { hasText: '撤销' }).click();
    await toast().filter({ hasText: '已撤销' }).waitFor({ timeout: 5000 });
    assert.equal(await entryCount(NOTE), before - 1);
    assert.ok(!(await read(NOTE)).includes('E=mc'));
    assert.ok(!(await highlightTexts()).some((t) => t.includes('energy')));
  });

  await check('change position moves the entry to the chosen block', async () => {
    await selectAll('math');
    await page.keyboard.press('Alt+KeyS');
    await toast().filter({ hasText: '已存入' }).waitFor({ timeout: 5000 });
    await toast().locator('button', { hasText: '改位置' }).click();
    await page.locator('selectiophile-ui .panel', { hasText: '改到哪篇笔记' }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, '6-move-note.png') });
    await page.locator('selectiophile-ui .panel .list button').first().click();
    await page.locator('selectiophile-ui .panel', { hasText: '移到哪个内容块' }).waitFor();
    await panelButton('Potential Follow-up Experiments').click();
    await toast().filter({ hasText: 'Potential Follow-up' }).waitFor({ timeout: 5000 });
    const md = await read(NOTE);
    assert.ok(md.slice(md.indexOf('## Potential Follow-up'), md.indexOf('# Others')).includes('$E=mc^{2}$'));
    assert.ok(!md.slice(md.indexOf('## Main Findings'), md.indexOf('## Novelty')).includes('E=mc'));
  });

  await check('ordinary page: an unsure Jev leads to a prompt', async () => {
    await open('/blog');
    await select('post');
    await page.keyboard.press('Alt+KeyS');
    await page.locator('selectiophile-ui .panel', { hasText: '存到哪篇笔记' }).waitFor({ timeout: 5000 });
    assert.equal(await page.locator('selectiophile-ui .panel', { hasText: 'Jev 不可用' }).count(), 0);
    assert.equal(await page.locator('selectiophile-ui .panel input').nth(1).inputValue(), 'A Blog About Models');
    if (shots) await page.screenshot({ path: join(shots, '7-confirm-note.png') });
  });

  await check('choosing an existing note for that page binds it', async () => {
    await page.locator('selectiophile-ui .panel .list button').first().click();
    await toast().filter({ hasText: 'Vaswani' }).waitFor({ timeout: 5000 });
    await select('post');
    await page.keyboard.press('Alt+KeyS');
    await page.waitForTimeout(800);
    assert.equal(await page.locator('selectiophile-ui .panel', { hasText: '存到哪篇笔记' }).count(), 0, 'second save should not ask for a note');
  });

  await check('the floating pin expands a note list, and its color shows the state', async () => {
    const fab = page.locator('selectiophile-ui .fab');
    assert.equal(await fab.locator('svg').count(), 1);
    assert.equal((await fab.innerText()).trim(), '', 'an icon with no text');
    assert.equal(await page.locator('selectiophile-ui .fab.on').count(), 0);
    const unpinned = await fab.evaluate((n) => getComputedStyle(n).backgroundColor);
    await fab.click();
    const list = page.locator('selectiophile-ui .panel');
    await list.waitFor({ timeout: 4000 });
    if (shots) await page.screenshot({ path: join(shots, '25-fab-open.png') });
    await list.locator('.list button').first().click();
    await page.locator('selectiophile-ui .fab.on').waitFor({ timeout: 4000 });
    assert.equal(await list.count(), 0, 'collapses back to the icon');
    assert.notEqual(await fab.evaluate((n) => getComputedStyle(n).backgroundColor), unpinned);
    const box = await fab.boundingBox();
    assert.equal(Math.round(box.width), Math.round(box.height), 'stays round');
    if (shots) await page.screenshot({ path: join(shots, '26-fab-pinned.png') });
    const { settings } = await admin.evaluate(() => chrome.storage.local.get('settings'));
    assert.equal(settings.pinned, NOTE_NAME);

    await fab.click();
    await list.locator('button', { hasText: '取消钉住' }).click();
    await page.locator('selectiophile-ui .fab.on').waitFor({ state: 'detached', timeout: 4000 });
  });

  await check('clicking the icon again or elsewhere closes the list', async () => {
    const fab = page.locator('selectiophile-ui .fab');
    const list = page.locator('selectiophile-ui .panel');
    await fab.click();
    await list.waitFor({ timeout: 4000 });
    await fab.click();
    await list.waitFor({ state: 'detached', timeout: 2000 });
    await fab.click();
    await list.waitFor({ timeout: 4000 });
    await page.mouse.click(100, 700);
    await list.waitFor({ state: 'detached', timeout: 2000 });
  });

  await check('the floating icon drags without opening, and its place is kept', async () => {
    const fab = page.locator('selectiophile-ui .fab');
    const from = await fab.boundingBox();
    await page.mouse.move(from.x + 15, from.y + 15);
    await page.mouse.down();
    await page.mouse.move(from.x - 100, from.y - 100, { steps: 4 });
    await page.mouse.move(300, 200, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const to = await fab.boundingBox();
    assert.ok(Math.abs(to.x - 285) < 4 && Math.abs(to.y - 185) < 4, `moved to ${to.x},${to.y}`);
    assert.equal(await page.locator('selectiophile-ui .panel').count(), 0, 'a drag is not a click');
    await page.reload();
    await fab.waitFor({ timeout: 5000 });
    const kept = await fab.boundingBox();
    assert.ok(Math.abs(kept.x - to.x) < 2 && Math.abs(kept.y - to.y) < 2, 'kept after a reload');

    // Dragged off the page, it stays reachable.
    await page.mouse.move(kept.x + 15, kept.y + 15);
    await page.mouse.down();
    await page.mouse.move(5000, 5000, { steps: 3 });
    await page.mouse.up();
    const edge = await fab.boundingBox();
    assert.ok(edge.x + edge.width <= 1100 && edge.y + edge.height <= 760, 'stays on screen');
    await admin.evaluate(() => chrome.storage.local.remove('fabPos'));
    await page.reload();
    await fab.waitFor({ timeout: 5000 });
  });

  // No request reaches the real site: this route answers all of chatgpt.com.
  await context.route('https://chatgpt.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: CHAT }));
  const SECOND = 'Hopper(2020)-Second Paper Other Things.md';
  const anyNote = async (text) => {
    for (const name of await files()) if (name.endsWith('.md') && (await read(name)).includes(text)) return name;
    return null;
  };
  const waitForText = async (name, text) => {
    for (let i = 0; i < 50; i++) {
      if (((await read(name)) || '').includes(text)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`"${text}" never appeared in ${name}`);
  };

  await check('discussion goes to the most recent note, labelled as chat', async () => {
    await open('/second');
    await select('s2');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(SECOND, 'The second paper reports');
    await open('/paper');
    await select('fresh1');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(NOTE, 'A fresh sentence for recency');
    // Saving on the first paper makes it the most recent note.
    await page.goto('https://chatgpt.com/c/one');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('c1');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('idea from chat');
    await page.keyboard.press('Control+Enter');
    await toast().filter({ hasText: '讨论已存入最近一篇' }).waitFor({ timeout: 5000 });
    assert.match(await toast().innerText(), /Ideas for My Research/);
    if (shots) await page.screenshot({ path: join(shots, '10-discussion-saved.png') });
    const md = await read(NOTE);
    const chatLine = md.split('\n').find((l) => l.includes('>GPT</a>'));
    assert.ok(chatLine.includes('href="https://chatgpt.com/c/one"'));
    assert.ok(!chatLine.includes(':~:text'));
    const { bindings } = await admin.evaluate(() => chrome.storage.local.get('bindings'));
    assert.ok(!Object.keys(bindings).some((k) => k.includes('chatgpt')));
    const last = await sw.evaluate(() => globalThis.__jevRequests.at(-1));
    assert.equal(last.state.source_title, 'Attention Is All You Need');
    assert.match(last.state.source, /AI assistant/);
    assert.equal(last.state.page_section, undefined);
  });

  await check('a page re-render keeps the highlight', async () => {
    assert.ok((await highlightTexts()).some((t) => t.includes('Attention lets')));
    await page.evaluate(() => window.rerender());
    await page.waitForFunction(() => window.__lpRanges().some((r) => r.startContainer.isConnected && r.toString().includes('Attention lets')), null, { timeout: 4000 });
  });

  await check('switching chats without a reload swaps highlights', async () => {
    await page.evaluate(() => window.switchChat('/c/two', 'A completely different conversation.'));
    await page.waitForFunction(() => window.__lpRanges().length === 0, null, { timeout: 4000 });
    await page.evaluate(() => window.switchChat('/c/one', 'Attention lets the model weigh every input token against the others.'));
    await page.waitForFunction(() => window.__lpRanges().some((r) => r.toString().includes('Attention lets')), null, { timeout: 4000 });
  });

  await check('a discussion entry moved to another paper pulls later ones along', async () => {
    const paperBinding = async () => (await admin.evaluate(() => chrome.storage.local.get('bindings'))).bindings['doi:10.1000/attention'];
    assert.equal(await paperBinding(), NOTE);
    await page.locator('#c2').waitFor({ state: 'attached', timeout: 100 }).catch(() => {});
    await page.evaluate(() => window.switchChat('/c/one', 'Attention lets the model weigh every input token against the others. Another sentence here.'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const t = document.getElementById('c1').firstChild;
      const r = document.createRange();
      r.setStart(t, t.data.indexOf('Another'));
      r.setEnd(t, t.data.length);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press('Alt+KeyS');
    await waitForText(NOTE, 'Another sentence here');
    // The file is written just before the toast, and an older toast may still be up.
    await page.waitForTimeout(400);
    await toast().locator('button', { hasText: '改位置' }).click();
    await page.locator('selectiophile-ui .panel', { hasText: '改到哪篇笔记' }).waitFor();
    await panelButton('Hopper').click();
    await page.locator('selectiophile-ui .panel', { hasText: '移到哪个内容块' }).waitFor();
    await panelButton('Others').click();
    await waitForText(SECOND, 'Another sentence here');
    // A move writes the target first and then clears the source, so a failure in
    // between cannot lose the entry. Give the second step time to finish.
    for (let i = 0; i < 50 && (await read(NOTE)).includes('Another sentence here'); i++) await page.waitForTimeout(100);
    assert.equal((await read(NOTE)).includes('Another sentence here'), false);
    assert.equal(await paperBinding(), NOTE, 'the paper page stays bound to its own note');
    await page.evaluate(() => { history.pushState({}, '', '/c/three'); document.getElementById('thread').innerHTML = '<p id="c9">A later chat sentence about the second paper.</p>'; });
    await page.waitForTimeout(1200);
    await select('c9');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(SECOND, 'A later chat sentence');
  });

  await check('clicking a highlight opens a card; deleting takes two clicks', async () => {
    await open('/paper');
    await page.waitForFunction(() => window.__lpRanges().length >= 3, null, { timeout: 5000 });
    const count = await entryCount(NOTE);
    const box = await page.evaluate(() => {
      const r = window.__lpRanges().find((x) => x.toString().includes('Training took')).getClientRects()[0];
      return { x: r.left + 40, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    const card = page.locator('selectiophile-ui .card');
    await card.waitFor({ timeout: 4000 });
    assert.match(await card.innerText(), /Vaswani\(2017\)[\s\S]*Main Findings/);
    if (shots) await page.screenshot({ path: join(shots, '11-card.png') });
    await card.locator('button', { hasText: '删除' }).click();
    assert.equal(await entryCount(NOTE), count, 'first click only arms the button');
    await card.locator('button', { hasText: '确认删除' }).click();
    await toast().filter({ hasText: '已删除划线' }).waitFor({ timeout: 4000 });
    assert.equal(await entryCount(NOTE), count - 1);
    assert.ok(!(await read(NOTE)).includes('Training took far less'));
    assert.ok(!(await highlightTexts()).some((t) => t.includes('Training took')));
    await page.reload();
    await page.waitForTimeout(800);
    assert.ok(!(await highlightTexts()).some((t) => t.includes('Training took')), 'stays gone after reload');
  });

  await check('clicking elsewhere closes the card; plain text opens nothing', async () => {
    const box = await page.evaluate(() => {
      const r = window.__lpRanges()[0].getClientRects()[0];
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.locator('selectiophile-ui .card').waitFor({ timeout: 4000 });
    await page.mouse.click(1000, 700);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('selectiophile-ui .card').count(), 0);
  });

  await check('an entry deleted in Obsidian: the card says so and clears the highlight', async () => {
    const target = await page.evaluate(() => {
      const range = window.__lpRanges().find((x) => x.toString().includes('Our model'));
      const r = range.getClientRects()[0];
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await admin.evaluate(async (name) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const handle = await dir.getFileHandle(name);
      const text = await (await handle.getFile()).text();
      const cleaned = text.replace(/\n> <span [^\n]*Our model[^\n]*\n/, '\n');
      if (cleaned === text) throw new Error('entry not found');
      const w = await handle.createWritable();
      await w.write(cleaned);
      await w.close();
    }, NOTE);
    await page.mouse.click(target.x, target.y);
    const card = page.locator('selectiophile-ui .card', { hasText: '笔记里已没有这条划线' });
    await card.waitFor({ timeout: 4000 });
    await card.locator('button', { hasText: '清除高亮' }).click();
    await toast().filter({ hasText: '已清除高亮' }).waitFor({ timeout: 4000 });
    assert.ok(!(await highlightTexts()).some((t) => t.includes('Our model')));
  });

  await check('pinning from the popup shows PIN and updates the page; unpinning clears it', async () => {
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('/paper'))?.id);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.locator('#pinRow').waitFor({ timeout: 4000 });
    assert.equal(await popup.locator('select').count(), 0, 'no native dropdown');
    await popup.locator('#pinCurrent').click();
    await popup.locator('#pinList button', { hasText: 'Hopper' }).waitFor({ timeout: 4000 });
    if (shots) {
      await popup.setViewportSize({ width: 344, height: 560 });
      await popup.screenshot({ path: join(shots, '20-popup-picker.png') });
    }
    await popup.locator('#pinList button', { hasText: 'Hopper' }).click();
    await popup.locator('#pinList').waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(await popup.locator('#recent li').count(), 1, 'only the latest entry');
    assert.equal(await popup.getByText('包括其他论文页面').count(), 0);
    await popup.locator('#pin').click();
    await popup.locator('#pinned', { hasText: 'Hopper' }).waitFor({ timeout: 4000 });
    await popup.locator('#pinRow').waitFor({ state: 'hidden', timeout: 4000 });
    if (shots) {
      await popup.setViewportSize({ width: 360, height: 300 });
      await popup.screenshot({ path: join(shots, '12-popup-pinned.png') });
    }
    await page.locator('selectiophile-ui .fab.on[title*="Hopper"]').waitFor({ timeout: 4000 });
    await page.waitForTimeout(200);
    assert.equal(await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId), 'PIN');
    const count = await entryCount(SECOND);
    await page.bringToFront();
    await page.waitForTimeout(150);
    await select('fresh2');
    await page.keyboard.press('Alt+KeyS');
    await toast().filter({ hasText: '已存入钉住的笔记' }).waitFor({ timeout: 5000 });
    assert.equal(await entryCount(SECOND), count + 1, 'a pin beats the page\'s own note');
    await popup.bringToFront();
    await popup.reload();
    await popup.locator('#unpin').click();
    await popup.locator('#pinRow').waitFor({ timeout: 4000 });
    await popup.locator('#pinnedRow').waitFor({ state: 'hidden', timeout: 4000 });
    await popup.close();
    await page.waitForTimeout(300);
    assert.equal(await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId), 'ON');
    await page.bringToFront();
    await page.locator('selectiophile-ui .fab:not(.on)[title*="Vaswani"]').waitFor({ timeout: 4000 });
  });

  await check('a color dot saves in that color; the note and page agree', async () => {
    await open('/paper');
    await page.waitForFunction(() => window.__lpRanges().length >= 3, null, { timeout: 5000 });
    const count = await entryCount(NOTE);
    await select('color1');
    await page.locator('selectiophile-ui .toolbar .dot-btn[title^="方法"]').waitFor({ timeout: 4000 });
    if (shots) await page.screenshot({ path: join(shots, '15-color-toolbar.png') });
    await page.locator('selectiophile-ui .toolbar .dot-btn[title^="方法"]').click();
    await waitForEntries(NOTE, count + 1);
    assert.equal(await page.evaluate(() => window.__lpColorOf('Color one')), 'selectiophile-blue');
    const line = (await read(NOTE)).split('\n').find((l) => l.includes('Color one'));
    assert.match(line, /^> <span style="color:#7ea6d4">■<\/span> Color one sentence goes here\. <sup>方法 · <a /);
  });

  await check('Alt+S reuses the last color, and the comment box can change it', async () => {
    const count = await entryCount(NOTE);
    await select('color2');
    await page.keyboard.press('Alt+KeyS');
    await waitForEntries(NOTE, count + 1);
    assert.equal(await page.evaluate(() => window.__lpColorOf('Color two')), 'selectiophile-blue');
    await select('color3');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('证据不足');
    // Picked after typing, so the shortcut has to work with the color just clicked.
    await page.locator('selectiophile-ui .swatch', { hasText: '质疑' }).click();
    if (shots) await page.screenshot({ path: join(shots, '16-color-comment.png') });
    await page.keyboard.press('Control+Enter');
    await waitForText(NOTE, '- **Comments：** 证据不足');
    assert.equal(await page.evaluate(() => window.__lpColorOf('Color three')), 'selectiophile-red');
    assert.match((await read(NOTE)).split('\n').find((l) => l.includes('Color three')), /color:#df8f8f.*<sup>质疑 · <a /);
  });

  await check('renaming a color in settings reaches the toolbar; old entries keep their name', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const input = admin.locator('input[data-color="green"]');
    assert.equal(await input.inputValue(), '结论');
    await input.fill('主要发现');
    await input.blur();
    await admin.locator('#colorOut', { hasText: '绿色已保存' }).waitFor({ timeout: 4000 });
    if (shots) await admin.screenshot({ path: join(shots, '17-color-settings.png'), fullPage: true });
    await page.bringToFront();
    await page.waitForTimeout(400);
    const count = await entryCount(NOTE);
    await select('color4');
    const dot = page.locator('selectiophile-ui .toolbar .dot-btn[title^="主要发现"]');
    await dot.waitFor({ timeout: 4000 });
    await dot.click();
    await waitForEntries(NOTE, count + 1);
    assert.ok((await read(NOTE)).includes('<sup>主要发现 · <a '));
    assert.ok((await read(NOTE)).includes('<sup>方法 · <a '), 'older entries are unchanged');
  });

  await check('recoloring from the card updates the page and the note', async () => {
    const box = await page.evaluate(() => {
      const r = window.__lpRanges().find((x) => x.toString().includes('Color one')).getClientRects()[0];
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    const card = page.locator('selectiophile-ui .card');
    await card.waitFor({ timeout: 4000 });
    assert.equal(await card.locator('.swatch.on').innerText(), '方法');
    if (shots) await page.screenshot({ path: join(shots, '18-color-card.png') });
    await card.locator('.swatch', { hasText: '待查' }).click();
    await card.locator('.swatch.on', { hasText: '待查' }).waitFor({ timeout: 4000 });
    assert.match((await read(NOTE)).split('\n').find((l) => l.includes('Color one')), /color:#e8a566.*<sup>待查 · <a /);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForFunction(() => window.__lpRanges().length >= 3, null, { timeout: 5000 });
    await page.waitForFunction(() => window.__lpColorOf('Color one') === 'selectiophile-orange', null, { timeout: 4000 });
  });

  await check('double-clicking highlighted text selects it instead of opening the card', async () => {
    const box = await page.evaluate(() => {
      const r = window.__lpRanges().find((x) => x.toString().includes('Color two')).getClientRects()[0];
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.dblclick(box.x, box.y);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('selectiophile-ui .card').count(), 0);
    assert.ok((await page.evaluate(() => window.getSelection().toString())).trim().length > 0);
    await page.mouse.click(1000, 700);
  });

  await check('switching theme reaches the page and settings', async () => {
    const lp = page.locator('selectiophile-ui .lp');
    assert.equal(await lp.getAttribute('data-theme'), 'dusk');
    await admin.bringToFront();
    await admin.locator('button.theme[data-theme="lagoon"]').click();
    await admin.locator('button.theme[data-theme="lagoon"][aria-pressed="true"]').waitFor({ timeout: 4000 });
    assert.equal(await admin.evaluate(() => document.documentElement.dataset.theme), 'lagoon');
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('selectiophile-ui').shadowRoot.querySelector('.lp').dataset.theme === 'lagoon', null, { timeout: 4000 });
    await select('third');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('绿色主题下的评论');
    if (shots) await page.screenshot({ path: join(shots, '13-lagoon-comment.png') });
    await page.keyboard.press('Escape');
    if (shots) {
      await admin.bringToFront();
      await admin.screenshot({ path: join(shots, '14-options-lagoon.png') });
    }
    await admin.locator('button.theme[data-theme="dusk"]').click();
    await admin.locator('button.theme[data-theme="dusk"][aria-pressed="true"]').waitFor({ timeout: 4000 });
    await page.bringToFront();
  });

  await check('backup: export leaves out the key, restore brings highlights and colors back', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const [download] = await Promise.all([admin.waitForEvent('download'), admin.locator('#exportData').click()]);
    assert.match(download.suggestedFilename(), /^selectiophile-backup-\d{4}-\d\d-\d\d\.json$/);
    const text = await readFile(await download.path(), 'utf8');
    assert.ok(!text.includes('fake-key'), 'no Jev key in the file');
    const backup = JSON.parse(text);
    const key = `hl:${origin}/paper`;
    const original = backup.data[key];
    assert.ok(Object.values(original).some((h) => h.color === 'orange' && h.anchor.includes('Colorone')));

    // A fresh install: everything but the folder and key is gone.
    await admin.evaluate(async () => {
      const keep = ['jevKey', 'sites', 'lang'];
      await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter((k) => !keep.includes(k)));
    });
    await page.bringToFront();
    await page.reload();
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__lpRanges().length), 0);

    await admin.bringToFront();
    await admin.locator('#importFile').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
    await admin.locator('#backupOut.bad', { hasText: '不是 Selectiophile' }).waitFor({ timeout: 4000 });
    await admin.locator('#importFile').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
    await admin.locator('#backupOut', { hasText: '已恢复' }).waitFor({ timeout: 4000 });
    if (shots) await admin.screenshot({ path: join(shots, '19-backup.png'), fullPage: true });
    const restored = await admin.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(restored[key], original);
    assert.equal(restored.colors.green, '主要发现');
    assert.equal(restored.jevKey, 'fake-key', 'the local key is untouched');

    await page.bringToFront();
    await page.reload();
    await page.waitForFunction(() => window.__lpColorOf('Color one') === 'selectiophile-orange', null, { timeout: 5000 });
    const count = await entryCount(NOTE);
    const box = await page.evaluate(() => {
      const r = window.__lpRanges().find((x) => x.toString().includes('Color one')).getClientRects()[0];
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    const card = page.locator('selectiophile-ui .card');
    await card.waitFor({ timeout: 4000 });
    assert.equal(await card.locator('.swatch.on').innerText(), '待查');
    await page.keyboard.press('Escape');
    assert.equal(await entryCount(NOTE), count);
  });

  await check('re-selecting highlighted text edits that highlight instead of duplicating it', async () => {
    await open('/paper');
    await page.waitForFunction(() => window.__lpRanges().some((r) => r.toString().includes('Color four')), null, { timeout: 5000 });
    const count = await entryCount(NOTE);
    const copies = () => page.evaluate(() => window.__lpRanges().filter((r) => r.toString().includes('Color four')).length);
    assert.equal(await copies(), 1);
    await select('color4');
    await page.locator('selectiophile-ui .toolbar').waitFor({ timeout: 4000 });
    assert.equal(await page.locator('selectiophile-ui .toolbar .dot-btn.on').getAttribute('title'), '主要发现 · 绿色', 'shows the current color');
    await page.keyboard.press('Alt+KeyC');
    const box = page.locator('selectiophile-ui textarea');
    await box.waitFor({ timeout: 4000 });
    assert.equal(await box.inputValue(), '');
    await box.fill('后来补的评论');
    if (shots) await page.screenshot({ path: join(shots, '21-add-comment.png') });
    await page.keyboard.press('Control+Enter');
    await waitForText(NOTE, '- **Comments：** 后来补的评论');
    assert.equal(await entryCount(NOTE), count, 'still one entry');
    assert.equal(await copies(), 1, 'still one highlight');

    await select('color4');
    await page.locator('selectiophile-ui .toolbar .dot-btn[title^="灵感"]').click();
    await toast().filter({ hasText: '已改成' }).waitFor({ timeout: 4000 });
    assert.equal(await entryCount(NOTE), count);
    assert.equal(await page.evaluate(() => window.__lpColorOf('Color four')), 'selectiophile-purple');
    const line = (await read(NOTE)).split('\n').find((l) => l.includes('Color four'));
    assert.ok(line.includes('<span style="color:#a993d6">■</span>'), line);
    assert.match(line, /<sup>灵感 · <a /);
  });

  await check('a comment can be changed from the card, and removed by emptying it', async () => {
    const point = () => page.evaluate(() => {
      const r = window.__lpRanges().find((x) => x.toString().includes('Color four')).getClientRects()[0];
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    let { x, y } = await point();
    await page.mouse.click(x, y);
    const card = page.locator('selectiophile-ui .card');
    await card.waitFor({ timeout: 4000 });
    assert.match(await card.locator('.comment-text').innerText(), /后来补的评论/);
    if (shots) await page.screenshot({ path: join(shots, '22-card-comment.png') });
    await card.locator('button', { hasText: '改评论' }).click();
    const box = page.locator('selectiophile-ui textarea');
    await box.waitFor({ timeout: 4000 });
    assert.equal(await box.inputValue(), '后来补的评论');
    await box.fill('改过的评论\n第二行');
    await page.keyboard.press('Control+Enter');
    await waitForText(NOTE, '- **Comments：** 改过的评论\n  第二行');
    assert.ok(!(await read(NOTE)).includes('后来补的评论'));
    await toast().filter({ hasText: '评论已保存' }).waitFor({ timeout: 4000 });

    ({ x, y } = await point());
    await page.mouse.click(x, y);
    await card.locator('button', { hasText: '改评论' }).click();
    await box.fill('');
    await page.keyboard.press('Control+Enter');
    await toast().filter({ hasText: '评论已删除' }).waitFor({ timeout: 4000 });
    assert.ok(!(await read(NOTE)).includes('改过的评论'));
    ({ x, y } = await point());
    await page.mouse.click(x, y);
    await card.locator('button', { hasText: '加评论' }).waitFor({ timeout: 4000 });
    await page.keyboard.press('Escape');
  });

  await check('the saved toast offers a comment right away', async () => {
    const count = await entryCount(NOTE);
    await select('second');
    await page.keyboard.press('Alt+KeyS');
    await waitForEntries(NOTE, count + 1);
    await toast().locator('button', { hasText: '评论' }).click();
    const box = page.locator('selectiophile-ui textarea');
    await box.waitFor({ timeout: 4000 });
    await box.fill('忘了写，现在补上');
    await page.keyboard.press('Control+Enter');
    await waitForText(NOTE, '- **Comments：** 忘了写，现在补上');
  });

  await check('toolbar style: Lite hides the label, Standard brings it back', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('#toolbarSeg button[data-style="lite"]').click();
    await admin.locator('#toolbarSeg button[data-style="lite"].on').waitFor({ timeout: 4000 });
    await page.bringToFront();
    await page.waitForTimeout(200);
    await select('dup1');
    const label = page.locator('selectiophile-ui .toolbar .label');
    await page.locator('selectiophile-ui .toolbar.lite').waitFor({ timeout: 4000 });
    assert.equal(await label.isVisible(), false);
    if (shots) await page.screenshot({ path: join(shots, '23-toolbar-lite.png') });
    await page.mouse.click(1000, 700);
    await admin.bringToFront();
    await admin.locator('#toolbarSeg button[data-style="standard"]').click();
    await admin.locator('#toolbarSeg button[data-style="standard"].on').waitFor({ timeout: 4000 });
    await page.bringToFront();
    await page.waitForTimeout(200);
    await select('dup1');
    await page.locator('selectiophile-ui .toolbar:not(.lite)').waitFor({ timeout: 4000 });
    assert.equal(await label.isVisible(), true);
    await page.mouse.click(1000, 700);
  });

  await check('Jev can place a discussion in the note it is about', async () => {
    await page.goto('https://chatgpt.com/c/about-second');
    await page.locator('selectiophile-ui').waitFor({ state: 'attached', timeout: 5000 });
    await page.evaluate(() => { document.getElementById('thread').innerHTML = '<div data-message-author-role="user">Please explain Second Paper On Other Things.</div><div data-message-author-role="assistant">It studies load.</div><div data-message-author-role="user">Later question.</div><div data-message-author-role="assistant">Round two.</div><div data-message-author-role="user">Round three is not read.</div><p id="c7">Its key claim holds under load.</p>'; });
    await page.waitForTimeout(100);
    await select('c7');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(SECOND, 'Its key claim holds under load');
    await toast().filter({ hasText: 'Jev 判断' }).waitFor({ timeout: 4000 });
    const asked = await sw.evaluate(() => globalThis.__jevRequests.filter((r) => r.questions.note).at(-1));
    assert.match(asked.state.conversation_opening, /Second Paper On Other Things/);
    assert.match(asked.state.conversation_opening, /Round two/);
    assert.ok(!asked.state.conversation_opening.includes('Round three'), 'only the first rounds, default 2');
    assert.ok(Object.keys(asked.questions.note.criteria).length >= 2);

    const judged = await sw.evaluate(() => globalThis.__jevRequests.filter((r) => r.questions.note).length);
    await page.evaluate(() => { document.getElementById('thread').insertAdjacentHTML('beforeend', '<p id="c8">Another claim from later on.</p>'); });
    await select('c8');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(SECOND, 'Another claim from later on');
    await toast().filter({ hasText: '关联的笔记' }).waitFor({ timeout: 4000 });
    assert.equal(await sw.evaluate(() => globalThis.__jevRequests.filter((r) => r.questions.note).length), judged, 'the conversation is not judged twice');
    const later = await sw.evaluate(() => globalThis.__jevRequests.at(-1));
    assert.ok(!JSON.stringify(later).includes('Round two'), 'and its text is not sent again');
  });

  await check('blacklist mode runs everywhere but the listed site, without a reload', async () => {
    await open('/paper');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await admin.evaluate(() => chrome.storage.local.set({ siteMode: 'blacklist', blockedSites: ['127.0.0.1'] }));
    await page.locator('selectiophile-ui .fab').waitFor({ state: 'detached', timeout: 4000 });
    await page.waitForFunction(() => window.__lpRanges().length === 0, null, { timeout: 4000 });
    await select('find');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('selectiophile-ui .toolbar').count(), 0);
    await page.reload();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('selectiophile-ui').count(), 0, 'not injected on reload');

    const other = await context.newPage();
    await other.goto('https://chatgpt.com/c/blacklist');
    await other.locator('selectiophile-ui').waitFor({ state: 'attached', timeout: 5000 });
    await other.close();
  });

  await check('settings switch modes; all-sites mode runs there too; whitelist restores', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('#modeSeg button[data-mode="blacklist"].on').waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#sites li').count(), 1);
    assert.match(await admin.locator('#sites li').innerText(), /127\.0\.0\.1/);
    if (shots) await admin.screenshot({ path: join(shots, '24-mode-blacklist.png'), clip: { x: 240, y: 480, width: 860, height: 280 } });
    await admin.locator('#modeSeg button[data-mode="all"]').click();
    await admin.locator('#modeSeg button[data-mode="all"].on').waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#siteEditor').isVisible(), false);
    await page.bringToFront();
    await page.reload();
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await admin.bringToFront();
    await admin.locator('#modeSeg button[data-mode="whitelist"]').click();
    await admin.locator('#modeSeg button[data-mode="whitelist"].on').waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#siteEditor').isVisible(), true);
    await page.bringToFront();
    await page.waitForTimeout(300);
  });

  await check('the popup adds the current site to the list for the mode', async () => {
    await admin.evaluate(() => chrome.storage.local.set({ siteMode: 'blacklist', blockedSites: [] }));
    await page.bringToFront();
    await page.goto(`${origin}/paper`);
    await page.waitForTimeout(300);
    const popup = await context.newPage();
    await popup.addInitScript(() => {
      // The popup asks for "the active tab"; here it is a separate page, so point it at the paper.
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => (await query({})).filter((t) => t.url?.includes('/paper')).slice(0, 1);
    });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    const button = popup.locator('#toggleSite');
    await button.filter({ hasText: '加入黑名单' }).waitFor({ timeout: 4000 });
    await button.click();
    await button.filter({ hasText: '移出黑名单' }).waitFor({ timeout: 4000 });
    assert.deepEqual((await popup.evaluate(() => chrome.storage.local.get('blockedSites'))).blockedSites, ['127.0.0.1']);
    await button.click();
    await button.filter({ hasText: '加入黑名单' }).waitFor({ timeout: 4000 });
    await popup.evaluate(() => chrome.storage.local.set({ siteMode: 'whitelist', blockedSites: [] }));
    await popup.reload();
    await button.filter({ hasText: '移出白名单' }).waitFor({ timeout: 4000 });
    await popup.close();
    await page.bringToFront();
  });

  await check('a bundled config fills the note, with no template in the vault', async () => {
    await context.route('https://www.mdpi.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: MDPI }));
    await admin.evaluate(async () => {
      const { sites } = await chrome.storage.local.get('sites');
      await chrome.storage.local.set({ sites: [...sites, '*.mdpi.com'] });
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      await dir.removeEntry('Reading Template.md');
    });
    await page.goto('https://www.mdpi.com/1422-0067/25/5/3071');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('m1');
    await page.keyboard.press('Alt+KeyS');
    const name = 'Zhang(2024)-Deep Learning for.md';
    await waitForText(name, 'Proteins fold quickly');
    const md = await read(name);
    assert.ok(md.startsWith('---\ntitle: "Zhang(2024)-Deep Learning for"\n'), md.slice(0, 120));
    assert.ok(md.includes('authors: ["[[Wei Zhang]]", "[[Ming Li]]"]\n'));
    assert.ok(md.includes('journal: "Int. J. Mol. Sci."\n'));
    assert.ok(md.includes('published: 2024-03-05\n'));
    assert.ok(md.includes('doi: "10.3390/ijms25053071"\n'));
    assert.ok(md.includes('paper_id: "25053071"\n'));
    assert.ok(md.includes('keywords: ["proteins", "folding"]\n'));
    assert.ok(!md.includes('collection:') && !md.includes('source:'), 'no duplicate fields');
    assert.match(md, /url: "https:\/\/www\.mdpi\.com\/1422-0067\/25\/5\/3071"\n/);
    assert.deepEqual(md.split('\n---')[0].split('\n').slice(1).map((l) => l.split(':')[0]),
      ['title', 'authors', 'journal', 'published', 'doi', 'paper_id', 'url', 'keywords', 'created', 'last_annotated'], 'ordered by content');
    assert.match(md, /last_annotated: \d{4}-\d\d-\d\dT\d\d:\d\d\n/);
    assert.ok(md.includes('# Summary'), 'made from the bundled template');
    assert.ok(!(await files()).includes('Reading Template.md'), 'no template in the vault');

    await select('m2');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(name, 'They also misfold');
    assert.equal((await files()).filter((f) => f.startsWith('Zhang(2024)')).length, 1, 'the next highlight finds the same note');
  });

  await check('a Nature paper clips its original from the saved notice, and the note links it', async () => {
    await context.route('https://www.nature.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: NATURE }));
    await admin.evaluate(async () => {
      const { sites } = await chrome.storage.local.get('sites');
      await chrome.storage.local.set({ sites: [...sites, '*.nature.com'], docTypes: [{ id: 'paper', autoClip: true, clipPath: '' }] });
    });
    const readPath = (path) => admin.evaluate(async (p) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const parts = p.split('/');
      const name = parts.pop();
      try {
        for (const part of parts) dir = await dir.getDirectoryHandle(part);
        return await (await (await dir.getFileHandle(name)).getFile()).text();
      } catch {
        return null;
      }
    }, path);
    await page.goto('https://www.nature.com/articles/s41586-019-1666-5');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('nmain');
    await page.keyboard.press('Alt+KeyS');
    const note = 'Arute(2019)-Quantum supremacy using.md';
    await waitForText(note, 'Feynman proposed');
    // Papers are clipped when their note is first created.
    const clipButton = toast().locator('button', { hasText: '剪藏原文' });
    await toast().filter({ hasText: '原文已剪藏' }).waitFor({ timeout: 10000 });
    if (shots) await page.screenshot({ path: join(shots, '51-clipped.png') });
    assert.ok(await toast().locator('button', { hasText: '撤销' }).count(), 'the save\'s undo stays');
    assert.equal(await clipButton.count(), 0, 'nothing left to clip');
    assert.match(await toast().innerText(), /已关联到笔记/);
    const ref = 'references/papers/Quantum supremacy using a programmable superconducting processor.md';
    const md = await readPath(ref);
    assert.ok(md, 'clipped under the config\'s path');
    assert.ok(md.startsWith('---\ntitle: "Arute(2019)-Quantum supremacy using"\nsource: "https://www.nature.com/articles/s41586-019-1666-5"\n'), md.slice(0, 200));
    assert.ok(md.includes('collection: "papers"\n') && md.includes('published: 2019-10-23\n'));
    assert.ok(md.includes('## Abstract\n'));
    assert.ok(md.includes('Feynman proposed quantum computers[[#^ref1|¹]],[[#^ref2|²]], as in Fig. [[#^fig1|1]].'), md);
    assert.ok(md.includes('**Fig. 1: The Sycamore processor.** ^fig1'), 'the caption title in bold, as on the page');
    assert.ok(md.includes('![Fig. 1: The Sycamore processor.](https://media.springernature.com/lw685/fig1.png)'));
    assert.ok(md.includes('$$\nF={2}^{n}-1 \\tag{1}\n$$\n\n^eq1'), 'numbered equation');
    assert.ok(md.includes('where $n$ is the number'));
    assert.ok(md.includes('1. Feynman, R. P. Simulating physics with computers. *Int. J. Theor. Phys*. **21**, 467–488 (1982). ^ref1'), 'references as the page lists them');
    assert.ok(!md.includes('Full size image') && !md.includes('⟦'));
    // Checked against the page as clipped: every block of its text, nothing twice.
    assert.match(md, /\nclip_check: "text (\d+)\/\1 blocks, duplicates 0(, formulas \d+\/\d+)?"\n/, md.slice(md.indexOf('clipped:'), md.indexOf('clipped:') + 200));
    assert.ok((await read(note)).includes('references: "[[Quantum supremacy using a programmable superconducting processor]]"\n'));
    assert.ok((await read(note)).includes('\n# References\n\n- [[Quantum supremacy using a programmable superconducting processor]]\n'), 'and under References');

    // The next highlight links the same original and offers nothing more.
    await select('nabs');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(note, 'The promise of quantum');
    await toast().filter({ hasText: '已存入' }).waitFor({ timeout: 5000 });
    // Each entry points, hidden in its link, to the paragraph it came from: the first
    // once the page was clipped, the second as it was saved.
    const linkedNote = await read(note);
    const clipped = await readPath(ref);
    for (const text of ['Feynman proposed', 'The promise of quantum']) {
      const block = clipped.split('\n').find((l) => l.startsWith(text))?.match(/\^([\w-]+)$/)?.[1];
      assert.ok(block && linkedNote.includes(`data-clip="Quantum supremacy using a programmable superconducting processor#^${block}"`), `"${text}" points to its paragraph (${block}): ${linkedNote}`);
    }
    assert.equal(await toast().locator('button', { hasText: '剪藏原文' }).count(), 0);
    assert.equal((await read(note)).match(/\[\[Quantum supremacy using/g).length, 2, 'once in the property, once under References');
    assert.ok(!(await readPath(ref)).includes('data-lp'), 'the original is never taken for a note');

    // The popup offers to clip again. It acts on the active tab, so it's opened as a
    // page and told which tab that is.
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.nature.com/*' }))[0].id);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    const state = await popup.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'clip:status', url: 'https://www.nature.com/articles/s41586-019-1666-5', tabId: id }), tabId);
    assert.equal(state.result.label, 'Quantum supremacy using a programmable superconducting processor');
    const again = await popup.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'clip:run', url: 'https://www.nature.com/articles/s41586-019-1666-5', tabId: id, force: true }), tabId);
    assert.equal(again.result.status, 'updated');
    assert.equal(again.result.linked, 'Arute(2019)-Quantum supremacy using', 'the popup finds the note through the page');
    await popup.close();
    await page.bringToFront();
  });

  await check('without the formula userscript, a clip takes formulas from MathJax and leaves translations out', async () => {
    const mathjax = join(resolve(harness), 'node_modules/mathjax');
    assert.ok(existsSync(mathjax), `install mathjax@3.2.2 in ${harness}`);
    await context.route('https://cdn.jsdelivr.net/npm/mathjax@3/**', (route) => route.fulfill({ path: join(mathjax, new URL(route.request().url()).pathname.replace(/^\/npm\/mathjax@3\//, '')) }));
    await context.route('https://www.science.org/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: SCIENCE }));
    const url = 'https://www.science.org/doi/10.1126/science.adt7185';
    const sci = await context.newPage();
    await sci.goto(url);
    await sci.locator('html[data-ready]').waitFor({ state: 'attached', timeout: 10000 });
    assert.equal(await sci.locator('mjx-assistive-mml').count(), 0, 'no hidden MathML to read');
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.science.org/*' }))[0].id);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    const r = (await popup.evaluate(async (m) => chrome.runtime.sendMessage({ type: 'clip:run', ...m }), { url, tabId })).result;
    await popup.close();
    assert.equal(r.status, 'created', JSON.stringify(r));
    assert.equal(r.warning, null, r.warning);
    const md = await admin.evaluate(async () => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      for (const part of ['references', 'papers']) dir = await dir.getDirectoryHandle(part);
      return (await (await dir.getFileHandle('Discovering molecular modulators with nanoswitch screening.md')).getFile()).text();
    });
    assert.ok(md.includes('title: "Hansen(2026)-Discovering molecular modulators"'), md.slice(0, 300));
    assert.ok(md.includes('The rate is $k = \\alpha^2$ for the switch'), md);
    assert.ok(!md.includes('速率为'), 'the archive holds the original only');
    assert.match(md, /The rate is \$k = \\alpha\^2\$ for the switch.* \^p-[a-z0-9]{6}$/m, 'each paragraph has its block id');
    assert.ok(md.includes('$$\nE = mc^2\n$$'), 'display formula, in the TeX the page was written in');
    assert.ok(md.includes('as shown before ([[#^ref1|1]])') && md.includes('**1.** R. Santos, A map of drug targets.'), md);
    assert.ok(!/^>/m.test(md), 'no quote left by a translation');
    assert.equal(await sci.locator('cfix-end, [data-cfix], [data-latex]').count(), 0, 'the page itself is left as it was');
    await sci.close();
    await page.bringToFront();
  });

  await check('formulas drawn as SVG (MDPI) are clipped, with or without hidden MathML', async () => {
    const mathjax = join(resolve(harness), 'node_modules/mathjax');
    await context.route('https://cdn.jsdelivr.net/npm/mathjax@3/**', (route) => route.fulfill({ path: join(mathjax, new URL(route.request().url()).pathname.replace(/^\/npm\/mathjax@3\//, '')) }));
    for (const hidden of [false, true]) {
      const url = `https://www.mdpi.com/1099-4300/26/3/${hidden ? 2 : 1}`;
      await context.route(url, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: mdpi(hidden) }));
      const tab = await context.newPage();
      await tab.goto(url);
      await tab.locator('html[data-ready]').waitFor({ state: 'attached', timeout: 10000 });
      assert.equal(await tab.locator('mjx-container > svg').count(), 3, 'drawn as SVG');
      assert.equal(await tab.locator('mjx-math').count(), 0);
      assert.equal(await tab.locator('mjx-assistive-mml').count() > 0, hidden);
      const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
      const r = (await popup.evaluate(async (m) => chrome.runtime.sendMessage({ type: 'clip:run', ...m }), { url, tabId })).result;
      await popup.close();
      assert.equal(r.status, 'created', JSON.stringify(r));
      assert.equal(r.warning, null, r.warning);
      const name = `Formulas Drawn as Pictures${hidden ? ' Again' : ''}.md`;
      const md = await admin.evaluate(async (n) => {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
        for (const part of ['references', 'papers']) dir = await dir.getDirectoryHandle(part);
        return (await (await dir.getFileHandle(n)).getFile()).text();
      }, name);
      const body = md.slice(md.indexOf('Introduction'));
      assert.ok(body.includes('The entropy is $H = -\\sum p_i$ in bits.'), body);
      assert.ok(body.includes('$$\nS = k W^2\n$$'), body);
      assert.ok(!body.includes('熵为'), `no translation (${hidden ? 'hidden MathML' : 'from MathJax'}): ${body}`);
      assert.ok(!/<svg|<use|MJX-/.test(body), 'no drawing left');
      await tab.close();
    }
    await page.bringToFront();
  });

  await check('formulas MathJax hasn\'t drawn yet (lazy) are clipped from their TeX', async () => {
    const mathjax = join(resolve(harness), 'node_modules/mathjax');
    await context.route('https://cdn.jsdelivr.net/npm/mathjax@3/**', (route) => route.fulfill({ path: join(mathjax, new URL(route.request().url()).pathname.replace(/^\/npm\/mathjax@3\//, '')) }));
    const url = 'https://www.mdpi.com/1099-4300/26/4/1';
    await context.route(url, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: LAZY }));
    const tab = await context.newPage();
    await tab.goto(url);
    await tab.locator('html[data-ready]').waitFor({ state: 'attached', timeout: 10000 });
    assert.ok(await tab.locator('mjx-container mjx-lazy').count() >= 1, 'some formulas not drawn yet');
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    const r = (await popup.evaluate(async (m) => chrome.runtime.sendMessage({ type: 'clip:run', ...m }), { url, tabId })).result;
    await popup.close();
    assert.equal(r.status, 'created', JSON.stringify(r));
    assert.equal(r.warning, null, r.warning);
    const md = await admin.evaluate(async () => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      for (const part of ['references', 'papers']) dir = await dir.getDirectoryHandle(part);
      return (await (await dir.getFileHandle('Formulas Not Drawn Yet.md')).getFile()).text();
    });
    const body = md.slice(md.indexOf('Introduction'));
    assert.ok(body.includes('Let $x \\in \\mathbb{R}$ be a real number'), `the page's macro is spelled out: ${body}`);
    assert.ok(body.includes('the rate is $\\frac{a}{b} + c$ and nothing else'), `TeX of a formula not drawn, its comment gone: ${body}`);
    assert.ok(body.includes('$$\nE = mc^2 \\label{eq:e}\n$$') || body.includes('$$\n\\begin{equation}E = mc^2 \\label{eq:e}\\end{equation}\n$$'), body);
    assert.match(md, /\nclip_check: "[^"]*formulas 3\/3"\n/, 'every formula counted and clipped');
    await tab.close();
    await page.bringToFront();
  });

  // A path under the notes folder, which holds clips too in this setup.
  const readPath = (path) => admin.evaluate(async (p) => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
    const parts = p.split('/');
    const name = parts.pop();
    try {
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      return name ? await (await (await dir.getFileHandle(name)).getFile()).text() : (await Array.fromAsync(dir.keys())).sort();
    } catch {
      return null;
    }
  }, path);

  await check('a page comment from its shortcut goes into the note and clips the page, in the panels\' style', async () => {
    // The page's note exists already; its type clips by itself.
    await admin.evaluate(() => chrome.storage.local.set({ docTypes: [{ id: 'paper', autoClip: true, clipPath: '' }] }));
    await page.bringToFront();
    await page.goto(`${origin}/paper`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.keyboard.press('Alt+KeyR');
    const panel = page.locator('selectiophile-ui .panel.review');
    await panel.waitFor({ timeout: 4000 });
    const text = await panel.innerText();
    assert.match(text, /COMMENTS · 简评/);
    assert.match(text, new RegExp(`写入笔记：${NOTE.replace(/\.md$/, '').replace(/[()]/g, '\\$&')}；保存后，这篇原文会自动剪藏入库`));
    assert.deepEqual(await panel.evaluate((n) => [getComputedStyle(n).borderRadius, n.querySelector('.head .badge') !== null]), ['21px', true], 'the panel of highlight comments');
    await panel.locator('textarea').fill('值得一读：注意力机制的出发点讲得很清楚。');
    if (shots) await page.screenshot({ path: join(shots, '60-page-comment.png') });
    await panel.locator('button', { hasText: '保存' }).click();
    await toast().filter({ hasText: '原文已剪藏' }).waitFor({ timeout: 10000 });
    const [name] = await readPath('references/articles/') || [];
    assert.ok(name, 'clipped by the general article config');
    const md = await readPath(`references/articles/${name}`);
    assert.ok(!/\ncomments:/.test(md), 'the comment is the note\'s, not the original\'s');
    assert.match(md, /\nclipped: \d{4}-\d\d-\d\d\n/, 'the day only');
    assert.ok(md.includes(`notes: "[[${NOTE.replace(/\.md$/, '')}]]"`), 'links back to the page\'s note');
    const note = await read(NOTE);
    const link = `[[${name.replace(/\.md$/, '')}]]`;
    assert.match(note, /\ncomments: "值得一读：注意力机制的出发点讲得很清楚。"\n/);
    assert.ok(note.includes(`references: "${link}"`), 'the property');
    assert.ok(note.includes(`\n# References\n\n- ${link}\n`), 'and under References');
    // Opened again: the comment is there to edit.
    await page.keyboard.press('Alt+KeyR');
    await panel.waitFor({ timeout: 4000 });
    assert.equal(await panel.locator('textarea').inputValue(), '值得一读：注意力机制的出发点讲得很清楚。');
    assert.match(await panel.innerText(), /COMMENTS · 修改简评[\s\S]*写入笔记：/);
    assert.ok(!(await panel.innerText()).includes('自动剪藏'), 'clipped already');
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached', timeout: 4000 });
  });

  await check('the popup opens the page comment on a site not on the list; without a note it goes into the original', async () => {
    const url = 'https://www.science.org/doi/10.1126/science.adt7185';
    const sci = await context.newPage();
    const logs = [];
    sci.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    sci.on('pageerror', (e) => logs.push(`error: ${e.message}`));
    await sci.goto(url);
    await sci.locator('html[data-ready]').waitFor({ state: 'attached', timeout: 10000 });
    assert.equal(await sci.locator('selectiophile-ui').count(), 0, 'not on the list');
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.science.org/*' }))[0].id);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    const status = await popup.evaluate(async (u) => chrome.runtime.sendMessage({ type: 'review:status', url: u }), url);
    assert.equal(status.result.clipped, 'Discovering molecular modulators with nanoswitch screening');
    const opened = await popup.evaluate(async (id) => chrome.runtime.sendMessage({ type: 'review:open', tabId: id }), tabId);
    assert.ok(opened.ok, JSON.stringify(opened));
    await popup.close();
    await sci.bringToFront();
    const panel = sci.locator('selectiophile-ui .panel.review');
    try {
      await panel.waitFor({ timeout: 5000 });
    } catch (e) {
      const shown = await sci.locator('selectiophile-ui').evaluate((h) => h.shadowRoot?.innerHTML.slice(0, 600)).catch(() => 'no ui');
      await sci.close();
      await page.bringToFront();
      throw new Error(`${e.message}\n${logs.slice(-10).join('\n')}\n${shown}`);
    }
    assert.match(await panel.innerText(), /还没有这篇的笔记，有笔记后写进笔记/);
    await panel.locator('textarea').fill('Screening by function, not binding.');
    await panel.locator('textarea').press('Control+Enter');
    await sci.locator('selectiophile-ui .toast', { hasText: '简评已保存，这篇有笔记后会写进笔记' }).waitFor({ timeout: 5000 });
    const md = await readPath('references/papers/Discovering molecular modulators with nanoswitch screening.md');
    assert.ok(md.includes('\ncomments: "Screening by function, not binding."\n'), 'in the original, for the dashboard, until there is a note');
    const reviews = (await admin.evaluate(() => chrome.storage.local.get('reviews'))).reviews;
    assert.equal(Object.values(reviews).find((r) => r.text.startsWith('Screening'))?.text, 'Screening by function, not binding.');
    await sci.close();
    await page.bringToFront();
  });

  await check('the dashboard is preset; a file edited in Obsidian is kept until replaced', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('#dashCreate').click();
    await admin.locator('#dashOut', { hasText: /看板已/ }).waitFor({ timeout: 4000 });
    const preset = (await read('_dashboard.md')) ?? '';
    assert.ok(preset.startsWith('## 笔记\n') && preset.includes('## 入库原文\n'), `${await admin.locator('#dashOut').innerText()}\n${preset}`);
    assert.ok(preset.includes('WHERE last_annotated AND !clipped\n'), 'no clipped original among the notes');
    assert.ok(preset.includes('dateformat(clipped, "yyyy-MM-dd") AS "剪藏日期"'));
    // Nothing to edit here: one line points to Dataview.
    assert.equal(await admin.locator('#dashTables, #dashAddTable, #dashPreview').count(), 0);
    const help = admin.locator('#dashCard a', { hasText: 'Dataview 语法' });
    assert.equal(await help.getAttribute('target'), '_blank');
    if (shots) await admin.locator('#dashCard').screenshot({ path: join(shots, '61-dashboard-preset.png') });
    // Edited in Obsidian: kept, and replaced only when asked.
    await admin.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const w = await (await dir.getFileHandle('_dashboard.md')).createWritable();
      await w.write('# mine\n');
      await w.close();
    });
    await admin.locator('#dashCreate').click();
    await admin.locator('#dashOut', { hasText: '没有覆盖' }).waitFor({ timeout: 4000 });
    assert.equal(await read('_dashboard.md'), '# mine\n');
    await admin.locator('#dashOverwrite', { hasText: '用预设覆盖' }).click();
    for (let i = 0; i < 30 && (await read('_dashboard.md')) !== preset; i++) await admin.waitForTimeout(100);
    assert.equal(await read('_dashboard.md'), preset);
  });

  await check('a chosen notes folder shows at once, while held highlights are written below', async () => {
    const opts = await context.newPage();
    // The system dialog can't open here: it answers with the same folder. The
    // background is slowed down, as by many held highlights or a large vault.
    await opts.addInitScript(() => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg, ...rest) => (msg?.type === 'folder:ready' ? new Promise((r) => setTimeout(() => r(send(msg, ...rest)), 3000)) : send(msg, ...rest));
    });
    await opts.goto(`chrome-extension://${extId}/options/options.html`);
    await opts.locator('#folder', { hasText: '已授权' }).waitFor({ timeout: 5000 });
    await opts.locator('#pick').click();
    await opts.locator('#folderOut', { hasText: '正在检查文件夹' }).waitFor({ timeout: 1500 });
    assert.match(await opts.locator('#folder').innerText(), /Selectiophile：已授权/);
    await opts.locator('#folderOut').waitFor({ state: 'hidden', timeout: 8000 });
    await opts.close();
    await page.bringToFront();
  });

  await check('a notes folder can be dragged onto its card, for when the system dialog fails', async () => {
    const opts = await context.newPage();
    // A file manager drop hands over a folder handle: here, the same folder.
    await opts.addInitScript(() => {
      DataTransferItem.prototype.getAsFileSystemHandle = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
    });
    await opts.goto(`chrome-extension://${extId}/options/options.html`);
    await opts.locator('#folder', { hasText: '已授权' }).waitFor({ timeout: 5000 });
    assert.ok(await opts.locator('#folderCard .drop-help').isVisible());
    const highlighted = await opts.evaluate(() => {
      // The checking note may come and go within a frame: every text it shows is kept.
      window.__folderOut = [];
      const out = document.getElementById('folderOut');
      new MutationObserver(() => window.__folderOut.push(out.textContent)).observe(out, { childList: true, characterData: true, subtree: true });
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'Selectiophile'));
      const zone = document.getElementById('folderCard');
      zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      const on = zone.classList.contains('dropping');
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return on;
    });
    assert.ok(highlighted, 'the card shows it takes the drop');
    for (let i = 0; i < 80 && !(await opts.evaluate(() => window.__folderOut.some((x) => x.includes('正在检查文件夹')))); i++) await opts.waitForTimeout(25);
    assert.ok(await opts.evaluate(() => window.__folderOut.some((x) => x.includes('正在检查文件夹'))), 'the folder is being checked');
    await opts.locator('#folderOut').waitFor({ state: 'hidden', timeout: 8000 });
    assert.match(await opts.locator('#folder').innerText(), /Selectiophile：已授权/);
    await opts.close();
    await page.bringToFront();
  });

  await check('each document type has its configs, template and clipping; a config can move to another type', async () => {
    await admin.bringToFront();
    await admin.evaluate(() => chrome.storage.local.remove('docTypes'));
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const paper = admin.locator('.doc-type[data-type="paper"]');
    const article = admin.locator('.doc-type[data-type="article"]');
    await paper.locator('.rows li').first().waitFor({ timeout: 5000 });
    assert.deepEqual(await admin.locator('.doc-type h3').allInnerTexts(), ['学术文献', '网页文章']);
    assert.equal(await paper.locator('.rows li').count(), 5);
    assert.deepEqual(await article.locator('.rows .name').allInnerTexts(), ['web-article']);
    assert.equal(await article.locator('.rows .pick').count(), 0, 'the general config stays with web articles');
    assert.equal(await paper.locator('.tpl-name').innerText(), '学术文献模板');
    assert.equal(await paper.locator('.type-clip input[data-clip="autoClip"]').isChecked(), true, 'papers clip by default');
    assert.equal(await article.locator('.type-clip input[data-clip="autoClip"]').isChecked(), false);
    assert.equal(await paper.locator('.type-clip input[type=checkbox]').count(), 1, 'one switch');
    assert.equal(await admin.locator('#reviewAuto').count(), 0, 'no setting for all types any more');
    assert.equal(await article.locator('.type-clip .field input').getAttribute('placeholder'), 'references/articles');
    if (shots) await paper.screenshot({ path: join(shots, '62-doc-type.png') });
    if (shots) await admin.locator('#docSection').screenshot({ path: join(shots, '64-doc-section.png'), clip: undefined });
    // A type folds to its head, which still says what it holds, and stays folded.
    const fold = paper.locator('.type-fold');
    assert.equal(await fold.getAttribute('aria-expanded'), 'true', 'open at first');
    await fold.click();
    assert.equal(await paper.locator('.type-body').isHidden(), true);
    assert.equal(await paper.locator('.type-summary').innerText(), '5 个配置 · 自动剪藏');
    assert.equal(await article.locator('.type-body').isVisible(), true, 'the other type stays open');
    if (shots) await admin.locator('#docSection').screenshot({ path: join(shots, '66-doc-folded.png') });
    await admin.reload();
    await paper.locator('.type-fold[aria-expanded="false"]').waitFor({ timeout: 5000 });
    assert.equal(await paper.locator('.type-body').isHidden(), true, 'remembered');
    await paper.locator('h3').click();
    assert.equal(await paper.locator('.type-body').isVisible(), true, 'the name opens it too');
    assert.deepEqual((await admin.evaluate(() => chrome.storage.local.get('foldedTypes'))).foldedTypes, []);
    // A folder for the type's clips, which the popup names.
    await paper.locator('.type-clip .field input').fill(' references/nature/ ');
    await paper.locator('.type-clip .field input').press('Tab');
    let types;
    for (let i = 0; i < 30; i++) {
      types = (await admin.evaluate(() => chrome.storage.local.get('docTypes'))).docTypes;
      if (types?.[0]?.clipPath) break;
      await admin.waitForTimeout(100);
    }
    assert.equal(types[0].clipPath, 'references/nature');
    const status = await admin.evaluate(() => chrome.runtime.sendMessage({ type: 'clip:status', url: 'https://www.nature.com/articles/x' }));
    assert.equal(status.result.folder, 'references/nature');
    // Moving a config to a new type.
    await admin.locator('#addDocType').click();
    const added = admin.locator('.doc-type:not([data-type="paper"]):not([data-type="article"])');
    await added.waitFor({ timeout: 4000 });
    await added.locator('.type-rename').fill('预印本');
    await added.locator('.type-rename').press('Tab');
    await paper.locator('.rows li', { hasText: 'papers-Nature' }).locator('.pick-btn').click();
    await paper.locator('.rows li', { hasText: 'papers-Nature' }).locator('.pick-list button', { hasText: '预印本' }).click();
    await added.locator('.rows li', { hasText: 'papers-Nature' }).waitFor({ timeout: 4000 });
    assert.equal(await added.locator('.tpl-state').innerText(), '未上传，暂用网页文章模板');
    if (shots) await added.screenshot({ path: join(shots, '63-doc-type-added.png') });
    admin.once('dialog', (d) => d.accept());
    await added.locator('.type-head .icon-btn.danger').click();
    await added.waitFor({ state: 'detached', timeout: 4000 });
    await paper.locator('.rows li', { hasText: 'papers-Nature' }).waitFor({ timeout: 4000 });
    // Back to the defaults, as the other checks expect.
    await admin.evaluate(() => chrome.storage.local.set({ docTypes: [{ id: 'paper', autoClip: false, clipPath: '' }], profileTypes: {} }));
  });

  await check('the config template and built-in configs download, and the template uploads as is', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const rows = admin.locator('#docTypes .rows li');
    await rows.first().waitFor({ timeout: 4000 });
    const [file] = await Promise.all([admin.waitForEvent('download'), admin.locator('#profileTemplate').click()]);
    assert.equal(file.suggestedFilename(), 'selectiophile-config-template.json');
    const text = await readFile(await file.path(), 'utf8');
    const template = JSON.parse(text);
    assert.ok(template._notes.join('').includes('triggers') && template.properties.every((p) => p._note));
    assert.match(template.properties[0]._note, /文件名/, 'in the current language');
    const [bundled] = await Promise.all([admin.waitForEvent('download'), rows.first().locator('button', { hasText: '下载' }).click()]);
    assert.equal(bundled.suggestedFilename(), 'papers-acs-clipper.json');
    assert.equal(JSON.parse(await readFile(await bundled.path(), 'utf8')).name, 'papers-ACS');
    await admin.locator('#profileFile').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await admin.locator('#docOut', { hasText: 'my-journal' }).waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#docOut .bad').count(), 0, 'no warnings');
    await admin.locator('#docTypes .rows li', { hasText: 'my-journal' }).locator('button', { hasText: '移除' }).click();
    await admin.locator('#docTypes .rows li', { hasText: 'my-journal' }).waitFor({ state: 'detached', timeout: 4000 });
    await admin.locator('#docOut').evaluate((n) => n.replaceChildren());
  });

  await check('settings list configs; an uploaded one overrides, warns and can be removed', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const rows = admin.locator('#docTypes .rows li');
    await rows.first().waitFor({ timeout: 4000 });
    assert.equal(await rows.count(), 6);
    assert.match(await rows.first().innerText(), /papers-ACS/);
    assert.match(await rows.last().innerText(), /web-article[\s\S]*没有专用配置的网页/, 'the general article config');
    assert.match(await admin.locator('#docTypes').innerText(), /papers-Nature[\s\S]*papers-Science/);
    if (shots) await admin.locator('.doc-type[data-type="paper"]').screenshot({ path: join(shots, '27-configs.png') });
    await admin.locator('#profileFile').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await admin.locator('#docOut .bad', { hasText: 'broken.json' }).waitFor({ timeout: 4000 });
    const custom = { name: 'Custom', triggers: ['https://www.mdpi.com/custom/'], properties: [
      { name: 'title', value: 'Custom-{{meta:name:citation_doi|split:"/"|last}}', type: 'text' },
      { name: 'odd', value: '{{url|mystery}}', type: 'text' },
    ] };
    await admin.locator('#profileFile').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(custom)) });
    await admin.locator('#docOut', { hasText: 'mystery' }).waitFor({ timeout: 4000 });
    await rows.nth(3).waitFor({ timeout: 4000 });
    await page.bringToFront();
    await page.goto('https://www.mdpi.com/custom/page');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.evaluate(() => { document.querySelector('meta[name=citation_doi]').content = '10.3390/customdoi'; });
    await select('m1');
    await page.keyboard.press('Alt+KeyS');
    await waitForText('Custom-customdoi.md', 'Proteins fold quickly');
    await admin.bringToFront();
    await admin.locator('#docTypes .rows li', { hasText: 'Custom' }).locator('button', { hasText: '移除' }).click();
    await admin.locator('#docTypes .rows li', { hasText: 'Custom' }).waitFor({ state: 'detached', timeout: 4000 });
    await admin.locator('#profileFile').setInputFiles([]);
  });

  await check('a config can be picked from the popup for this page, or turned off', async () => {
    const other = { name: 'Picked', triggers: ['https://nowhere.example/'], properties: [{ name: 'title', value: 'Picked-{{meta:name:citation_doi|split:"/"|last}}', type: 'text' }] };
    await admin.bringToFront();
    await admin.locator('#profileFile').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
    await admin.locator('#docTypes .rows li', { hasText: 'Picked' }).waitFor({ timeout: 4000 });

    const openPopup = async (pageUrl) => {
      const popup = await context.newPage();
      await popup.addInitScript((u) => {
        const query = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async () => (await query({})).filter((x) => x.url === u).slice(0, 1);
      }, pageUrl);
      await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
      await popup.locator('#profileBox').waitFor({ timeout: 4000 });
      return popup;
    };
    const saveFresh = async (doi) => {
      await page.evaluate((d) => { document.querySelector('meta[name=citation_doi]').content = d; }, doi);
      await select('m1');
      await page.keyboard.press('Alt+KeyS');
    };

    const pickedUrl = 'https://www.mdpi.com/pick/one';
    await page.bringToFront();
    await page.goto(pickedUrl);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    let popup = await openPopup(pickedUrl);
    assert.match(await popup.locator('#profileLabel').innerText(), /自动：papers-MDPI/);
    await popup.locator('#profileCurrent').click();
    assert.deepEqual((await popup.locator('#profileList button').allInnerTexts()).filter((x) => /Picked|不使用|MDPI/.test(x)), ['自动：papers-MDPI', 'Picked', 'papers-MDPI', '不使用配置']);
    if (shots) {
      await popup.setViewportSize({ width: 344, height: 560 });
      await popup.screenshot({ path: join(shots, '37-popup-config.png') });
    }
    await popup.locator('#profileList button', { hasText: 'Picked' }).click();
    await popup.locator('#profileLabel', { hasText: 'Picked' }).waitFor({ timeout: 4000 });
    await popup.close();
    await page.bringToFront();
    await page.waitForTimeout(250);
    await saveFresh('10.3390/pickedone');
    await waitForText('Picked-pickedone.md', 'Proteins fold quickly');

    const noneUrl = 'https://www.mdpi.com/pick/two';
    await page.goto(noneUrl);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    popup = await openPopup(noneUrl);
    await popup.locator('#profileCurrent').click();
    await popup.locator('#profileList button', { hasText: '不使用配置' }).click();
    await popup.close();
    await page.bringToFront();
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.querySelector('meta[name=citation_title]').content = 'Plain Metadata Study Here'; });
    await saveFresh('10.3390/nonetwo');
    await waitForText('Zhang(2024)-Plain Metadata Study Here.md', 'Proteins fold quickly');
    assert.ok(!(await read('Zhang(2024)-Plain Metadata Study Here.md')).includes('paper_id'), 'the config did not run');

    await admin.bringToFront();
    await admin.locator('#docTypes .rows li', { hasText: 'Picked' }).locator('button', { hasText: '移除' }).click();
    await admin.locator('#docTypes .rows li', { hasText: 'Picked' }).waitFor({ state: 'detached', timeout: 4000 });
    await page.bringToFront();
  });

  await check('an uploaded template is used for new notes, and can be reset', async () => {
    await admin.bringToFront();
    const paperRow = admin.locator('.tpl[data-id="paper"]');
    await paperRow.locator('.tpl-state', { hasText: '内置' }).waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('.tpl').count(), 2, 'paper and article templates always exist');
    await paperRow.locator('button', { hasText: '上传模板' }).click();
    await admin.locator('#templateFile').setInputFiles({ name: 'none.md', mimeType: 'text/markdown', buffer: Buffer.from('no headings here') });
    await admin.locator('#docOut', { hasText: '没有标题' }).waitFor({ timeout: 4000 });
    const mine = '---\ntitle:\ndoi:\n---\n\n# Reading\n\n## Claims\n\n## Doubts\n';
    await paperRow.locator('button', { hasText: '上传模板' }).click();
    await admin.locator('#templateFile').setInputFiles({ name: 'mine.md', mimeType: 'text/markdown', buffer: Buffer.from(mine) });
    await admin.locator('.tpl[data-id="paper"] .tpl-state', { hasText: '2 个内容块' }).waitFor({ timeout: 4000 });
    await page.bringToFront();
    await page.goto(`${origin}/third`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('t1');
    await page.keyboard.press('Alt+KeyS');
    const name = 'Turing(1950)-Computing Machinery Intelligence.md';
    await waitForText(name, 'Can machines think');
    const md = await read(name);
    assert.ok(md.includes('## Claims') && md.includes('## Doubts') && !md.includes('# Summary'), md);
    const asked = await sw.evaluate(() => globalThis.__jevRequests.filter((r) => r.questions.block).at(-1));
    assert.deepEqual(Object.keys(asked.questions.block.criteria), ['Claims', 'Doubts'], 'Jev chooses among the uploaded headings');
    await admin.bringToFront();
    await admin.locator('.tpl[data-id="paper"] button', { hasText: '恢复内置模板' }).click();
    await admin.locator('.tpl[data-id="paper"] .tpl-state', { hasText: '内置' }).waitFor({ timeout: 4000 });
    await page.bringToFront();
  });

  await check('sites can be tied to a template; a custom one is added, used and removed', async () => {
    await context.route('https://**.substack.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: SUBSTACK }));
    await admin.bringToFront();
    await admin.evaluate(async () => {
      const { sites } = await chrome.storage.local.get('sites');
      await chrome.storage.local.set({ sites: [...sites, '*.substack.com', '*.letters.example'] });
    });
    const articleRow = admin.locator('.tpl[data-id="article"]');
    await articleRow.locator('.tpl-add input').fill('https://www.substack.com/inbox');
    await articleRow.locator('.tpl-add button').click();
    await admin.locator('.tpl[data-id="article"] .rule', { hasText: '*.substack.com' }).waitFor({ timeout: 4000 });
    if (shots) await admin.locator('.doc-type[data-type="article"]').screenshot({ path: join(shots, '35-templates.png') });

    // A tied site creates with the article template, without asking.
    await page.bringToFront();
    await page.goto('https://jane.substack.com/p/why-attention?r=abc&utm_source=share');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('a1');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('说得有道理');
    await page.keyboard.press('Control+Enter');
    const name = 'Why Attention Keeps Winning.md';
    await waitForText(name, 'Attention keeps winning benchmarks');
    assert.equal(await page.locator('selectiophile-ui .panel').count(), 0, 'no question asked');
    const md = await read(name);
    assert.ok(md.includes('# Key Ideas') && md.includes('# My Thoughts') && !md.includes('# Summary'), 'the article template');
    assert.ok(md.includes('author: "Jane Roe"') && md.includes('site: "Jane\'s Letter"'));
    assert.ok(md.includes('published: 2024-05-06'));
    assert.ok(md.includes('url: "https://jane.substack.com/p/why-attention"'), 'without share parameters');
    assert.ok(!md.includes('journal:') && !md.includes('doi:'));

    // Later highlights find the note, even through a different share link.
    await page.goto('https://jane.substack.com/p/why-attention?r=other');
    await page.locator('selectiophile-ui .fab[title*="Why Attention"]').waitFor({ timeout: 5000 });
    await select('a2');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(name, 'A second thought on scale');
    assert.equal((await files()).filter((f) => f.startsWith('Why Attention')).length, 1);
    const asked = await sw.evaluate(() => globalThis.__jevRequests.filter((r) => r.questions.block).at(-1));
    assert.deepEqual(Object.keys(asked.questions.block.criteria), ['Key Ideas', 'Useful Details', 'My Thoughts', 'Others'], 'the note\'s own headings');
    assert.equal(asked.state.source_title, 'Why Attention Keeps Winning');

    // A custom template takes over, and a rule moves rather than being duplicated.
    await admin.bringToFront();
    await admin.locator('#addDocType').click();
    const custom = admin.locator('.doc-type', { has: admin.locator('input.type-rename') });
    await custom.waitFor({ timeout: 4000 });
    await custom.locator('input.type-rename').fill('Newsletter');
    await custom.locator('input.type-rename').press('Tab');
    await custom.locator('button', { hasText: '上传模板' }).click();
    await admin.locator('#templateFile').setInputFiles({ name: 'Newsletter.md', mimeType: 'text/markdown', buffer: Buffer.from('---\ntitle:\n---\n\n# Takeaways\n\n# Actions\n') });
    await custom.locator('.tpl-state', { hasText: '2 个内容块' }).waitFor({ timeout: 4000 });
    assert.equal(await custom.locator('.tpl-name').innerText(), 'Newsletter模板');
    await custom.locator('.tpl-add input').fill('substack.com');
    await custom.locator('.tpl-add button').click();
    await custom.locator('.rule', { hasText: '*.substack.com' }).waitFor({ timeout: 4000 });
    await admin.locator('.tpl[data-id="article"] .rule').waitFor({ state: 'detached', timeout: 4000 });
    await page.bringToFront();
    await page.goto('https://jane.substack.com/p/next-post');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.evaluate(() => { document.title = 'Next Post Here'; document.querySelector('meta[property="og:title"]').content = 'Next Post Here'; });
    await select('a1');
    await page.keyboard.press('Alt+KeyS');
    await waitForText('Next Post Here.md', 'Attention keeps winning benchmarks');
    assert.ok((await read('Next Post Here.md')).includes('# Takeaways'));
    assert.ok(!(await read(name)).includes('# Takeaways'), 'existing notes are not affected');

    await admin.bringToFront();
    admin.once('dialog', (d) => d.accept());
    await custom.locator('.type-head .icon-btn.danger').click();
    await custom.waitFor({ state: 'detached', timeout: 4000 });
    await page.bringToFront();
  });

  await check('a template sends notes to a subfolder, and rules take wildcards', async () => {
    await admin.bringToFront();
    const articleRow = admin.locator('.tpl[data-id="article"]');
    await articleRow.waitFor({ timeout: 4000 });
    await articleRow.locator('.rule button', { hasText: '移除' }).first().click().catch(() => {});
    await admin.waitForTimeout(100);
    const row = admin.locator('.tpl[data-id="article"]');
    await row.locator('.tpl-add input').fill('*.substack.com/p/*');
    await row.locator('.tpl-add button').click();
    await admin.locator('.tpl[data-id="article"] .rule', { hasText: '*.substack.com/p/*' }).waitFor({ timeout: 4000 });
    await admin.locator('.tpl[data-id="article"] .tpl-folder input').fill('../阅读/ 文章 ');
    await admin.locator('.tpl[data-id="article"] .tpl-folder input').blur();
    for (let i = 0; i < 40 && (await admin.locator('.tpl[data-id="article"] .tpl-folder input').inputValue()) !== '阅读/文章'; i++) await admin.waitForTimeout(25);
    assert.equal(await admin.locator('.tpl[data-id="article"] .tpl-folder input').inputValue(), '阅读/文章', 'cleaned up');
    if (shots) await admin.locator('.doc-type[data-type="article"]').screenshot({ path: join(shots, '39-template-folder.png') });
    await admin.waitForTimeout(100);

    await page.bringToFront();
    await page.goto('https://bob.substack.com/p/routed-post');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.evaluate(() => { document.title = 'Routed Post'; document.querySelector('meta[property="og:title"]').content = 'Routed Post'; });
    await select('a1');
    await page.keyboard.press('Alt+KeyS');
    await toast().filter({ hasText: '阅读/文章/Routed Post' }).waitFor({ timeout: 5000 });
    const text = await admin.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const dir = await (await root.getDirectoryHandle('阅读')).getDirectoryHandle('文章');
      return (await (await dir.getFileHandle('Routed Post.md')).getFile()).text();
    });
    assert.ok(text.includes('Attention keeps winning benchmarks') && text.includes('# Key Ideas'));
    assert.ok((await toast().locator('a').getAttribute('href')).includes(encodeURIComponent('Routed Post#')), 'opens by name');

    await page.goto('https://bob.substack.com/about');
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.evaluate(() => { document.querySelector('meta[property="og:title"]').content = 'About Bob Here'; });
    await select('a2');
    await page.keyboard.press('Alt+KeyS');
    const asked = page.locator('selectiophile-ui .panel', { hasText: '存到哪篇笔记' });
    await asked.waitFor({ timeout: 5000 });
    assert.match(await asked.innerText(), /保存到 阅读\/文章/, 'outside the pattern: asks, and names the folder');
    await page.keyboard.press('Escape');

    await page.bringToFront();
  });

  await check('the save-to dropdown lists subfolders, filters, and takes new names', async () => {
    await admin.bringToFront();
    await admin.reload();
    const combo = admin.locator('.tpl[data-id="article"] .folder-combo');
    const input = combo.locator('input');
    const options = combo.locator('[role="option"]');
    const stored = () => admin.evaluate(async () => (await chrome.storage.local.get('templates')).templates.find((x) => x.id === 'article').folder);
    const storedIs = async (want) => {
      for (let i = 0; i < 40 && (await stored()) !== want; i++) await admin.waitForTimeout(25);
      assert.equal(await stored(), want);
    };
    await combo.waitFor({ timeout: 4000 });
    assert.equal(await input.inputValue(), '阅读/文章');

    // A folder made while the page is open appears on the next opening.
    await admin.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      await root.getDirectoryHandle('刚建的', { create: true });
    });
    await combo.locator('.folder-toggle').click();
    await options.filter({ hasText: '刚建的' }).waitFor({ timeout: 4000 });
    const current = options.filter({ hasText: '阅读/文章' });
    assert.equal(await current.getAttribute('aria-selected'), 'true');
    assert.equal(await options.first().innerText(), '库的顶层（Selectiophile）', 'named after the vault');
    assert.equal(await input.getAttribute('aria-expanded'), 'true');
    assert.equal(await combo.locator('[role="option"].active').innerText(), '阅读/文章', 'the highlight stays on the current folder after the list is re-read');
    if (shots) await admin.screenshot({ path: join(shots, '40-folder-dropdown.png') });
    const box = await combo.locator('.picker-list').boundingBox();
    const below = await admin.locator('.tpl[data-id="article"] .tpl-actions').boundingBox();
    assert.ok(box.y < below.y + below.height && box.y + box.height > below.y, 'floats over the row beneath');
    assert.equal(await admin.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest('.picker-list') !== null, { x: box.x + 5, y: below.y + 5 }), true, 'on top of the row beneath');

    await options.filter({ hasText: '刚建的' }).click();
    assert.equal(await combo.locator('.picker-list').isVisible(), false);
    assert.equal(await input.inputValue(), '刚建的');
    await storedIs('刚建的');

    // Clicking the input shows everything even though it holds a value.
    await input.click();
    assert.ok(await options.filter({ hasText: '阅读/文章' }).isVisible());

    // Typing narrows the list, and an unknown name offers to be created.
    await input.fill('阅读');
    assert.equal(await options.count(), 2);
    await input.fill('文献/2026');
    assert.equal(await options.count(), 1);
    assert.equal(await options.first().innerText(), '新建文件夹：文献/2026');
    if (shots) await admin.screenshot({ path: join(shots, '41-folder-new.png') });

    // Enter while an IME is composing belongs to the IME.
    await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    assert.equal(await combo.locator('.picker-list').isVisible(), true);
    await input.press('Enter');
    assert.equal(await combo.locator('.picker-list').isVisible(), false);
    await storedIs('文献/2026');

    // Keyboard: arrows move, Enter picks, Escape closes.
    await input.press('ArrowDown');
    await options.first().waitFor({ timeout: 2000 });
    await input.press('Escape');
    assert.equal(await combo.locator('.picker-list').isVisible(), false);
    assert.equal(await stored(), '文献/2026');
    await input.press('ArrowDown');
    await options.first().waitFor({ timeout: 2000 });
    assert.equal(await combo.locator('[role="option"].active').innerText(), '新建文件夹：文献/2026', 'starts on the current value');
    await input.press('ArrowDown');
    assert.equal(await combo.locator('[role="option"].active').innerText(), '库的顶层（Selectiophile）', 'wraps from the last row to the first');
    // Every folder of the vault, the clips' too.
    const listed = await options.allInnerTexts();
    assert.ok(listed.includes('references/papers'), listed.join(' | '));
    await input.press('ArrowDown');
    const first = await options.nth(1).innerText();
    assert.equal(await combo.locator('[role="option"].active').innerText(), first);
    await input.press('ArrowUp');
    await input.press('ArrowDown');
    await input.press('Enter');
    await storedIs(first);

    // Choosing the top level clears it.
    await combo.locator('.folder-toggle').click();
    await options.first().click();
    assert.equal(await input.inputValue(), '');
    await storedIs('');

    // Leaving the field keeps what was typed, cleaned.
    await input.fill('../阅读/ 文章 ');
    await input.blur();
    assert.equal(await input.inputValue(), '阅读/文章');
    await storedIs('阅读/文章');
    await input.fill('');
    await input.blur();
    await storedIs('');
    await page.bringToFront();
  });

  await check('a page on an untied site still asks, and names the template it would use', async () => {
    await page.goto(`${origin}/blog`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<p id="newpost">A paragraph nobody has saved yet.</p>'); history.replaceState({}, '', '/blog/unseen'); });
    await page.waitForTimeout(1100);
    await select('newpost');
    await page.keyboard.press('Alt+KeyS');
    const panel = page.locator('selectiophile-ui .panel', { hasText: '存到哪篇笔记' });
    await panel.waitFor({ timeout: 5000 });
    assert.match(await panel.innerText(), /新建时使用模板：网页文章模板/);
    if (shots) await page.screenshot({ path: join(shots, '36-ask-article.png') });
    await page.keyboard.press('Escape');
  });

  await check('notes in subfolders take part in routing, and hidden folders do not', async () => {
    await admin.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const write = async (dir, name, text) => {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(text);
        await w.close();
      };
      const deep = await (await root.getDirectoryHandle('topics', { create: true })).getDirectoryHandle('ml', { create: true });
      await write(deep, 'Lamport.md', '---\ntitle: "Time Clocks"\ndoi: "10.1145/359545.359563"\n---\n\n# Summary\n\n## Main Findings\n\n# Others\n');
      const hidden = await root.getDirectoryHandle('.obsidian', { create: true });
      await write(hidden, 'Hidden.md', '---\ntitle: "Should Not Appear"\ndoi: "10.1145/999999.999999"\n---\n\n# Others\n');
    });
    await page.goto(`${origin}/nested`);
    await page.locator('selectiophile-ui .fab[title*="Lamport"]').waitFor({ timeout: 5000 });
    await select('n1');
    await page.keyboard.press('Alt+KeyS');
    await toast().filter({ hasText: 'topics/ml/Lamport' }).waitFor({ timeout: 5000 });
    assert.ok((await toast().locator('a').getAttribute('href')).includes(encodeURIComponent('Lamport#')), 'opens by name, not by folder path');
    const text = await admin.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const dir = await (await root.getDirectoryHandle('topics')).getDirectoryHandle('ml');
      return (await (await dir.getFileHandle('Lamport.md')).getFile()).text();
    });
    assert.ok(text.includes('Events are partially ordered'));
    await page.locator('selectiophile-ui .fab').click();
    await page.locator('selectiophile-ui .panel .list .label').first().waitFor({ timeout: 4000 });
    const labels = await page.locator('selectiophile-ui .panel .list .label').allInnerTexts();
    assert.ok(labels.includes('topics/ml/Lamport'));
    assert.ok(!labels.some((l) => l.includes('Hidden')));
    await page.keyboard.press('Escape');
  });

  await check('switching to English changes every surface and the dashboard', async () => {
    assert.ok((await read('_dashboard.md')).includes('AS "笔记"'));
    await admin.bringToFront();
    await admin.evaluate(() => { window.__samePage = true; });
    await admin.locator('#langSeg button[data-lang="en"]').click();
    await admin.locator('html[lang="en"]').waitFor({ timeout: 5000 });
    assert.equal(await admin.evaluate(() => window.__samePage), true, 'redrawn in place, not reloaded');
    await admin.locator('h2', { hasText: 'Notes folder' }).waitFor({ timeout: 4000 });
    await admin.locator('#modeHelp', { hasText: 'Runs only on the sites below' }).waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('input[data-color="blue"]').inputValue(), 'Method');
    assert.equal((await admin.locator('body').innerText()).match(/[\u3400-\u9fff]/g)?.join(''), '中文', 'only the language button stays in Chinese');
    if (shots) await admin.screenshot({ path: join(shots, '28-options-en.png') });
    for (let i = 0; i < 30 && !(await read('_dashboard.md')).includes('AS "Note"'); i++) await admin.waitForTimeout(100);
    const dashboard = await read('_dashboard.md');
    assert.ok(dashboard.startsWith('## Notes\n\n```dataview\nTABLE WITHOUT ID file.link AS "Note", dateformat(last_annotated, "yyyy-MM-dd HH:mm") AS "Last annotated", default(elink(url, default(journal, default(site, url))), default(journal, site)) AS "Source"\n'), dashboard);
    assert.ok(dashboard.includes('## Clipped originals\n\n```dataview\nTABLE WITHOUT ID file.link AS "Source", dateformat(clipped, "yyyy-MM-dd") AS "Clipped", default(comments, join(filter(flat(list(notes.comments)), (c) => c), "; ")) AS "Comments", notes AS "Notes"\nWHERE clipped\nSORT clipped DESC, file.ctime DESC\nLIMIT 100\n'), dashboard);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.locator('#options', { hasText: 'Open settings' }).waitFor({ timeout: 4000 });
    await popup.locator('#pinBox .heading', { hasText: 'PIN A NOTE' }).waitFor({ timeout: 4000 });
    await popup.close();

    await page.bringToFront();
    await page.goto(`${origin}/second`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    assert.match(await page.locator('selectiophile-ui .fab').getAttribute('title'), /^Current: /);
    await select('s3');
    await page.locator('selectiophile-ui .toolbar button', { hasText: 'Comment' }).waitFor({ timeout: 4000 });
    assert.ok(await page.locator('selectiophile-ui .toolbar .dot-btn[title^="Method"]').count());
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('A note in English');
    if (shots) await page.screenshot({ path: join(shots, '29-comment-en.png') });
    await page.keyboard.press('Control+Enter');
    await toast().filter({ hasText: 'Saved to' }).waitFor({ timeout: 5000 });
    assert.ok(await toast().locator('button', { hasText: 'Undo' }).count());
    const md = await read(SECOND);
    assert.ok(md.includes('- **Comments:** A note in English'));
    assert.match(md, /<a [^>]*>Source<\/a>/);

    await admin.bringToFront();
    await admin.locator('#langSeg button[data-lang="zh"]').click();
    await admin.locator('html[lang="zh"]').waitFor({ timeout: 5000 });
    for (let i = 0; i < 30 && !(await read('_dashboard.md')).includes('AS "笔记"'); i++) await admin.waitForTimeout(100);
    assert.ok((await read('_dashboard.md')).includes('AS "笔记"'));
    await page.bringToFront();
  });

  await check('the panels carry the mark Read Frog skips', async () => {
    await page.goto(`${origin}/paper`);
    const host = page.locator('selectiophile-ui');
    await host.waitFor({ state: 'attached', timeout: 5000 });
    assert.equal(await host.evaluate((n) => n.classList.contains('notranslate')), true);
    assert.equal(await host.getAttribute('translate'), 'no');
    assert.equal(await page.locator('selectiophile-ui .lp.notranslate').count(), 1);
  });

  await check('translated text in the page stays out of quotes and anchors', async () => {
    await page.goto(`${origin}/translated`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await selectAll('tr');
    await page.keyboard.press('Alt+KeyS');
    await waitForText(BILINGUAL_NOTE, 'Original words stay here');
    const md = await read(BILINGUAL_NOTE);
    assert.match(md, /Original words stay here\. Second part follows\./);
    assert.ok(!md.split('\n').find((l) => l.includes('Original words')).includes('译文'), 'no translation in the quote');
    await page.reload();
    await page.waitForFunction(() => window.__lpRanges().length === 1, null, { timeout: 5000 });
  });

  await check('the toolbar sits above the selection, clear of Phrase Collector', async () => {
    await page.goto(`${origin}/paper`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    // Draws its toolbar as Phrase Collector does: below the selection, in an open shadow root.
    await page.evaluate(() => {
      const host = document.createElement('phrase-collector-ui');
      host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;';
      const root = host.attachShadow({ mode: 'open' });
      const bar = document.createElement('div');
      bar.className = 'toolbar';
      bar.style.cssText = 'position:absolute;width:260px;height:42px;background:#ddd;';
      root.append(bar);
      document.documentElement.append(host);
      document.addEventListener('mouseup', () => setTimeout(() => {
        const r = window.getSelection().getRangeAt(0).getClientRects();
        const last = r[r.length - 1];
        bar.style.left = `${last.right - 130 + scrollX}px`;
        bar.style.top = `${last.bottom + 8 + scrollY}px`;
      }, 10), true);
      window.__pcBar = bar;
    });
    const mine = page.locator('selectiophile-ui .toolbar');
    const clear = async () => {
      const a = await mine.boundingBox();
      const b = await page.evaluate(() => { const r = window.__pcBar.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
      return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    };
    await select('fresh1');
    await mine.waitFor({ timeout: 4000 });
    await page.waitForTimeout(260);
    const sel = await page.locator('#fresh1').boundingBox();
    assert.ok((await mine.boundingBox()).y < sel.y, 'above the selection');
    assert.ok(await clear());
    if (shots) await page.screenshot({ path: join(shots, '30-toolbar-with-pc.png') });

    // At the very top there is no room above, so both would land below.
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<p id="topline" style="margin:0">Top line of the page sits here.</p>');
      window.scrollTo(0, 0);
    });
    await page.mouse.click(1000, 700);
    await select('topline');
    await mine.waitFor({ timeout: 4000 });
    await page.waitForTimeout(260);
    assert.ok(await clear(), 'moves off the other toolbar when both go below');
    await page.mouse.click(1000, 700);
  });

  await check('shortcuts can be changed, cleared and shown in the preview', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const standard = admin.locator('#toolbarSeg button[data-style="standard"]');
    await standard.locator('.tb-preview kbd', { hasText: 'Alt+C' }).waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#toolbarSeg button[data-style="lite"] .tb-preview kbd').count(), 0, 'Lite shows no shortcut');
    assert.equal(await admin.locator('#toolbarSeg .tb-preview i').count(), 12, 'six colors in each preview');
    if (shots) await admin.locator('#lookSection').screenshot({ path: join(shots, '31-toolbar-preview.png') });
    await admin.locator('#shortcutSave').click();
    await admin.keyboard.press('Alt+KeyC');
    await admin.locator('#shortcutOut', { hasText: '另一项' }).waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#shortcutSave').inputValue(), 'Alt+S', 'a clash is refused');
    await admin.keyboard.press('Alt+KeyQ');
    await standard.waitFor({ timeout: 4000 });
    for (let i = 0; i < 40 && (await admin.locator('#shortcutSave').inputValue()) !== 'Alt+Q'; i++) await admin.waitForTimeout(50);
    assert.equal(await admin.locator('#shortcutSave').inputValue(), 'Alt+Q');
    await admin.locator('#shortcutComment').click();
    await admin.keyboard.press('Control+Shift+KeyK');
    await standard.locator('.tb-preview kbd', { hasText: 'Ctrl+Shift+K' }).waitFor({ timeout: 4000 });

    await page.bringToFront();
    await page.goto(`${origin}/paper`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    const count = await entryCount(NOTE);
    await select('color5');
    await page.locator('selectiophile-ui .toolbar kbd', { hasText: 'Ctrl+Shift+K' }).waitFor({ timeout: 4000 });
    await page.keyboard.press('Alt+KeyS');
    await page.waitForTimeout(250);
    assert.equal(await entryCount(NOTE), count, 'the old shortcut does nothing');
    await page.keyboard.press('Alt+KeyQ');
    await waitForEntries(NOTE, count + 1);
    await select('color6');
    await page.keyboard.press('Control+Shift+KeyK');
    await page.locator('selectiophile-ui textarea').waitFor({ timeout: 4000 });
    await page.keyboard.press('Escape');

    await admin.bringToFront();
    await admin.locator('#shortcutSave').click();
    await admin.keyboard.press('Backspace');
    await admin.locator('#shortcutComment').click();
    await admin.keyboard.press('Backspace');
    await standard.locator('.tb-preview kbd').waitFor({ state: 'detached', timeout: 4000 });
    await admin.evaluate(() => chrome.storage.local.remove('shortcuts'));
    await page.bringToFront();
    await page.mouse.click(1000, 700);
  });

  await check('a deleted dashboard returns on the next save; name, folder and detection are settings', async () => {
    const removeFile = (name) => admin.evaluate(async (n) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      await dir.removeEntry(n).catch(() => {});
    }, name);
    await removeFile('_dashboard.md');
    assert.ok(!(await files()).includes('_dashboard.md'));
    const count = await entryCount(NOTE);
    await page.bringToFront();
    await page.goto(`${origin}/paper`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('color6');
    await page.keyboard.press('Alt+KeyS');
    await waitForEntries(NOTE, count + 1);
    await waitForText('_dashboard.md', 'dataview');

    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('#dashFolder').waitFor({ timeout: 4000 });
    assert.equal(await admin.locator('#dashFolder').inputValue(), '', 'the top of the vault');
    assert.equal(await admin.locator('#dashAuto').isChecked(), true);
    await admin.locator('#dashName').fill('我的看板');
    await admin.locator('#dashName').blur();
    await waitForText('我的看板.md', 'dataview');
    if (shots) await admin.locator('#folderSection').screenshot({ path: join(shots, '32-dashboard-settings.png') });

    // A subfolder of the vault, picked or typed without any system dialog.
    await admin.locator('#dashFolder').fill('看板/每日');
    await admin.locator('#dashFolder').press('Enter');
    // Moving it writes it there, through the setting's change or the page's own call.
    await admin.locator('#dashOut', { hasText: /看板已(创建|是最新)/ }).waitFor({ timeout: 4000 });
    const inFolder = () => admin.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const dir = await (await root.getDirectoryHandle('看板')).getDirectoryHandle('每日');
      const names = [];
      for await (const [n] of dir.entries()) names.push(n);
      return names;
    });
    assert.deepEqual(await inFolder(), ['我的看板.md']);
    const listed = (await admin.evaluate(() => chrome.runtime.sendMessage({ type: 'notes:list' }))).result.map((n) => n.name);
    assert.ok(!listed.some((n) => n.startsWith('看板/')), 'never offered as a note');
    // A folder of the vault dragged from the file manager counts by where it is; one
    // outside the vault is refused.
    const dropFolder = (path) => admin.evaluate(async (p) => {
      let dir = await navigator.storage.getDirectory();
      for (const part of p.split('/')) dir = await dir.getDirectoryHandle(part, { create: true });
      const e = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: { items: [{ kind: 'file', getAsFileSystemHandle: async () => dir }] } });
      document.getElementById('dashDrop').dispatchEvent(e);
    }, path);
    const dashFolder = () => admin.evaluate(async () => (await chrome.storage.local.get('dashboard')).dashboard.folder);
    await dropFolder('Selectiophile/看板/拖入');
    for (let i = 0; i < 30 && (await dashFolder()) !== '看板/拖入'; i++) await admin.waitForTimeout(50);
    assert.equal(await dashFolder(), '看板/拖入');
    for (let i = 0; i < 30 && (await admin.locator('#dashFolder').inputValue()) !== '看板/拖入'; i++) await admin.waitForTimeout(50);
    assert.equal(await admin.locator('#dashFolder').inputValue(), '看板/拖入');
    const dropped = () => admin.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      const dir = await (await root.getDirectoryHandle('看板')).getDirectoryHandle('拖入');
      return (await (await (await dir.getFileHandle('我的看板.md')).getFile()).text()).includes('dataview');
    }).catch(() => false);
    for (let i = 0; i < 40 && !(await dropped()); i++) await admin.waitForTimeout(100);
    assert.ok(await dropped(), 'the dashboard is written there');
    await dropFolder('别处');
    await admin.locator('#dashOut', { hasText: '别处 不在库 Selectiophile 里' }).waitFor({ timeout: 4000 });
    assert.equal(await dashFolder(), '看板/拖入', 'unchanged');
    await admin.locator('#dashFolder').fill('');
    await admin.locator('#dashFolder').press('Enter');
    for (let i = 0; i < 30 && (await dashFolder()) !== ''; i++) await admin.waitForTimeout(50);

    // Detection off: nothing comes back until asked.
    await admin.locator('#dashAuto').uncheck();
    await admin.waitForTimeout(150);
    await removeFile('我的看板.md');
    const before = await entryCount(NOTE);
    await page.bringToFront();
    await select('color7');
    await page.keyboard.press('Alt+KeyS');
    await waitForEntries(NOTE, before + 1);
    await page.waitForTimeout(200);
    assert.ok(!(await files()).includes('我的看板.md'), 'not recreated while detection is off');
    await admin.bringToFront();
    await admin.locator('#dashCreate').click();
    await waitForText('我的看板.md', 'dataview');

    await admin.locator('#dashAuto').check();
    await admin.locator('#dashName').fill('_dashboard');
    await admin.locator('#dashName').blur();
    await waitForText('_dashboard.md', 'dataview');
    await removeFile('我的看板.md');
    await page.bringToFront();
  });

  await check('a custom dashboard in the notes folder is never offered as a note', async () => {
    await admin.evaluate(() => chrome.storage.local.set({ dashboard: { auto: true, name: '我的看板' } }));
    await waitForText('我的看板.md', 'dataview');
    await page.locator('selectiophile-ui .fab').click();
    await page.locator('selectiophile-ui .panel .list .label').first().waitFor({ timeout: 4000 });
    assert.ok(!(await page.locator('selectiophile-ui .panel .list .label').allInnerTexts()).some((l) => l.includes('看板')));
    await page.keyboard.press('Escape');
    await admin.evaluate(async () => {
      await chrome.storage.local.set({ dashboard: { auto: true, name: '_dashboard' } });
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      await dir.removeEntry('我的看板.md');
    });
    await page.waitForTimeout(200);
  });

  await check('highlights of deleted notes clear in one step, also on open pages', async () => {
    await page.goto(`${origin}/doomed`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await select('d1');
    await page.keyboard.press('Alt+KeyS');
    const doomed = 'Curie(2001)-Doomed Paper.md';
    await waitForText(doomed, 'This note will be deleted');
    await page.waitForFunction(() => window.__lpRanges().length === 1, null, { timeout: 4000 });

    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('#scanOrphans').click();
    await admin.locator('#orphanOut', { hasText: '没有需要清除' }).waitFor({ timeout: 5000 });
    assert.equal(await admin.locator('#clearOrphans').isVisible(), false);

    await admin.evaluate(async (n) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Selectiophile');
      await dir.removeEntry(n);
    }, doomed);
    await admin.locator('#scanOrphans').click();
    await admin.locator('#orphanOut', { hasText: '发现 1 条' }).waitFor({ timeout: 5000 });
    if (shots) await admin.locator('#backupSection').screenshot({ path: join(shots, '33-orphans.png') });
    assert.equal(await page.evaluate(() => window.__lpRanges().length), 1, 'checking changes nothing');
    await admin.locator('#clearOrphans').click();
    await admin.locator('#orphanOut', { hasText: '已清除 1 条' }).waitFor({ timeout: 5000 });
    await page.waitForFunction(() => window.__lpRanges().length === 0, null, { timeout: 4000 });
    const { [`hl:${origin}/doomed`]: left } = await admin.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(left, {});
    assert.ok(await read(NOTE), 'other notes are untouched');
    await page.bringToFront();
  });

  await check('highlights can be turned off: the note still gets everything', async () => {
    await page.goto(`${origin}/paper`);
    await page.waitForFunction(() => window.__lpRanges().length >= 3, null, { timeout: 5000 });
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('#showHighlights').uncheck();
    await page.bringToFront();
    await page.waitForFunction(() => window.__lpRanges().length === 0, null, { timeout: 4000 });
    const count = await entryCount(NOTE);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="plain1">Saved without any page highlight.</p>'));
    await select('plain1');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('评论也写入');
    await page.keyboard.press('Control+Enter');
    await waitForText(NOTE, '- **Comments：** 评论也写入');
    assert.equal(await entryCount(NOTE), count + 1);
    assert.equal(await page.evaluate(() => window.__lpRanges().length), 0);
    const stored = (await admin.evaluate(() => chrome.storage.local.get(null)))[`hl:${origin}/paper`];
    assert.ok(!Object.values(stored).some((h) => (h.anchor || '').includes('Savedwithout')), 'no position is kept');
    await toast().locator('button', { hasText: '撤销' }).click();
    await toast().filter({ hasText: '已撤销' }).waitFor({ timeout: 4000 });
    assert.equal(await entryCount(NOTE), count);

    await admin.bringToFront();
    await admin.locator('#showHighlights').check();
    await page.bringToFront();
    await page.waitForFunction(() => window.__lpRanges().length >= 3, null, { timeout: 4000 });
  });

  await check('the auto-filing threshold in settings decides when to ask', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    const box = admin.locator('#autoSave');
    assert.equal(await box.inputValue(), '90');
    await box.fill('20');
    await box.blur();
    for (let i = 0; i < 20 && (await box.inputValue()) !== '50'; i++) await admin.waitForTimeout(50);
    assert.equal(await box.inputValue(), '50', 'kept within range');
    await page.bringToFront();
    await page.goto(`${origin}/paper`);
    await page.locator('selectiophile-ui .fab').waitFor({ timeout: 5000 });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="th1">First threshold sentence.</p><p id="th2">Second threshold sentence.</p>'));
    // The fake Jev answers 55% when the comment says unsure, which now clears the bar.
    await select('th1');
    await page.keyboard.press('Alt+KeyC');
    await page.locator('selectiophile-ui textarea').fill('unsure but fine');
    await page.keyboard.press('Control+Enter');
    await waitForText(NOTE, 'First threshold sentence');
    assert.equal(await page.locator('selectiophile-ui .panel').count(), 0, 'saved without asking');

    await admin.bringToFront();
    await box.fill('100');
    await box.blur();
    await admin.waitForTimeout(100);
    await page.bringToFront();
    await select('th2');
    await page.keyboard.press('Alt+KeyS');
    const panel = page.locator('selectiophile-ui .panel', { hasText: 'Jev 不太确定' });
    await panel.waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await admin.evaluate(() => chrome.storage.local.remove('autoSavePercent'));
    if (shots) {
      await admin.bringToFront();
      await admin.reload();
      await box.waitFor({ timeout: 4000 });
      await admin.locator('#jevSection').screenshot({ path: join(shots, '38-threshold.png') });
    }
    await page.bringToFront();
  });

  await check('the rounds setting decides how much of a conversation is read', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    assert.equal(await admin.locator('#rounds').inputValue(), '2');
    await admin.locator('#rounds').fill('1');
    await admin.locator('#rounds').blur();
    await admin.waitForTimeout(100);
    await page.bringToFront();
    await page.goto('https://chatgpt.com/c/rounds-one');
    await page.locator('selectiophile-ui').waitFor({ state: 'attached', timeout: 5000 });
    await page.evaluate(() => { document.getElementById('thread').innerHTML = '<div data-message-author-role="user">First question.</div><div data-message-author-role="assistant">First answer.</div><div data-message-author-role="user">Second question.</div><p id="r1">Passage in the chat.</p>'; });
    await page.waitForTimeout(150);
    await select('r1');
    await page.keyboard.press('Alt+KeyS');
    await toast().filter({ hasText: '讨论已存入' }).waitFor({ timeout: 5000 });
    const asked = await sw.evaluate(() => globalThis.__jevRequests.filter((r) => r.questions.note).at(-1));
    assert.match(asked.state.conversation_opening, /First answer/);
    assert.ok(!asked.state.conversation_opening.includes('Second question'));
    await admin.evaluate(() => chrome.storage.local.remove('discussionRounds'));
  });

  await check('a site on the list but never authorized says so and offers it again', async () => {
    await page.goto(`${origin}/paper`);
    const popup = await context.newPage();
    await popup.addInitScript(() => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async () => (await query({})).filter((t) => t.url?.includes('127.0.0.1')).slice(0, 1);
      const contains = chrome.permissions.contains.bind(chrome.permissions);
      chrome.permissions.contains = async (arg) => (arg.origins?.[0]?.includes('127.0.0.1') ? false : contains(arg));
    });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.locator('#toggleSite', { hasText: '授权这个网站' }).waitFor({ timeout: 4000 });
    assert.match(await popup.locator('#state').innerText(), /还没有授权/);
    await popup.close();
    await page.bringToFront();
  });

  await check('the floating pin can be hidden; pinning still works from the popup', async () => {
    await page.goto(`${origin}/paper`);
    const fab = page.locator('selectiophile-ui .fab');
    await fab.waitFor({ timeout: 5000 });
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    assert.equal(await admin.locator('#showFab').isChecked(), true, 'shown by default');
    await admin.locator('#showFab').uncheck();
    await fab.waitFor({ state: 'detached', timeout: 4000 });

    await page.reload();
    await page.locator('selectiophile-ui').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    assert.equal(await fab.count(), 0, 'stays hidden after a reload');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.locator('#pinRow').waitFor({ timeout: 4000 });
    await popup.locator('#pin').click();
    await popup.locator('#unpin').waitFor({ timeout: 4000 });
    const pinned = (await admin.evaluate(() => chrome.storage.local.get('settings'))).settings.pinned;
    assert.ok(pinned);
    await page.bringToFront();
    await page.waitForTimeout(200);
    assert.equal(await fab.count(), 0, 'pinning does not bring it back');
    const count = await entryCount(pinned);
    await select('color7');
    await page.keyboard.press('Alt+KeyS').catch(() => {});
    await waitForEntries(pinned, count).catch(() => {});
    await popup.bringToFront();
    await popup.locator('#unpin').click();
    await popup.locator('#pinRow').waitFor({ timeout: 4000 });
    await popup.close();

    await admin.bringToFront();
    await admin.locator('#showFab').check();
    await fab.waitFor({ timeout: 4000 });
    await page.bringToFront();
    await page.mouse.click(1000, 700);
  });

  await check('dashboard exists with a Dataview query', async () => {
    const md = await read('_dashboard.md');
    assert.ok(md.includes('```dataview') && md.includes('SORT last_annotated DESC'));
  });

  await check('the settings page fits phones, tablets and desktops', async () => {
    await admin.bringToFront();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.locator('.doc-type .rows li').first().waitFor({ timeout: 5000 });
    for (const [width, height] of [[375, 740], [768, 1000], [1280, 800]]) {
      await admin.setViewportSize({ width, height });
      await admin.waitForTimeout(150);
      const wide = await admin.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const nav = document.querySelector('.nav');
        return {
          page: document.documentElement.scrollWidth - limit,
          // What reaches past the right edge, apart from the scrolling row of links.
          out: [...document.querySelectorAll('body *')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width && r.right > limit + 1 && !el.closest('[hidden], .picker-list, .pick-list') && !nav.contains(el);
          }).map((el) => `${el.tagName.toLowerCase()}.${el.className}`).slice(0, 5),
        };
      });
      assert.deepEqual(wide.out, [], `nothing cut off at ${width}px`);
      assert.equal(wide.page, 0, `no sideways scrolling at ${width}px`);
      const navShown = await admin.locator('.nav a').first().isVisible();
      assert.ok(navShown, `the sections can be reached at ${width}px`);
      if (shots) await admin.screenshot({ path: join(shots, `67-options-${width}.png`), fullPage: width === 375 });
    }
    // On a phone the labels sit above their fields.
    await admin.setViewportSize({ width: 375, height: 740 });
    const [label, input] = await admin.evaluate(() => ['label[for="dashName"]', '#dashName'].map((q) => document.querySelector(q).getBoundingClientRect().top));
    assert.ok(label < input - 10, 'label above field');
    await admin.locator('.nav a[href="#docSection"]').click();
    await admin.waitForTimeout(600);
    const top = await admin.evaluate(() => document.getElementById('docSection').getBoundingClientRect().top);
    assert.ok(top >= 40 && top < 120, `the section starts below the bar of links (${top})`);
    await admin.setViewportSize({ width: 1100, height: 760 });
  });

  await check('extension pages render', async () => {
    await admin.reload();
    await admin.locator('#folder', { hasText: 'Selectiophile：已授权' }).waitFor({ timeout: 5000 });
    await admin.locator('#sites li').first().waitFor({ timeout: 4000 });
    await admin.locator('.color-row').nth(5).waitFor({ timeout: 4000 });
    await admin.bringToFront();
    if (shots) await admin.screenshot({ path: join(shots, '8-options.png'), fullPage: true });
    await admin.goto(`chrome-extension://${extId}/popup/popup.html`);
    await admin.locator('#recent li').first().waitFor({ timeout: 5000 });
    await admin.setViewportSize({ width: 360, height: 480 });
    if (shots) await admin.screenshot({ path: join(shots, '9-popup.png') });
    await admin.setViewportSize({ width: 1100, height: 760 });
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
  });

  await check('no uncaught page errors', async () => {
    assert.deepEqual(consoleErrors, []);
  });

  if (shots) console.log(`\nNote as written:\n${await read(NOTE)}`);
} finally {
  await context.close();
  server.close();
  await rm(extDir, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
