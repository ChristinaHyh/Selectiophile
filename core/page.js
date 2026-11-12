// Turns raw page metadata into a normalized page, and matches a page to a note.
import { discussionLabel } from './sites.js';
import { noteFileName } from './note.js';

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|spm|scm)$/i;
const ARXIV = /arxiv\.org\/(?:abs|html|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i;
const ARXIV_DOI = /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i;
const DOI_IN_TEXT = /\b(10\.\d{4,9}\/[^\s?#"'<>]+)/;

// Sharing adds these per site, so the same article would otherwise look like two pages,
// and articles have no DOI to fall back on.
const SITE_SHARE_PARAMS = [
  [/(^|\.)(x|twitter)\.com$/, /.*/],
  [/(^|\.)substack\.com$/, /^(r|triedRedirect|publication_id|post_id|isFreemail|triggerShare)$/],
  [/(^|\.)medium\.com$/, /^(sk|source)$/],
];

export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    const shared = SITE_SHARE_PARAMS.find(([host]) => host.test(u.hostname))?.[1];
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key) || shared?.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

export function normalizeDoi(raw) {
  const m = String(raw || '').match(DOI_IN_TEXT);
  return m ? m[1].replace(/[.,;)]+$/, '') : '';
}

export function arxivIdOf(text) {
  const s = String(text || '');
  return s.match(ARXIV)?.[1] || s.match(ARXIV_DOI)?.[1] || '';
}

const first = (meta, ...names) => {
  for (const name of names) {
    const v = meta[name]?.find((x) => x && x.trim());
    if (v) return v.trim();
  }
  return '';
};

function jsonLdOfType(items = [], type) {
  const queue = [...items];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item)) queue.push(...item);
    else if (item['@graph']) queue.push(...[item['@graph']].flat());
    else if ([item['@type']].flat().some((t) => type.test(t))) return item;
  }
  return null;
}

const jsonLdPaper = (items) => jsonLdOfType(items, /ScholarlyArticle/i);
const jsonLdArticle = (items) => jsonLdOfType(items, /^(Article|NewsArticle|BlogPosting|SocialMediaPosting|Report)$/i);

const isUrl = (text) => /^https?:\/\//i.test(text);

function articleAuthors(raw) {
  const meta = raw.meta || {};
  const named = [...(meta.author || []), ...(meta['article:author'] || [])].filter((a) => a && !isUrl(a));
  if (named.length) return [...new Set(named)];
  const fromLd = jsonLdAuthors(jsonLdArticle(raw.jsonLd));
  if (fromLd.length) return fromLd;
  const handle = first(meta, 'twitter:creator');
  return handle ? [handle] : [];
}

