import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, normalizeDoi, normalizePage, bindingKey, titleSimilarity, resolveNote } from './page.js';

test('canonical URL drops hash and tracking, keeps meaningful query', () => {
  assert.equal(canonicalUrl('https://x.org/a/?utm_source=t&id=3#sec'), 'https://x.org/a/?id=3');
  assert.equal(canonicalUrl('https://x.org/a/#sec'), 'https://x.org/a');
});

test('DOI is found in prefixed forms', () => {
  assert.equal(normalizeDoi('doi:10.1038/s41586-020-1234-5'), '10.1038/s41586-020-1234-5');
  assert.equal(normalizeDoi('https://doi.org/10.1000/xyz.'), '10.1000/xyz');
  assert.equal(normalizeDoi('nothing'), '');
});

test('publisher page uses citation meta', () => {
  const page = normalizePage({
    url: 'https://www.nature.com/articles/s1?utm_source=x',
    docTitle: 'Title | Nature',
    meta: {
      citation_title: ['Real Title'], citation_author: ['A One', 'B Two'], citation_journal_title: ['Nature'],
      citation_publication_date: ['2024/03/05'], citation_doi: ['10.1038/s1'],
    },
  });
  assert.deepEqual(page, {
    url: 'https://www.nature.com/articles/s1', title: 'Real Title', authors: ['A One', 'B Two'], journal: 'Nature',
    published: '2024/03/05', doi: '10.1038/s1', arxiv: '', isPaper: true, discussion: '', site: 'nature.com',
  });
});

test('arXiv HTML page derives identifiers, date and a shared binding', () => {
  const html = normalizePage({ url: 'https://arxiv.org/html/1706.03762v7#S3', latexTitle: 'Attention Is All You Need', latexAuthors: ['Ashish Vaswani'] });
  assert.equal(html.arxiv, '1706.03762');
  assert.equal(html.doi, '10.48550/arXiv.1706.03762');
  assert.equal(html.published, '2017-06');
  assert.equal(html.journal, 'arXiv');
  const abs = normalizePage({ url: 'https://arxiv.org/abs/1706.03762', meta: { citation_title: ['Attention Is All You Need'] } });
  assert.equal(bindingKey(html), bindingKey(abs));
});

test('JSON-LD scholarly article is recognized, ordinary article is not', () => {
  const paper = normalizePage({ url: 'https://j.org/1', docTitle: 'x', jsonLd: [{ '@graph': [{ '@type': 'ScholarlyArticle', headline: 'H', author: [{ name: 'C D' }], datePublished: '2020-01-01' }] }] });
  assert.equal(paper.title, 'H');
  assert.deepEqual(paper.authors, ['C D']);
  assert.equal(paper.isPaper, true);
  const blog = normalizePage({ url: 'https://blog.org/post', docTitle: 'My Post', meta: { 'og:title': ['My Post'] }, jsonLd: [{ '@type': 'BlogPosting' }] });
  assert.equal(blog.isPaper, false);
  assert.equal(blog.title, 'My Post');
});

test('chat sites are discussions, never papers, whatever the URL contains', () => {
  const page = normalizePage({ url: 'https://chatgpt.com/c/abc?x=10.1000/fake', docTitle: 'Chat about attention', meta: { citation_doi: ['10.1/x'] } });
  assert.equal(page.discussion, 'GPT');
  assert.equal(page.isPaper, false);
  assert.equal(page.doi, '');
  assert.equal(normalizePage({ url: 'https://claude.ai/chat/1' }).discussion, 'Claude');
  assert.equal(normalizePage({ url: 'https://gemini.google.com/app/1' }).discussion, 'Gemini');
  assert.equal(normalizePage({ url: 'https://notchatgpt.com/c/1' }).discussion, '');
});

test('discussion goes to the most recent note and ignores any binding', () => {
  const chat = page({ discussion: 'GPT', title: 'Paper A' });
  assert.deepEqual(resolveNote(chat, notes, { boundName: 'A.md' }), { kind: 'note', name: 'B.md', via: 'recent' });
  assert.deepEqual(resolveNote(chat, []), { kind: 'ask', candidates: [] });
  assert.equal(resolveNote(chat, notes, { recentName: 'A.md' }).name, 'A.md');
  assert.equal(resolveNote(chat, notes, { recentName: 'Gone.md' }).name, 'B.md');
});

test('a config supplies metadata and its title names the file', () => {
  const page = normalizePage({
    url: 'https://www.mdpi.com/1/2',
    meta: { citation_title: ['Full Paper Title Here'], citation_author: ['Zhang, Wei'], citation_publication_date: ['2024/03/05'], citation_doi: ['10.3390/page'] },
    profile: {
      name: 'papers-MDPI',
      values: {
        title: { value: 'Zhang(2024)-Full Paper Title', type: 'text' },
        doi: { value: '10.3390/config', type: 'text' },
        journal: { value: 'Sensors', type: 'text' },
        published: { value: '2024-03-05', type: 'date' },
      },
    },
  });
  assert.equal(page.doi, '10.3390/config');
  assert.equal(page.journal, 'Sensors');
  assert.equal(page.published, '2024-03-05');
  assert.equal(page.title, 'Full Paper Title Here', 'the full title is kept for matching');
  assert.equal(page.profileName, 'papers-MDPI');
  assert.equal(page.isPaper, true);
});

