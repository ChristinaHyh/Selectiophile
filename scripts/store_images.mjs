#!/usr/bin/env node
// Renders the Chrome Web Store images with the real extension. Stand-ins: the browser's
// private file system replaces the chosen folder, Jev's answers are scripted, and the
// paper is made up.
//
// Usage: node scripts/store_images.mjs <dir with playwright installed> <output dir>

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const [harness, outDir] = process.argv.slice(2);
if (!harness || !outDir) throw new Error('Usage: store_images.mjs <playwright dir> <output dir>');
const { chromium } = createRequire(join(resolve(harness), 'x.js'))('playwright');
const root = new URL('..', import.meta.url).pathname;

const SENTENCES = {
  found: 'Participants who napped recalled 18% more new words after one week than those who stayed awake.',
  idea: 'Spacing the nap closer to the study session appeared to strengthen the effect.',
  limit: 'All participants were university students, so the effect may not hold for older adults.',
  unsure: 'Recall was measured with a written test rather than in conversation.',
};

const PAPER = `<!doctype html><html><head><title>Short Naps Improve Recall | Journal of Everyday Learning</title>
<meta name="citation_title" content="Short Naps Improve Recall of Newly Learned Vocabulary">
<meta property="og:title" content="Short Naps Improve Recall of Newly Learned Vocabulary"><meta property="og:site_name" content="Journal of Everyday Learning">
<meta name="citation_author" content="Amara Okafor"><meta name="citation_author" content="Lin Chen">
<meta name="citation_journal_title" content="Journal of Everyday Learning">
<meta name="citation_publication_date" content="2026/03/14"><meta name="citation_doi" content="10.5555/demo.2026.014">
<style>
  body { margin: 0; background: #fff; color: #23262f; font: 17px/1.75 Georgia, "Noto Serif", serif; }
  header { padding: 16px 64px; border-bottom: 1px solid #e8e6e1; font: 700 13px/1.4 Arial, sans-serif; letter-spacing: 2px; color: #4a4e5c; text-transform: uppercase; }
  main { max-width: 600px; margin: 0 0 0 64px; padding: 26px 0 40px; }
  h1 { font-size: 30px; line-height: 1.25; margin: 0 0 10px; }
  .by { font: 14px/1.5 Arial, sans-serif; color: #70747f; margin: 0 0 22px; }
  h2 { font: 700 14px/1.4 Arial, sans-serif; letter-spacing: 1.2px; text-transform: uppercase; color: #94613c; margin: 22px 0 6px; }
  p { margin: 0 0 12px; }
</style></head><body>
<header>Journal of Everyday Learning</header>
<main><h1>Short Naps Improve Recall of Newly Learned Vocabulary</h1>
<p class="by">Amara Okafor, Lin Chen · March 14, 2026</p>
<h2>Results</h2>
<p>We tested whether a 20-minute nap helps adults keep the words they studied that morning. ${SENTENCES.found} ${SENTENCES.idea}</p>
<h2>Discussion</h2>
<p>The gain held for both concrete and abstract words. ${SENTENCES.limit} ${SENTENCES.unsure} A follow-up with a wider age range would settle both questions.</p>
<p>Even so, a short rest is cheap to try, and most learners can fit it into an ordinary day without changing how they study.</p>
</main></body></html>`;

const COPY = {
  zh: {
    comment: '可以试试把复习安排在午睡之前',
    ideaColor: '灵感',
    commentButton: '评论',
    unsurePanel: 'Jev 不太确定',
    scenes: [
      ['选中就能划线', '六种颜色对应不同用途，点一下就存进笔记，不用离开正在读的页面'],
      ['评论写在引用下方', '当时的想法顺手记下，划线是引用，评论紧跟在它下面'],
      ['自动放到对应的标题下', '只由 AI 判断存到哪里，笔记内容原样写入，不经 AI 改写'],
      ['拿不准时才问你', '概率没到门槛就列出选项，按数字键选择；门槛可以自己设置'],
      ['按类别分流，原文一并入库', '论文和文章各用各的模板和文件夹；原文可自动剪藏成 Markdown，划线链接回原文段落'],
    ],
    noteLabel: '写入的笔记',
    subfolders: ['文献', '文献/2026', '文献/综述', '文章'],
    paperFolder: '文献/2026',
    articleFolder: '文章',
  },
  en: {
    comment: 'Worth trying: schedule review right before a nap',
    ideaColor: 'Idea',
    commentButton: 'Comment',
    unsurePanel: 'Jev isn',
    scenes: [
      ['Select to highlight', 'Six colors for six purposes. One click saves it to your note, and you stay on the page'],
      ['Comments sit under the quote', 'Write down the thought while you have it. The highlight is the quote, and your comment follows it'],
      ['Filed under the right heading', 'AI only decides where it goes. Your words are written as they are, never rewritten'],
      ['Asks only when unsure', 'Below your confidence threshold, it lists the options and you press a number key to pick'],
      ['Notes by type, originals alongside', 'Papers and articles get their own templates and folders; the page itself can be clipped to Markdown, each highlight linked to its paragraph'],
    ],
    noteLabel: 'The saved note',
    subfolders: ['Papers', 'Papers/2026', 'Papers/Reviews', 'Articles'],
    paperFolder: 'Papers/2026',
    articleFolder: 'Articles',
  },
};

