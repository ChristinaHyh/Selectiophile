// Pure Markdown operations for Selectiophile notes. No browser or Node APIs, so the
// same file runs in the extension and under `node --test`.

import { colorById } from './colors.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

const eolOf = (md) => (md.includes('\r\n') ? '\r\n' : '\n');
const toLines = (md) => md.split(/\r?\n/);
const isBlank = (line) => line.trim() === '';

export const normalizeHeading = (text) =>
  text.trim().replace(/[:：\s]+$/, '').replace(/\s+/g, ' ').toLowerCase();

function frontmatterEnd(lines) {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}

export function parseHeadings(md) {
  const lines = toLines(md);
  const headings = [];
  let fence = null;
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const atx = line.match(ATX);
    if (atx) {
      headings.push({ line: i, level: atx[1].length, text: (atx[2] || '').trim() });
      continue;
    }
    const prev = lines[i - 1];
    const setext = line.match(SETEXT);
    const prevIsText = prev !== undefined && !isBlank(prev) && !prev.match(ATX) && !prev.match(THEMATIC)
      && !/^ {0,3}>/.test(prev) && i - 1 >= frontmatterEnd(lines);
    if (setext && prevIsText) {
      headings.push({ line: i - 1, level: setext[1][0] === '=' ? 1 : 2, text: prev.trim() });
    }
  }
  return headings;
}

export class NoteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Returns the line index to insert at: right after the section's last content
// line, so trailing blank lines and a closing `---` stay below the new entry.
function insertionIndex(lines, headings, target) {
  const wanted = normalizeHeading(target);
  const matches = headings.filter((h) => normalizeHeading(h.text) === wanted);
  if (matches.length === 0) throw new NoteError('heading_missing', `Heading not found: ${target}`);
  if (matches.length > 1) throw new NoteError('heading_ambiguous', `Heading is not unique: ${target}`);
  const heading = matches[0];
  const next = headings.find((h) => h.line > heading.line && h.level <= heading.level);
  let end = next ? next.line : lines.length;
  const firstBody = heading.line + (lines[heading.line + 1]?.match(SETEXT) ? 2 : 1);
  while (end > firstBody && (isBlank(lines[end - 1]) || THEMATIC.test(lines[end - 1]))) end--;
  return end;
}