const siteName = (raw) => {
  const named = first(raw.meta || {}, 'og:site_name');
  if (named) return named;
  try {
    return new URL(raw.url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const jsonLdAuthors = (paper) =>
  [paper?.author].flat().filter(Boolean).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);

function authorsOf(raw, paper) {
  const meta = raw.meta || {};
  if (meta.citation_author?.length) return meta.citation_author.filter(Boolean);
  const joined = first(meta, 'citation_authors');
  if (joined) return joined.split(';').map((a) => a.trim()).filter(Boolean);
  if (meta['dc.creator']?.length) return meta['dc.creator'].filter(Boolean);
  const fromLd = jsonLdAuthors(paper);
  return fromLd.length ? fromLd : raw.latexAuthors || [];
}

// An arXiv id starts with its submission year and month.
const arxivDate = (id) => (id ? `20${id.slice(0, 2)}-${id.slice(2, 4)}` : '');

export function normalizePage(raw) {
  const discussion = discussionLabel(raw.url, raw.lang);
  if (discussion) {
    return {
      url: canonicalUrl(raw.url), title: (raw.docTitle || '').replace(/\s+/g, ' ').trim(), authors: [], journal: '', published: '',
      doi: '', arxiv: '', isPaper: false, discussion, site: '',
    };
  }
  const meta = raw.meta || {};
  const paper = jsonLdPaper(raw.jsonLd);
  const url = canonicalUrl(raw.url);
  const arxiv = arxivIdOf(raw.url) || arxivIdOf(first(meta, 'citation_arxiv_id') && `arxiv.org/abs/${first(meta, 'citation_arxiv_id')}`);
  const doi = normalizeDoi(raw.profile?.values?.doi?.value)
    || normalizeDoi(first(meta, 'citation_doi', 'prism.doi', 'dc.identifier', 'doi'))
    || normalizeDoi(paper?.doi)
    || normalizeDoi(raw.url)
    || (arxiv ? `10.48550/arXiv.${arxiv}` : '');
  const fromConfig = raw.profile?.values || {};
  const configText = (name) => [fromConfig[name]?.value].flat()[0] || '';
  const paperTitle = first(meta, 'citation_title', 'dc.title') || paper?.headline || paper?.name || raw.latexTitle || '';
  const title = paperTitle || first(meta, 'og:title') || raw.docTitle || raw.h1 || '';
  return {
    url,
    title: title.replace(/\s+/g, ' ').trim(),
    authors: paperTitle || doi || arxiv ? authorsOf(raw, paper) : articleAuthors(raw),
    journal: configText('journal') || first(meta, 'citation_journal_title', 'citation_conference_title', 'prism.publicationname') || (arxiv ? 'arXiv' : ''),
    published: configText('published') || first(meta, 'citation_publication_date', 'citation_online_date', 'citation_date', 'prism.publicationdate', 'dc.date')
      || paper?.datePublished || arxivDate(arxiv) || first(meta, 'article:published_time') || jsonLdArticle(raw.jsonLd)?.datePublished || '',
    doi,
    arxiv,
    isPaper: Boolean(doi || arxiv || paperTitle),
    discussion: '',
    site: siteName(raw),
    ...(raw.profile ? { properties: fromConfig, profileName: raw.profile.name } : {}),
  };
}

// The same paper keeps one binding across its abstract, HTML and tracking URLs.
export const bindingKey = (page) =>
  (page.arxiv ? `arxiv:${page.arxiv}` : page.doi ? `doi:${page.doi.toLowerCase()}` : `url:${page.url}`);

const normalizeTitle = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function titleSimilarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  for (const [g, n] of gx) shared += Math.min(n, gy.get(g) || 0);
  return (2 * shared) / (x.length - 1 + y.length - 1);
}

const TITLE_MATCH = 0.9;
const CANDIDATE_LIMIT = 10;

// Order: identifiers, then title. Returns `create` for an unmatched paper and
// `ask` for an unmatched ordinary web page, which may not deserve a note.
export function resolveNote(page, notes, { boundName, recentName } = {}) {
  // A chat URL says nothing about the paper, and temporary chats can share one, so
  // it never binds. The last note used is the best guess, and the toast shows it.
  if (page.discussion) {
    const recent = notes.find((n) => n.name === recentName)
      || [...notes].sort((a, b) => (b.lastAnnotated || 0) - (a.lastAnnotated || 0))[0];
    return recent ? { kind: 'note', name: recent.name, via: 'recent' } : { kind: 'ask', candidates: [] };
  }

  if (boundName && notes.some((n) => n.name === boundName)) return { kind: 'note', name: boundName, via: 'binding' };

  const doi = page.doi.toLowerCase();
  const byId = notes.find((n) => (doi && normalizeDoi(n.doi).toLowerCase() === doi)
    || (page.arxiv && (arxivIdOf(n.doi) === page.arxiv || arxivIdOf(n.url) === page.arxiv)));
  if (byId) return { kind: 'note', name: byId.name, via: 'identifier' };

  const byUrl = notes.find((n) => n.url && canonicalUrl(n.url) === page.url);
  if (byUrl) return { kind: 'note', name: byUrl.name, via: 'url' };

  // A config can shorten a note's `title`, so the full title can't match it. The same
  // short title and file name identify it instead, unless both have DOIs and they differ.
  const shortTitle = [page.properties?.title?.value].flat()[0];
  if (shortTitle) {
    const expected = noteFileName(page).toLowerCase();
    const byName = notes.find((n) => n.name.split('/').pop().toLowerCase() === expected
      && n.title === shortTitle
      && !(doi && n.doi && normalizeDoi(n.doi).toLowerCase() !== doi));
    if (byName) return { kind: 'note', name: byName.name, via: 'name' };
  }

  const scored = notes
    .map((n) => ({ note: n, score: titleSimilarity(page.title, n.title) }))
    .sort((a, b) => b.score - a.score || (b.note.lastAnnotated || 0) - (a.note.lastAnnotated || 0));
  if (page.title && scored[0]?.score >= TITLE_MATCH) return { kind: 'note', name: scored[0].note.name, via: 'title' };

  if (page.isPaper) return { kind: 'create' };
  return { kind: 'ask', candidates: scored.slice(0, CANDIDATE_LIMIT).map((s) => s.note) };
}