const BACKGROUND = `radial-gradient(circle at 12% 0, rgba(255, 255, 255, .17), transparent 42%),
  radial-gradient(circle at 96% 96%, rgba(230, 184, 181, .22), transparent 42%),
  linear-gradient(150deg, #5f6c91 0%, #46527a 52%, #4b4668 100%)`;
const SANS = 'Inter, "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", Arial, sans-serif';
const SERIF = 'Georgia, "Noto Serif SC", "Noto Serif CJK SC", "Songti SC", serif';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(PAPER);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const temp = await mkdtemp(join(tmpdir(), 'selectiophile-store-'));
const extDir = join(temp, 'ext');
await cp(root, extDir, {
  recursive: true,
  filter: (p) => !/^(e2e|eval|scripts)(\/|$)/.test(relative(root, p)),
});
// The demo may touch its local page without a permission prompt.
const manifest = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('<all_urls>');
await writeFile(join(extDir, 'manifest.json'), JSON.stringify(manifest));

const VIEW = { width: 1024, height: 672 };

async function capture(lang) {
  const copy = COPY[lang];
  const context = await chromium.launchPersistentContext(join(temp, `profile-${lang}`), {
    channel: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    viewport: VIEW,
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  context.setDefaultTimeout(8000);
  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage))); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await sw.evaluate((l) => chrome.storage.local.set({ lang: l }), lang);

    const admin = await context.newPage();
    await admin.goto(`chrome-extension://${extId}/options/options.html`);
    await admin.evaluate(async ({ subfolders, paperFolder, articleFolder }) => {
      const { saveFolder } = await import('/core/handle.js');
      const opfs = await navigator.storage.getDirectory();
      const dir = await opfs.getDirectoryHandle('Reading', { create: true });
      for (const path of subfolders) {
        let at = dir;
        for (const part of path.split('/')) at = await at.getDirectoryHandle(part, { create: true });
      }
      await saveFolder(dir);
      await chrome.storage.local.set({
        sites: ['127.0.0.1'],
        jevKey: 'demo',
        templates: [
          { id: 'paper', sites: [], folder: paperFolder },
          { id: 'article', sites: ['blog.example.com/*', '*.example.org/posts/*'], folder: articleFolder },
        ],
      });
      const res = await chrome.runtime.sendMessage({ type: 'folder:ready' });
      if (!res.ok) throw new Error(res.error);
    }, copy);

    // Scripted Jev: each save names the heading it should land under.
    const scriptJev = (heading, sure = true) => sw.evaluate(({ heading, sure }) => {
      globalThis.__demo = { heading, sure };
      if (globalThis.__demoFaked) return;
      globalThis.__demoFaked = true;
      const real = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (!String(url).includes('api.typesafe.ai')) return real(url, options);
        const names = Object.keys(JSON.parse(options.body).questions.block.criteria);
        const { heading, sure } = globalThis.__demo;
        const probabilities = Object.fromEntries(names.map((n) => [n, 0]));
        probabilities[heading] = sure ? 0.97 : 0.54;
        const runnerUp = names.find((n) => n !== heading && n !== 'Others');
        probabilities[runnerUp] = sure ? 0.02 : 0.31;
        probabilities.Others = sure ? 0.01 : 0.15;
        return new Response(JSON.stringify({ model: 'demo', answers: { block: { type: 'choice', choice: heading, probabilities } } }), { status: 200 });
      };
    }, { heading, sure });

    const page = await context.newPage();
    await page.goto(`${origin}/paper`);
    await page.locator('selectiophile-ui').waitFor({ state: 'attached' });
    await page.locator('selectiophile-ui .fab').waitFor();

    const selectSentence = async (text) => {
      const point = await page.evaluate((wanted) => {
        const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const start = node.data.indexOf(wanted);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + wanted.length);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const box = range.getClientRects();
          const last = box[box.length - 1];
          return { x: last.right - 2, y: last.top + last.height / 2 };
        }
        throw new Error(`Not on the page: ${wanted}`);
      }, text);
      await page.evaluate(({ x, y }) => document.querySelector('main').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y })), point);
    };
    const toolbar = page.locator('selectiophile-ui .toolbar');
    const toast = page.locator('selectiophile-ui .toast');
    const clearSelection = () => page.evaluate(() => getSelection().removeAllRanges());
    const toastGone = () => toast.waitFor({ state: 'hidden', timeout: 30000 });
    const notePath = async () => admin.evaluate(async (folder) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Reading');
      for (const part of folder.split('/')) dir = await dir.getDirectoryHandle(part);
      for await (const [name, handle] of dir.entries()) {
        if (name.endsWith('.md')) return (await (await handle.getFile()).text());
      }
      return '';
    }, copy.paperFolder);
    const saved = async (count) => {
      for (let i = 0; i < 60; i++) {
        if (((await notePath()).match(/data-lp="/g) || []).length >= count) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`Expected ${count} entries`);
    };

    // A first highlight in another color, so the page isn't empty.
    await scriptJev('Main Findings');
    await selectSentence(SENTENCES.found);
    await toolbar.waitFor();
    await toolbar.locator('.dot-btn').nth(1).click();
    await saved(1);
    await toastGone();
    await clearSelection();

    // 1: the toolbar over a selection.
    await selectSentence(SENTENCES.limit);
    await toolbar.waitFor();
    await page.waitForTimeout(250);
    const shots = [await page.screenshot()];

    // 2: the comment box.
    await scriptJev('Ideas for My Research');
    await clearSelection();
    await page.waitForTimeout(250);
    await selectSentence(SENTENCES.idea);
    await toolbar.waitFor();
    await toolbar.locator('button', { hasText: copy.commentButton }).click();
    await page.locator('selectiophile-ui textarea').fill(copy.comment);
    await page.locator('selectiophile-ui .panel button', { hasText: copy.ideaColor }).click();
    await page.waitForTimeout(250);
    shots.push(await page.screenshot());
    await page.keyboard.press('Control+Enter');
    await saved(2);
    await toastGone();

    // 3: saved, next to the note it wrote.
    await scriptJev('Limitations of Experimental Design');
    await selectSentence(SENTENCES.limit);
    await toolbar.waitFor();
    await toolbar.locator('.dot-btn').nth(4).click();
    await saved(3);
    await toastGone();
    shots.push(await page.screenshot());
    const note = await notePath();

    // 4: Jev isn't sure, so the panel asks.
    await scriptJev('Limitations of Experimental Design', false);
    await selectSentence(SENTENCES.unsure);
    await toolbar.waitFor();
    await page.keyboard.press('Alt+KeyS');
    await page.locator('selectiophile-ui .panel .list button').first().waitFor();
    await page.waitForTimeout(250);
    shots.push(await page.screenshot());
    await page.keyboard.press('Escape');

    // 5: a document type in settings: its template, its folder and clipping the original.
    await admin.bringToFront();
    await admin.reload();
    const clip = admin.locator('.doc-type[data-type="paper"] .type-clip');
    await clip.waitFor();
    await clip.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24));
    await admin.waitForTimeout(250);
    shots.push(await admin.screenshot());
    return { shots, note };
  } finally {
    await context.close();
  }
}

