// Finishes a clipped original as an archive: the marks content/clip-prep.js left in
// the article become Obsidian links and block ids, and every paragraph gets a block id
// of its own, so a note can point to the very paragraph a highlight came from.
//
// A paragraph's id comes from its text (^p-1x2y3z), so clipping the page again gives
// it the same id and links to it keep working. Ids are never put on an image's line:
// plugins such as Local Images Plus rewrite those lines.

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const ANCHOR = /⟬A:([\w-]+)⟭/g;
const LINK = /⟬L:([\w-]+)⟭([\s\S]*?)⟬\/L⟭/g;
const HEADING_MARK = /⟬H:(\d+)⟭/g;
const BLOCK_ID_END = /\s\^([A-Za-z0-9-]+)\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/;
const IMAGE = /^\s*(?:!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>)\s*$/;
const DISPLAY_TAG = /\\tag\*?\{\s*([^}]+?)\s*\}/;

// HTML the converter keeps (sub, sup, tables) loses the page's attributes, which only
// matter to the page: classes, styles, Read Frog's marks.
const TAG = /<([A-Za-z][\w-]*)(\s[^<>]*?)?(\/?)>/g;
const KEPT_ATTRIBUTES = new Set(['href', 'src', 'alt', 'colspan', 'rowspan']);
function cleanTag(whole, name, attrs = '', close) {
  if (!attrs.trim()) return whole;
  const kept = [...attrs.matchAll(/([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)]
    .filter((m) => KEPT_ATTRIBUTES.has(m[1].toLowerCase()))
    .map((m) => (m[2] ? `${m[1]}=${m[2]}` : m[1]));
  return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${close}>`;
}

// Splits Markdown into blocks separated by blank lines, keeping fenced code and
// $$ formulas whole even when they hold blank lines.
function splitBlocks(text) {
  const blocks = [];
  let current = [];
  let fence = null;
  let math = false;
  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };
  for (const line of text.split('\n')) {
    if (fence) {
      current.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    const opener = line.trim().match(/^(```+|~~~+)/);
    if (opener) {
      fence = opener[1];
      current.push(line);
      continue;
    }
    const dollars = (line.match(/(?<!\\)\$\$/g) || []).length;
    if (!line.trim() && !math) {
      flush();
      continue;
    }
    // A heading is a block of its own, even with text right below it.
    if (!math && /^#{1,6}\s/.test(line)) {
      flush();
      blocks.push([line]);
      continue;
    }
    current.push(line);
    if (dollars % 2) math = !math;
  }
  flush();
  return blocks;
}

