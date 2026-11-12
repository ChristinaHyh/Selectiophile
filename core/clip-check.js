// Signs that a clipped original came out wrong. The usual cause is a site that changed
// its pages, so that its config no longer fits: the person is told, rather than
// finding out months later in the vault.
//
// `page` is what content/clip-prep.js counted on the page: formulas outside
// translations, and the steps of its preparation that failed.

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;
// $$…$$, or $…$ hugging its content and not followed by a digit (as a price would be).
// A formula left as MathML (inside an HTML table) counts too.
const FORMULA = /\$\$[\s\S]+?\$\$|(?<![\\$])\$(?=\S)[^$\n]+?(?<=\S)\$(?![\d$])|<math\b/g;
// Marks a config or the preparation uses on the way, which a finished clip never holds.
const LEFTOVER = /[⟦⟧⟪⟫⟬⟭]|<\/?(?:mjx-|cfix)|read-frog-|data-cfix/;

export const MIN_BODY_CHARS = 200;

// The parts of the page a config clips the article from: its `selectorHtml`s.
export function articleSelectors(template) {
  return [...String(template?.noteContentFormat || '').matchAll(/\{\{\s*selectorHtml:([^|}]+)/g)].map((m) => m[1].trim());
}

// Text compared whatever its markup: letters and digits only, so spacing, punctuation
// and Markdown don't count.
export const comparable = (text) => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The words of a clip as a reader sees them: no formulas (the page's rendering of
// them can't be compared), images, link targets, tags or block ids.
export function markdownText(markdown) {
  return String(markdown || '').replace(FRONTMATTER, '')
    .replace(FORMULA, ' ')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g, ' ')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|(nbsp|amp|lt|gt|quot|apos));/gi, (m, dec, hex, name) => (dec || hex
      ? String.fromCodePoint(parseInt(dec || hex, dec ? 10 : 16))
      : { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()]))
    .replace(/[ \t]\^[\w-]+$/gm, ' ');
}

// Blocks shorter than this (labels, numbers) say too little to look for.
export const MIN_BLOCK_CHARS = 12;
// What a clip may miss before it counts as incomplete: a label here and there.
export const MAX_MISSING_SHARE = 0.02;
const DUPLICATE_CHARS = 80;

// A block is looked for in pieces, so a figure link or an equation number the clip
// puts inside a paragraph doesn't hide it. It is there when nearly all pieces are.
const PIECE = 16;
const MIN_PRESENT = 0.8;
const pieces = (key) => {
  if (key.length <= PIECE) return [key];
  const out = [];
  for (let i = 0; i < key.length; i += PIECE) out.push(key.slice(i, i + PIECE));
  if (out.at(-1).length < PIECE / 2) out[out.length - 1] = key.slice(-PIECE);
  return out;
};

// How much of the page's article text is in the clip, and what is there twice.
// `blocks` is the page's text, block by block (content/clip-prep.js articleBlocks).
export function clipFidelity(markdown, blocks) {
  const text = comparable(markdownText(markdown));
  const seen = new Set();
  const wanted = [];
  for (const block of blocks || []) {
    const key = comparable(block);
    if (key.length >= MIN_BLOCK_CHARS && !seen.has(key)) {
      seen.add(key);
      wanted.push([key, block]);
    }
  }
  const missing = wanted.filter(([key]) => {
    const all = pieces(key);
    return all.filter((p) => text.includes(p)).length < all.length * MIN_PRESENT;
  }).map(([, block]) => block);
  // Paragraphs and images given twice.
  const body = String(markdown || '').replace(FRONTMATTER, '');
  const counts = new Map();
  for (const para of body.split(/\n\s*\n/)) {
    const image = para.trim().match(/^!\[\[([^\]|]+)|^!\[[^\]]*\]\(([^)]+)\)/);
    const key = image ? `image:${image[1] || image[2]}` : comparable(markdownText(para));
    if (image || key.length >= DUPLICATE_CHARS) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const twice = [...counts].filter(([, n]) => n > 1).map(([key]) => key);
  return { blocks: wanted.length, missing, duplicates: twice.length, twice };
}

// One line for the clip's `clip_check` property, so whoever reads the clip later,
// a person or an AI, knows how complete it was.
export function clipCheckLine(markdown, page = {}) {
  const parts = [];
  if (Array.isArray(page.blocks)) {
    const f = clipFidelity(markdown, page.blocks);
    parts.push(`text ${f.blocks - f.missing.length}/${f.blocks} blocks`, `duplicates ${f.duplicates}`);
  }
  if (page.formulas) parts.push(`formulas ${(String(markdown || '').replace(FRONTMATTER, '').match(FORMULA) || []).length}/${page.formulas}`);
  return parts.join(', ');
}

// What a clip's `clip_review` property says when it looks wrong, so an AI or a person
// reading it later knows to check it against the page (its `url`) before trusting it.
// Absent when nothing looked wrong.
export function clipReviewLine(problems = []) {
  const says = problems.map((p) => ({
    empty: () => 'body nearly empty',
    formulas: () => `formulas ${p.clip}/${p.page}`,
    leftovers: () => `unprocessed marks, e.g. "${p.sample}"`,
    prep: () => `page preparation failed (${p.steps.join(', ')})`,
    missing: () => `${p.missing} of ${p.blocks} page paragraphs missing, e.g. "${p.sample}"`,
    duplicates: () => `${p.count} repeated images or paragraphs`,
  })[p.code]?.()).filter(Boolean);
  return says.length ? `incomplete, check against the page: ${says.join('; ')}` : '';
}

export function clipProblems(markdown, page = {}) {
  const body = String(markdown || '').replace(FRONTMATTER, '');
  const problems = [];
  if (body.replace(/\s/g, '').length < MIN_BODY_CHARS) problems.push({ code: 'empty' });
  const formulas = (body.match(FORMULA) || []).length;
  if (page.formulas >= 2 && formulas < page.formulas / 2) problems.push({ code: 'formulas', page: page.formulas, clip: formulas });
  if (LEFTOVER.test(body)) problems.push({ code: 'leftovers', sample: body.match(new RegExp(`.{0,30}(?:${LEFTOVER.source}).{0,30}`))[0].trim() });
  if (page.failedSteps?.length) problems.push({ code: 'prep', steps: page.failedSteps });
  if (Array.isArray(page.blocks)) {
    const f = clipFidelity(markdown, page.blocks);
    if (f.blocks && f.missing.length > f.blocks * MAX_MISSING_SHARE) problems.push({ code: 'missing', blocks: f.blocks, missing: f.missing.length, sample: f.missing[0].slice(0, 60) });
    if (f.duplicates) problems.push({ code: 'duplicates', count: f.duplicates });
  }
  return problems;
}