// The note as written, leaving out the headings nothing was saved under.
function noteHtml(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const title = /^title: "?(.+?)"?$/m.exec(markdown)?.[1] || '';
  const blocks = [];
  let heading = null;
  for (const line of body.split('\n').map((l) => l.trim())) {
    if (/^#{1,6} /.test(line)) heading = line.replace(/^#+ /, '');
    else if (line.startsWith('> ') || line.startsWith('- ')) {
      if (heading) blocks.push(`<h3>${heading}</h3>`);
      heading = null;
      if (line.startsWith('> ')) blocks.push(`<blockquote>${line.slice(2)}</blockquote>`);
      // A link to the clipped original shows as Obsidian shows it.
      else blocks.push(`<ul><li>${line.slice(2).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '<a>$1</a>')}</li></ul>`);
    }
  }
  return `<h2>${title}</h2>${blocks.join('')}`;
}

const dataUri = (png) => `data:image/png;base64,${png.toString('base64')}`;

function scenePage({ title, subtitle, shot, overlay = '' }) {
  return `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 800px; overflow: hidden; position: relative; background: ${BACKGROUND}; color: #fff; font-family: ${SANS}; }
  h1 { margin: 0; padding-top: 28px; text-align: center; font: 700 34px/1.3 ${SERIF}; }
  .sub { margin: 8px 0 0; text-align: center; font-size: 17px; line-height: 1.5; color: rgba(255, 255, 255, .86); }
  .window { position: absolute; left: 128px; top: 128px; width: 1024px; height: 700px; border-radius: 14px 14px 0 0; overflow: hidden; background: #fff; box-shadow: 0 24px 70px rgba(25, 28, 50, .42); }
  .bar { height: 26px; padding: 7px 14px; display: flex; gap: 7px; background: #ece9e4; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #cfccc6; }
  .window img { display: block; width: 1024px; height: 672px; }
  .note { position: absolute; right: 56px; top: 150px; width: 418px; height: 650px; padding: 18px 22px; overflow: hidden; border: 1px solid #e7e4eb; border-bottom: 0; border-radius: 16px 16px 0 0; background: #fffdfb; color: #30374b; box-shadow: 0 20px 55px rgba(25, 28, 50, .32); font-size: 13.5px; line-height: 1.6; }
  .note .label { font-size: 11px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: #787d90; }
  .note h2 { margin: 6px 0 4px; font: 400 19px/1.3 ${SERIF}; }
  .note h3 { margin: 14px 0 6px; font-size: 14.5px; font-weight: 700; }
  .note blockquote { margin: 0 0 8px; padding: 2px 0 2px 12px; border-left: 3px solid #c9c6d6; color: #555b70; }
  .note ul { margin: 0 0 6px; padding-left: 18px; }
  .note sup { font-size: 10.5px; color: #787d90; }
  .note sup a { color: #5d6a8f; }
  .note li a { color: #5d6a8f; text-decoration: underline; text-underline-offset: 2px; }
</style>
<h1>${title}</h1><p class="sub">${subtitle}</p>
<div class="window"><div class="bar"><i></i><i></i><i></i></div><img src="${dataUri(shot)}"></div>${overlay}`;
}

const composer = await chromium.launch();

async function render(html, { width, height }, path, transparent = false) {
  const page = await composer.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path, omitBackground: transparent });
  await page.close();
  console.log(path);
}