const isHeading = (lines) => lines.length === 1 && /^#{1,6}\s/.test(lines[0]);
const isTable = (lines) => lines.every((l) => /^\s*\|/.test(l));
const isMath = (lines) => /^\s*(?:>\s*)?\$\$/.test(lines[0]) && /\$\$\s*$/.test(lines[lines.length - 1]);
const isFence = (lines) => /^\s*(```|~~~)/.test(lines[0]);
const isRule = (lines) => lines.length === 1 && /^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[0]);
const isList = (lines) => LIST_ITEM.test(lines[0]);
const isImageOnly = (lines) => lines.every((l) => IMAGE.test(l) || !l.trim());
const ownId = (line) => (line.match(BLOCK_ID_END) || [])[1];

// Text compared whatever its markup, for paragraph ids.
const plain = (text) => String(text).normalize('NFKC').toLowerCase()
  .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[^\p{L}\p{N}]+/gu, '');

// Numbers as in "## 2\. Methods", escaped by the converter, and no-break spaces go.
const cleanHeading = (line) => line.replace(/^(#+ \d+(?:\.\d+)*)\\\./, '$1.').replace(/\u00a0/g, ' ').replace(/\s+$/, '');

// FNV-1a: short, and the same in every browser.
export function textHash(text) {
  let h = 0x811c9dc5;
  for (const ch of plain(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-6);
}

// A list block is a list of items, each of which takes a block id of its own.
function listItems(lines) {
  const indent = lines[0].match(LIST_ITEM)[1].length;
  const items = [];
  for (const line of lines) {
    const m = line.match(LIST_ITEM);
    if (m && m[1].length === indent) items.push([line]);
    else if (items.length) items[items.length - 1].push(line);
  }
  return items;
}

// Gives a block (or list item) the id `id` at the end of its last line, or, for a
// table or a formula, on a line of its own after it.
function withId(lines, id, separate) {
  if (separate) return [...lines, '', `^${id}`];
  const last = lines.length - 1;
  return [...lines.slice(0, last), `${lines[last].replace(/\s+$/, '')} ^${id}`];
}

// A display formula inside a paragraph stands as a block of its own, as it is shown,
// so it can take a block id.
function separateFormulas(text) {
  const lines = text.split('\n');
  const out = [];
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.trim() === '$$';
    if (fence && !open && out.length && out[out.length - 1].trim()) out.push('');
    out.push(line);
    if (fence) {
      open = !open;
      if (!open && lines[i + 1]?.trim()) out.push('');
    }
  }
  return out.join('\n');
}

export function finishArchive(markdown) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  const front = (text.match(FRONTMATTER) || [''])[0];
  const blocks = splitBlocks(separateFormulas(text.slice(front.length)));
  const used = new Set();
  const alias = new Map();
  const headings = new Map();

  // Block ids from the marks: the first mark in a block names it; others in the same
  // block point to it. A mark left alone in a block names the block before it.
  const units = [];
  for (const lines of blocks) {
    if (isList(lines) && !isTable(lines)) for (const item of listItems(lines)) units.push({ lines: item, item: true });
    else units.push({ lines, item: false });
    units[units.length - 1].blockEnd = true;
  }
  let previous = null;
  for (const unit of units) {
    const ids = [];
    unit.lines = unit.lines.map((l) => {
      const out = l.replace(ANCHOR, (_, id) => {
        ids.push(id);
        return '';
      });
      return out === l ? l : out.replace(/[ \t]+$/, '');
    });
    if (isHeading(unit.lines)) {
      unit.lines[0] = unit.lines[0].replace(HEADING_MARK, (_, n) => {
        headings.set(n, unit.lines[0]);
        return '';
      });
    }
    const empty = unit.lines.every((l) => !l.trim());
    const owner = empty ? previous : unit;
    if (!owner) continue;
    for (const id of ids) {
      if (used.has(id)) continue;
      if (owner.id) alias.set(id, owner.id);
      else owner.id = id;
      used.add(id);
    }
    if (empty) unit.drop = true;
    else previous = unit;
  }
  // Formulas numbered with \tag{n}: ^eqn.
  for (const unit of units) {
    if (unit.drop || unit.id || !isMath(unit.lines)) continue;
    const tag = unit.lines.join('\n').match(DISPLAY_TAG);
    const id = tag && `eq${tag[1].replace(/[^A-Za-z0-9-]+/g, '-')}`;
    if (id && !used.has(id)) {
      unit.id = id;
      used.add(id);
    }
  }
  const headingText = new Map([...headings].map(([n, line]) => [n, cleanHeading(line).replace(/^#+\s*/, '').replace(/⟬[^⟭]*⟭/g, '')
    .replace(/[#^|[\]]/g, ' ').replace(/\s+/g, ' ').trim()]));

  const resolve = (id, label, inTable) => {
    const shown = label.trim();
    let target = null;
    if (/^h\d+$/.test(id)) target = headingText.get(id.slice(1)) || null;
    else if (used.has(id)) target = `^${alias.get(id) || id}`;
    if (!target || !shown) return shown;
    return `[[#${target}${inTable ? '\\|' : '|'}${shown}]]`;
  };

  const out = [];
  const taken = new Set(used);
  for (const unit of units) {
    if (unit.drop) continue;
    let lines = unit.lines.map((l) => {
      const inTable = /^\s*\|/.test(l);
      return l.replace(LINK, (_, id, label) => resolve(id, label, inTable))
        // Links that lead nowhere outside the page (#…, or relative to a site) keep
        // their text only.
        .replace(/(?<!!)\[([^\]]*)\]\((?:#|\/(?!\/))[^)]*\)/g, '$1')
        .replace(/⟬[^⟭]*⟭/g, '')
        // Brackets left empty where a config removed the site's links ("[Google Scholar]").
        .replace(/\s*\\\[\\\]/g, '')
        .replace(TAG, cleanTag);
    });
    if (isHeading(lines)) lines = [cleanHeading(lines[0])];
    const separate = isTable(lines) || isMath(lines) || isFence(lines);
    let id = unit.id || ownId(lines[lines.length - 1]);
    if (!id && !isHeading(lines) && !separate && !isRule(lines) && !isImageOnly(lines) && !IMAGE.test(lines[lines.length - 1]) && plain(lines.join(' '))) {
      const base = `p-${textHash(lines.join('\n'))}`;
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      unit.id = id;
    }
    if (unit.id) {
      taken.add(unit.id);
      lines = withId(lines, unit.id, separate);
    }
    out.push({ text: lines.join('\n'), join: unit.item && !unit.blockEnd });
  }
  let body = '';
  out.forEach((part, i) => {
    body += part.text;
    if (i < out.length - 1) body += part.join && !/\n\^[\w-]+$/.test(part.text) ? '\n' : '\n\n';
  });
  return `${front}${body.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
}

// The blocks of a finished archive that carry an id, with their text for matching.
// The last archive's are kept, as one is asked about entry after entry.
let lastBlocks = { markdown: null, blocks: [] };
function idBlocks(markdown) {
  if (lastBlocks.markdown !== markdown) lastBlocks = { markdown, blocks: readIdBlocks(markdown) };
  return lastBlocks.blocks;
}
function readIdBlocks(markdown) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  const body = text.slice((text.match(FRONTMATTER) || [''])[0].length);
  const found = [];
  for (const lines of splitBlocks(body)) {
    const alone = lines.length === 1 && lines[0].match(/^\^([A-Za-z0-9-]+)$/);
    if (alone) {
      // A table's or a formula's id stands on the line after it.
      if (found.length && !found[found.length - 1].id) found[found.length - 1].id = alone[1];
      continue;
    }
    const units = isList(lines) && !isTable(lines) ? listItems(lines) : [lines];
    for (const unit of units) {
      const last = unit[unit.length - 1];
      const id = ownId(last) || null;
      const key = plain(unit.join(' ').replace(BLOCK_ID_END, ' '));
      found.push({ id, key });
    }
  }
  return found.filter((b) => b.id && b.key);
}

// Pieces of text compared with the archive: long enough to be told apart, short enough
// that a formula (shown as glyphs on the page, as LaTeX in the archive) spoils few.
const PIECE = 12;

// The block id of the paragraph a highlight's text comes from: where its start is, as
// a highlight may run on into the next paragraphs. Null when the archive doesn't hold it.
export function paragraphOf(markdown, text) {
  const want = plain(text);
  if (want.length < 4) return null;
  const blocks = idBlocks(markdown);
  for (const length of [want.length, 120, 60, 30, 15]) {
    if (length > want.length) continue;
    const head = want.slice(0, length);
    const hit = blocks.find((b) => b.key.includes(head));
    if (hit) return hit.id;
  }
  // A highlight running across paragraphs: the one that ends with its start, followed
  // by one that begins with the rest.
  const opening = want.slice(0, 6);
  for (let i = 0; i + 1 < blocks.length; i++) {
    const { key } = blocks[i];
    for (let at = key.indexOf(opening); at >= 0; at = key.indexOf(opening, at + 1)) {
      const k = key.length - at;
      if (k < want.length && want.startsWith(key.slice(at)) && blocks[i + 1].key.startsWith(want.slice(k, k + 15))) return blocks[i].id;
    }
  }
  // Else the paragraph holding most pieces of the text's start.
  const start = want.slice(0, PIECE * 10);
  const pieces = [];
  for (let i = 0; i + PIECE <= start.length; i += PIECE) pieces.push(start.slice(i, i + PIECE));
  if (!pieces.length) return null;
  let best = null;
  let score = 0;
  for (const b of blocks) {
    const n = pieces.filter((p) => b.key.includes(p)).length;
    if (n > score) [best, score] = [b, n];
  }
  return score >= Math.max(1, Math.ceil(pieces.length / 3)) ? best.id : null;
}