test('a note with a shortened title is found by its file name, unless DOIs differ', () => {
  const page = (doi) => normalizePage({ url: 'https://x.org/new', meta: { citation_title: ['Full Paper Title Here'], citation_doi: doi ? [doi] : [] }, profile: { name: 'p', values: { title: { value: 'Zhang(2024)-Full Paper Title' } } } });
  const note = (doi) => [{ name: 'sub/Zhang(2024)-Full Paper Title.md', title: 'Zhang(2024)-Full Paper Title', doi, url: '' }];
  assert.equal(resolveNote(page(''), note('')).via, 'name');
  assert.equal(resolveNote(page('10.1000/a'), note('')).name, 'sub/Zhang(2024)-Full Paper Title.md');
  assert.equal(resolveNote(page('10.1000/a'), note('10.1000/b')).kind, 'create');
});

test('chat labels follow the language', () => {
  assert.equal(normalizePage({ url: 'https://chatgpt.com/c/1', lang: 'en' }).discussion, 'GPT');
  assert.equal(normalizePage({ url: 'https://www.doubao.com/c/1', lang: 'en' }).discussion, 'Doubao');
  assert.equal(normalizePage({ url: 'https://www.doubao.com/c/1' }).discussion, '豆包');
});

test('share links lead to the same article', () => {
  assert.equal(canonicalUrl('https://x.com/user/status/1?s=20&t=abc'), 'https://x.com/user/status/1');
  assert.equal(canonicalUrl('https://twitter.com/user/status/1?s=46'), 'https://twitter.com/user/status/1');
  assert.equal(canonicalUrl('https://a.substack.com/p/post?r=1x2&utm_medium=web'), 'https://a.substack.com/p/post');
  assert.equal(canonicalUrl('https://medium.com/@a/post?sk=secret'), 'https://medium.com/@a/post');
  assert.equal(canonicalUrl('https://blog.org/post?s=20'), 'https://blog.org/post?s=20', 'elsewhere it may matter');
});

test('an article gets its own metadata and is not a paper', () => {
  const page = normalizePage({
    url: 'https://a.substack.com/p/post?r=1',
    docTitle: 'A Post',
    meta: { 'og:title': ['A Post'], 'og:site_name': ['Good Letter'], author: ['Jane Roe'], 'article:published_time': ['2024-05-06T10:00:00Z'] },
  });
  assert.equal(page.isPaper, false);
  assert.equal(page.site, 'Good Letter');
  assert.deepEqual(page.authors, ['Jane Roe']);
  assert.equal(page.published, '2024-05-06T10:00:00Z');
});

test('article authors skip profile URLs and fall back to JSON-LD, then a handle', () => {
  const urlAuthor = normalizePage({ url: 'https://b.org/1', meta: { 'article:author': ['https://b.org/jane'] }, jsonLd: [{ '@type': 'BlogPosting', author: { name: 'Jane' }, datePublished: '2023-01-02' }] });
  assert.deepEqual(urlAuthor.authors, ['Jane']);
  assert.equal(urlAuthor.published, '2023-01-02');
  assert.equal(urlAuthor.site, 'b.org');
  assert.deepEqual(normalizePage({ url: 'https://x.com/a/status/1', meta: { 'twitter:creator': ['@jane'] } }).authors, ['@jane']);
});

test('title similarity tolerates punctuation and rejects different titles', () => {
  assert.equal(titleSimilarity('Attention is all you need!', 'ATTENTION IS ALL YOU NEED'), 1);
  assert.ok(titleSimilarity('Deep learning for protein folding', 'Deep learning of protein folding') >= 0.8);
  assert.ok(titleSimilarity('Gut microbiota and depression', 'Sleep and memory') < 0.3);
  assert.equal(titleSimilarity('', 'x'), 0);
});

const notes = [
  { name: 'A.md', title: 'Paper A', doi: '10.1000/AAA', url: 'https://a.org/a', lastAnnotated: 1 },
  { name: 'B.md', title: 'Attention Is All You Need', doi: '', url: 'https://arxiv.org/abs/1706.03762', lastAnnotated: 2 },
];
const page = (over) => ({ url: 'https://z.org', title: 'Unrelated Page', authors: [], journal: '', published: '', doi: '', arxiv: '', isPaper: false, discussion: '', ...over });

test('resolution order: binding, identifier, URL, title', () => {
  assert.deepEqual(resolveNote(page(), notes, { boundName: 'A.md' }), { kind: 'note', name: 'A.md', via: 'binding' });
  assert.equal(resolveNote(page({ doi: '10.1000/aaa' }), notes).via, 'identifier');
  assert.equal(resolveNote(page({ arxiv: '1706.03762', doi: '10.48550/arXiv.1706.03762' }), notes).name, 'B.md');
  assert.equal(resolveNote(page({ url: 'https://a.org/a' }), notes).via, 'url');
  assert.deepEqual(resolveNote(page({ title: 'attention is all you need.' }), notes), { kind: 'note', name: 'B.md', via: 'title' });
});

test('a deleted binding falls through to the other rules', () => {
  assert.equal(resolveNote(page({ doi: '10.1000/aaa' }), notes, { boundName: 'Gone.md' }).name, 'A.md');
});

test('unmatched paper is created, unmatched web page asks', () => {
  assert.deepEqual(resolveNote(page({ isPaper: true, doi: '10.9/new', title: 'New' }), notes), { kind: 'create' });
  const asked = resolveNote(page(), notes);
  assert.equal(asked.kind, 'ask');
  assert.deepEqual(asked.candidates.map((c) => c.name), ['B.md', 'A.md']);
  assert.deepEqual(resolveNote(page(), []), { kind: 'ask', candidates: [] });
});