const icon = await readFile(join(root, 'icons/icon.svg'), 'utf8');
const images = resolve(outDir);
await rm(images, { recursive: true, force: true });

const LAYOUT = `* { box-sizing: border-box; } body { margin: 0; overflow: hidden; color: #fff; background: ${BACKGROUND}; font-family: ${SANS}; }`;

try {
  for (const lang of ['zh', 'en']) {
    const { shots, note } = await capture(lang);
    const dir = join(images, `screenshots-${lang}`);
    await mkdir(dir, { recursive: true });
    const names = ['01-highlight', '02-comment', '03-saved-note', '04-asks', '05-types'];
    for (const [i, name] of names.entries()) {
      const [title, subtitle] = COPY[lang].scenes[i];
      const overlay = name === '03-saved-note'
        ? `<div class="note"><div class="label">${COPY[lang].noteLabel}</div>${noteHtml(note)}</div>`
        : '';
      await render(scenePage({ title, subtitle, shot: shots[i], overlay }), { width: 1280, height: 800 }, join(dir, `${name}.png`));
    }
  }

  await render(`<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; } body { width: 128px; height: 128px; padding: 16px; background: transparent; } svg { display: block; width: 96px; height: 96px; }
  </style>${icon}`, { width: 128, height: 128 }, join(images, 'store-icon-128.png'), true);

  await render(`<!doctype html><meta charset="utf-8"><style>${LAYOUT}
    body { width: 440px; height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    svg { width: 92px; height: 92px; filter: drop-shadow(0 10px 22px rgba(25, 28, 50, .35)); }
    h1 { margin: 12px 0 0; font: 700 36px/1.2 ${SERIF}; }
    p { margin: 8px 0 0; font-size: 13px; letter-spacing: 3px; color: rgba(255, 255, 255, .85); }
  </style>${icon}<h1>Selectiophile</h1><p>HIGHLIGHT · COMMENT · CLIP</p>`, { width: 440, height: 280 }, join(images, 'promo-small-440x280.png'));

  await render(`<!doctype html><meta charset="utf-8"><style>${LAYOUT}
    body { width: 1400px; height: 560px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    svg { width: 150px; height: 150px; filter: drop-shadow(0 16px 34px rgba(25, 28, 50, .35)); }
    h1 { margin: 20px 0 0; font: 700 66px/1.15 ${SERIF}; }
    p { margin: 14px 0 0; font-size: 22px; letter-spacing: 1px; color: rgba(255, 255, 255, .88); }
  </style>${icon}<h1>Selectiophile</h1><p>Highlight the web. File it in your notes, and keep the original.</p>`, { width: 1400, height: 560 }, join(images, 'promo-marquee-1400x560.png'));
} finally {
  await composer.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