// A quote or comment must not be able to change the note's structure.
function neutralize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/%%/g, '% %')
    .split('\n')
    .map((line) => {
      if (/^ {0,3}#{1,6}(\s|$)/.test(line)) return line.replace('#', '\\#');
      if (FENCE.test(line)) return line.replace(/[`~]/, '\\$&');
      if (THEMATIC.test(line) || /^ {0,3}=+[ \t]*$/.test(line)) return `\\${line.trimStart()}`;
      return line;
    })
    .join('\n')
    .trim();
}

function encodeFragmentPart(text) {
  return encodeURIComponent(text).replace(/-/g, '%2D');
}

// Scroll-to-text link. Long quotes use the `start,end` form to keep the URL short.
export function textFragmentUrl(url, quote) {
  const clean = url.replace(/:~:.*$/, '').replace(/#$/, '');
  const words = quote.trim().split(/\s+/).filter(Boolean);
  const singleLine = words.join(' ');
  const fragment = singleLine.length <= 80 && !quote.includes('\n')
    ? encodeFragmentPart(singleLine)
    : `${encodeFragmentPart(words.slice(0, 5).join(' '))},${encodeFragmentPart(words.slice(-5).join(' '))}`;
  const joined = clean.includes('#') ? `${clean}:~:text=${fragment}` : `${clean}#:~:text=${fragment}`;
  return joined.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// `exact` is the page's own text, which the link must match; `quote` may differ
// because formulas are rewritten as `$...$`.
const blockquote = (text) => text.split('\n').map((line) => (line.trim() ? `> ${line}` : '>'));

// So a `<` in the text can't start an HTML tag, or pass for this entry's own link.
const escapeAngle = (text) => text.replace(/</g, '\\<');

// Numbered citations such as `[12]` or `[1-3]` are noise in a note. Formulas keep
// their brackets, and the link back to the page still uses the page's exact text.
const CITATION = /\s*\[\s*\d+(?:\s*[,，;；\-–—]\s*\d+)*\s*\]/g;

export function stripCitations(text) {
  const stripped = text.split(/(\$[^$]*\$)/).map((part, i) => (i % 2 ? part : part.replace(CITATION, ''))).join('');
  return stripped.trim() ? stripped : text;
}

// The link carries the entry's id, the one thing a note must hold for undo and moves.
// Highlight position and color stay in the plugin. The title shows the date on hover.
function entryLink({ id, url, quote, exact, date, discussion, purpose, lang }) {
  const target = discussion ? url.replace(/\(/g, '%28').replace(/\)/g, '%29') : textFragmentUrl(url, exact || quote);
  const href = target.replace(/&/g, '&amp;').replace(/"/g, '%22');
  const label = discussion || (lang === 'en' ? 'Source' : '原文');
  const prefix = purpose ? `${escapeAngle(purpose)} · ` : '';
  return `<sup>${prefix}<a href="${href}" data-lp="${id}" title="${date}">${label}</a></sup>`;
}

const colorBlock = (color) => `<span style="color:${colorById(color).solid}">■</span>`;

function commentLines(comment, lang) {
  const [first, ...rest] = escapeAngle(neutralize(comment)).split('\n');
  return [`- **Comments${lang === 'en' ? ':' : '：'}** ${first}`, ...rest.map((line) => (line.trim() ? `  ${line}` : ''))];
}

// A discussion's link says it came from a chat, so AI text is never mistaken for the
// paper's words. It has no text fragment: long chats load lazily.
export function formatEntry({ id, quote, exact, comment = '', url, date, discussion = '', purpose = '', color, lang = 'zh' }) {
  const lines = blockquote(escapeAngle(stripCitations(neutralize(quote))));
  lines[0] = lines[0].replace(/^> /, `> ${colorBlock(color)} `);
  lines[lines.length - 1] += ` ${entryLink({ id, url, quote, exact, date, discussion, purpose, lang })}`;
  if (comment.trim()) lines.push('', ...commentLines(comment, lang));
  return lines;
}

const OLD_SOURCE_LINE = /^(> — \[.*\]\(.*\) · \d{4}-\d{2}-\d{2})(?: · .*)?$/;
const PURPOSE_PREFIX = /<sup>(?:(?!<a ).)*(?=<a )/;

const COLOR_BLOCK = /^> <span style="color:[^"]*">■<\/span> /;

// The color block and purpose are what a note shows of a highlight's color.
export function setEntryStyle(md, id, { color, purpose = '' }) {
  const eol = eolOf(md);
  const lines = toLines(md);
  const { start, end } = entryRange(lines, id);
  const prefix = purpose ? `${escapeAngle(purpose)} · ` : '';
  const pattern = anchorPattern(id);
  for (let i = start; i <= end; i++) {
    if (pattern.test(lines[i])) {
      lines[i] = lines[i].replace(PURPOSE_PREFIX, `<sup>${prefix}`);
      const block = `> ${colorBlock(color)} `;
      lines[start] = COLOR_BLOCK.test(lines[start]) ? lines[start].replace(COLOR_BLOCK, block) : lines[start].replace(/^> /, block);
    } else {
      const old = lines[i].match(OLD_SOURCE_LINE);
      if (old) lines[i] = purpose ? `${old[1]} · ${purpose}` : old[1];
    }
  }
  return lines.join(eol);
}

const COMMENT_PREFIX = /^- \*\*Comments[：:]\*\*/;

// Lines of the Comments item in an entry, or null if it has none.
function commentSpan(lines, id) {
  const { start, end } = entryRange(lines, id);
  for (let i = start; i <= end; i++) if (COMMENT_PREFIX.test(lines[i])) return { start: i, end };
  return null;
}

// Earlier versions wrote comments in other shapes, which these helpers don't parse.
const isLegacyEntry = (lines, id) => lines.some((l) => l.trim() === oldMarker(id));

const restoreEscapes = (line) => line.replace(/^\\(?=[#`~=*_-])/, '').replace(/\\</g, '<');

// The comment as the reader typed it, for editing. Null means an older entry format.
export function readComment(md, id) {
  const lines = toLines(md);
  if (isLegacyEntry(lines, id)) return null;
  const span = commentSpan(lines, id);
  if (!span) return '';
  return lines.slice(span.start, span.end + 1)
    .map((line, i) => (i === 0 ? line.replace(COMMENT_PREFIX, '').trimStart() : line.replace(/^ {2}/, '')))
    .map(restoreEscapes)
    .join('\n')
    .trim();
}

// Adds, replaces or, given empty text, removes an entry's comment.
export function setEntryComment(md, id, comment, lang = 'zh') {
  const eol = eolOf(md);
  const lines = toLines(md);
  if (isLegacyEntry(lines, id)) throw new NoteError('entry_legacy', `Entry is in an old format: ${id}`);
  const span = commentSpan(lines, id);
  const text = comment.trim();
  if (span) {
    const from = isBlank(lines[span.start - 1] ?? 'x') ? span.start - 1 : span.start;
    lines.splice(from, span.end - from + 1, ...(text ? ['', ...commentLines(text, lang)] : []));
  } else if (text) {
    const { end } = entryRange(lines, id);
    lines.splice(end + 1, 0, '', ...commentLines(text, lang));
  }
  return lines.join(eol);
}

function insertLines(md, heading, entryLines) {
  const eol = eolOf(md);
  const lines = toLines(md);
  const at = insertionIndex(lines, parseHeadings(md), heading);
  const after = lines.slice(at);
  const needsTrailingBlank = after.length > 0 && !isBlank(after[0]);
  return [...lines.slice(0, at), '', ...entryLines, ...(needsTrailingBlank ? [''] : []), ...after].join(eol);
}

export const insertEntry = (md, heading, entry) => insertLines(md, heading, formatEntry(entry));

// The heading an entry currently sits under, which may have changed by hand.
export function headingOfEntry(md, id) {
  if (!hasEntry(md, id)) return '';
  const { start } = entryRange(toLines(md), id);
  return parseHeadings(md).filter((h) => h.line < start).at(-1)?.text || '';
}

export const noteBody = (md) => {
  const lines = toLines(md);
  return lines.slice(frontmatterEnd(lines)).join('\n').trim();
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text in a note can't match: its `<` is escaped when written.
const anchorPattern = (id) => new RegExp(`(?<!\\\\)<a [^>]*data-lp="${escapeRegExp(id)}"`);
const ANY_ANCHOR = /(?<!\\)<a [^>]*data-lp="/;
const oldMarker = (id) => `%% lp:${id} %%`;

export const hasEntry = (md, id) => {
  const pattern = anchorPattern(id);
  return toLines(md).some((l) => pattern.test(l) || l.trim() === oldMarker(id));
};

// Where in the clipped original an entry's text is, as `original#^block`: an attribute
// on the entry's link, so nothing shows in the note. Unchanged text comes back as is.
const CLIP_ATTR = / data-clip="[^"]*"/;
export function setEntryClip(md, id, target) {
  const pattern = new RegExp(`((?<!\\\\)<a [^>]*data-lp="${escapeRegExp(id)}")([^>]*>)`);
  const value = String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const lines = toLines(md);
  const at = lines.findIndex((l) => pattern.test(l));
  if (at < 0) return md;
  lines[at] = lines[at].replace(pattern, (_, start, rest) => `${start} data-clip="${value}"${rest.replace(CLIP_ATTR, '')}`);
  return lines.join(eolOf(md));
}

export function entryClip(md, id) {
  const line = toLines(md).find((l) => anchorPattern(id).test(l));
  const m = line && line.match(new RegExp(`data-lp="${escapeRegExp(id)}"[^>]*?data-clip="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
}

export const countEntries = (md) => toLines(md).filter((l) => ANY_ANCHOR.test(l) || /^%% lp:\S+ %%$/.test(l.trim())).length;

// An entry is the blockquote holding its link, plus the Comments item right after it.
// Anything else stays out, so text written by hand nearby is never touched.
function entryRange(lines, id) {
  const marker = lines.findIndex((l) => l.trim() === oldMarker(id));
  if (marker >= 0) {
    const relativeEnd = lines.slice(marker).findIndex((l) => l.trim() === '%% /lp %%');
    if (relativeEnd < 0) throw new NoteError('entry_damaged', `Entry has no end marker: ${id}`);
    return { start: marker, end: marker + relativeEnd };
  }
  const pattern = anchorPattern(id);
  const at = lines.findIndex((l) => pattern.test(l));
  if (at < 0) throw new NoteError('entry_missing', `Entry not found: ${id}`);
  let start = at;
  while (start > 0 && lines[start - 1].startsWith('>')) start--;
  let end = at;
  while (lines[end + 1]?.startsWith('>')) end++;
  let next = end + 1;
  while (next < lines.length && isBlank(lines[next])) next++;
  if (/^- \*\*Comments[：:]\*\*/.test(lines[next] || '')) {
    end = next;
    for (let i = next + 1; i < lines.length; i++) {
      if (isBlank(lines[i])) continue;
      if (!/^\s+\S/.test(lines[i])) break;
      end = i;
    }
  }
  return { start, end };
}

export function removeEntry(md, id) {
  const eol = eolOf(md);
  const lines = toLines(md);
  const { start, end } = entryRange(lines, id);
  const from = isBlank(lines[start - 1] ?? 'x') ? start - 1 : start;
  lines.splice(from, end - from + 1);
  return lines.join(eol);
}

// The entry's current lines, so a comment edited in Obsidian survives a move.
export function extractEntry(md, id) {
  const lines = toLines(md);
  const { start, end } = entryRange(lines, id);
  return lines.slice(start, end + 1);
}

export const insertEntryLines = insertLines;

export function moveEntry(md, id, heading) {
  return insertLines(removeEntry(md, id), heading, extractEntry(md, id));
}

// The section listing the note's clipped originals, as links. It holds no highlights.
export const REFERENCES_HEADING = 'References';
const isReferences = (h) => normalizeHeading(h.text) === normalizeHeading(REFERENCES_HEADING);

// Headings with no subheading below them: the blocks an entry can go into.
export function leafHeadings(md) {
  const headings = parseHeadings(md);
  return headings
    .filter((h, i) => !(headings[i + 1] && headings[i + 1].level > h.level) && !isReferences(h))
    .map((h) => h.text);
}

// Adds `- [[name]]` to the References section, after what is there; a note made from
// an older template gets the section at its end. A link already there stays one.
export function addReferenceLink(md, name) {
  const eol = eolOf(md);
  const lines = toLines(md);
  const link = `[[${name}]]`;
  const item = `- ${link}`;
  const headings = parseHeadings(md);
  const at = headings.findIndex(isReferences);
  if (at < 0) {
    const body = lines.slice(0, lines.length);
    while (body.length && isBlank(body[body.length - 1])) body.pop();
    return [...body, '', `# ${REFERENCES_HEADING}`, '', item, ''].join(eol);
  }
  const heading = headings[at];
  const next = headings.slice(at + 1).find((h) => h.level <= heading.level);
  const end = next ? next.line : lines.length;
  if (lines.slice(heading.line + 1, end).some((l) => l.includes(link) || l.includes(`[[${name}|`))) return md;
  // After the section's last line of content, a closing rule (---) aside.
  let last = heading.line;
  for (let i = heading.line + 1; i < end; i++) if (!isBlank(lines[i]) && !THEMATIC.test(lines[i])) last = i;
  const add = last === heading.line ? ['', item] : [item];
  if (next && last + 1 === end) add.push('');
  lines.splice(last + 1, 0, ...add);
  return lines.join(eol);
}

// The notes a frontmatter property links, in order, whether written inline or as a
// list with one item per line.
export function frontmatterLinks(md, field) {
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  if (!end) return [];
  const at = lines.slice(1, end - 1).findIndex((l) => l.startsWith(`${field}:`)) + 1;
  if (!at) return [];
  let last = at;
  while (last + 1 < end - 1 && /^\s+-/.test(lines[last + 1])) last++;
  const text = lines.slice(at, last + 1).join('\n').slice(field.length + 1);
  return [...new Set([...text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim()))];
}

// Takes a one-line property out of the frontmatter, if it is there.
export function removeFrontmatterField(md, key) {
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  if (!end) return md;
  const at = lines.slice(1, end - 1).findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return md;
  lines.splice(at + 1, 1);
  return lines.join(eolOf(md));
}

// Gives a frontmatter property a new name, keeping its value, unless one by the new
// name is there already.
export function renameFrontmatterField(md, from, to) {
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  if (!end) return md;
  const inside = lines.slice(1, end - 1);
  const at = inside.findIndex((l) => l.startsWith(`${from}:`));
  if (at < 0 || inside.some((l) => l.startsWith(`${to}:`))) return md;
  lines[at + 1] = `${to}:${lines[at + 1].slice(from.length + 1)}`;
  return lines.join(eolOf(md));
}

// Edits one frontmatter line in place so the rest of the YAML is never reformatted.
export function setFrontmatterField(md, key, value) {
  const eol = eolOf(md);
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  if (!end) throw new NoteError('frontmatter_missing', 'Note has no frontmatter');
  const prefix = `${key}:`;
  const line = value === '' ? prefix : `${prefix} ${value}`;
  const existing = lines.slice(1, end - 1).findIndex((l) => l.startsWith(prefix));
  if (existing >= 0) lines[existing + 1] = line;
  else lines.splice(end - 1, 0, line);
  return lines.join(eol);
}

export function readFrontmatter(md) {
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  const fields = {};
  for (const line of lines.slice(1, Math.max(end - 1, 1))) {
    const m = line.match(/^([^:#\s][^:]*):\s*(.*)$/);
    if (m) fields[m[1].trim()] = parseScalar(m[2].trim());
  }
  return fields;
}

function parseScalar(raw) {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  }
  return raw.replace(/^'(.*)'$/, '$1');
}

const yamlString = (text) => JSON.stringify(text);

export function normalizeDate(raw) {
  const m = String(raw || '').match(/(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/);
  if (!m) return '';
  return [m[1], m[2]?.padStart(2, '0'), m[3]?.padStart(2, '0')].filter(Boolean).join('-');
}

const FIELD_ORDER = ['title', 'authors', 'author', 'journal', 'site', 'published', 'doi', 'paper_id', 'url', 'references', 'comments', 'keywords', 'tags', 'created', 'last_annotated'];

// What a note is, then where it's from, then when. Other fields keep their order after these.
export function sortFrontmatter(md) {
  const eol = eolOf(md);
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  if (!end) return md;
  const fields = [];
  for (const line of lines.slice(1, end - 1)) {
    if (/^[^\s#-][^:]*:/.test(line) || !fields.length) fields.push([line]);
    else fields[fields.length - 1].push(line);
  }
  const rank = (field) => {
    const at = FIELD_ORDER.indexOf(field[0].split(':')[0].trim());
    return at < 0 ? FIELD_ORDER.length : at;
  };
  const sorted = fields.map((field, i) => [field, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).flatMap(([field]) => field);
  return [lines[0], ...sorted, ...lines.slice(end - 1)].join(eol);
}

// A property is one line: a page whose title holds a line break (as ACS's citation_title
// can) would otherwise put a newline into the value.
const oneLine = (text) => String(text).replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, ' ');

// A value from a Clipper config, written as its declared type.
function propertyValue({ value, type }) {
  if (type === 'multitext') return `[${[value].flat().map((v) => yamlString(oneLine(v))).join(', ')}]`;
  const text = oneLine([value].flat().join(', '));
  if (type === 'date') return normalizeDate(text) || yamlString(text);
  if (type === 'number' && !Number.isNaN(Number(text))) return text;
  return yamlString(text);
}

export function instantiateTemplate(template, meta) {
  let md = template;
  if (meta.title) md = setFrontmatterField(md, 'title', yamlString(oneLine(meta.title)));
  if (meta.isPaper === false) {
    if (meta.authors?.length) md = setFrontmatterField(md, 'author', yamlString(meta.authors.join(', ')));
    if (meta.site) md = setFrontmatterField(md, 'site', yamlString(meta.site));
  } else {
    if (meta.authors?.length) md = setFrontmatterField(md, 'authors', `[${meta.authors.map(yamlString).join(', ')}]`);
    if (meta.journal) md = setFrontmatterField(md, 'journal', yamlString(meta.journal));
  }
  if (meta.published) md = setFrontmatterField(md, 'published', normalizeDate(meta.published));
  if (meta.doi) md = setFrontmatterField(md, 'doi', yamlString(meta.doi));
  if (meta.url) md = setFrontmatterField(md, 'url', yamlString(meta.url));
  for (const [name, property] of Object.entries(meta.properties || {})) {
    // The page's address is already in `url`, and configs often repeat it as `source`.
    if (name !== 'source') md = setFrontmatterField(md, name, propertyValue(property));
  }
  return md;
}

// Adds `[[name]]` to a frontmatter field, keeping any links already there, so a note
// on several sources can link each of them.
export function addFrontmatterLink(md, field, name) {
  const link = `[[${name}]]`;
  const lines = toLines(md);
  const end = frontmatterEnd(lines);
  if (!end) throw new NoteError('frontmatter_missing', 'Note has no frontmatter');
  const at = lines.slice(1, end - 1).findIndex((l) => l.startsWith(`${field}:`)) + 1;
  const current = at ? lines[at].slice(field.length + 1).trim() : '';
  if (current.includes(link)) return md;
  // A list written one item per line grows by one more item.
  let last = at;
  while (at && !current && last + 1 < end - 1 && /^\s+-/.test(lines[last + 1])) last++;
  if (last > at) {
    if (lines.slice(at + 1, last + 1).some((l) => l.includes(link))) return md;
    lines.splice(last + 1, 0, `${lines[last].match(/^\s+/)[0]}- ${yamlString(link)}`);
    return lines.join(eolOf(md));
  }
  if (!current) return setFrontmatterField(md, field, yamlString(link));
  const existing = current.startsWith('[') && !current.startsWith('[[') ? current.slice(1, -1).trim() : current;
  return setFrontmatterField(md, field, `[${existing}, ${yamlString(link)}]`);
}

const ARTICLE_NAME_LIMIT = 80;

const STOP_WORDS = new Set(
  'a an and as at by for from in into of on or the to with via using based towards toward is are its their'.split(' '),
);

export function surname(author) {
  const name = String(author || '').trim();
  if (!name) return '';
  if (name.includes(',')) return name.split(',')[0].trim();
  if (/[㐀-鿿]/.test(name)) return name;
  return name.split(/\s+/).pop();
}

// Deterministic, because Jev cannot generate text: the first content words of an
// English title, or the leading characters of a CJK one.
export function abbreviateTitle(title, { maxWords = 5, maxCjk = 12 } = {}) {
  const clean = String(title || '').trim().replace(/[:：].*$/, (rest) => (rest.length === title.trim().length ? rest : ''));
  if (/[㐀-鿿]/.test(clean)) return clean.replace(/\s+/g, '').slice(0, maxCjk);
  const words = clean.split(/\s+/).filter(Boolean);
  const content = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  return (content.length ? content : words).slice(0, maxWords).join(' ');
}

const sanitizeFileName = (name) =>
  name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');

// `第一作者(年份)-标题缩写`; missing metadata falls back to the page title alone.
export function noteFileName(meta) {
  // A config's `title` is already the short form the file is named after.
  const fromConfig = [meta.properties?.title?.value].flat()[0];
  if (fromConfig) return `${sanitizeFileName(String(fromConfig))}.md`;
  // An article's title is its identity, and it may have no author or year to go on.
  if (meta.isPaper === false) return `${sanitizeFileName(String(meta.title || 'Untitled')).slice(0, ARTICLE_NAME_LIMIT).trim() || 'Untitled'}.md`;
  const author = surname(meta.authors?.[0]);
  const year = normalizeDate(meta.published).slice(0, 4);
  const short = abbreviateTitle(meta.title);
  if (!author || !year) return `${sanitizeFileName(short || 'Untitled')}.md`;
  return `${sanitizeFileName(`${author}(${year})-${short}`)}.md`;
}
