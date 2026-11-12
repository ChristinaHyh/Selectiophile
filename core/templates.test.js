import test from 'node:test';
import assert from 'node:assert/strict';
import { allTemplates, pickTemplate, normalizeTemplateRule, templateRuleMatches } from './templates.js';

test('the two built-ins always exist, and the old single template becomes the paper one', () => {
  const list = allTemplates();
  assert.deepEqual(list.map((t) => t.id), ['paper', 'article']);
  assert.equal(list[0].text, null);
  assert.equal(allTemplates([], '# Old')[0].text, '# Old');
  assert.equal(allTemplates([{ id: 'paper', text: '# New', sites: [] }], '# Old')[0].text, '# New');
});

test('built-ins keep their folder and sites', () => {
  const [paper] = allTemplates([{ id: 'paper', folder: 'papers', sites: ['*.a.org'] }]);
  assert.equal(paper.folder, 'papers');
  assert.deepEqual(paper.sites, ['*.a.org']);
});

test('without a rule, the type of page decides', () => {
  const list = allTemplates();
  assert.equal(pickTemplate(list, 'https://x.org', true).template.id, 'paper');
  assert.equal(pickTemplate(list, 'https://x.org', false).template.id, 'article');
  assert.equal(pickTemplate(list, 'https://x.org', false).matched, false);
});

test('a site rule wins over the page type, and custom templates come first', () => {
  const list = allTemplates([
    { id: 'article', sites: ['*.nature.com'] },
    { id: 'c1', name: 'Newsletter', text: '# N', sites: ['*.substack.com'] },
    { id: 'c2', name: 'Also Nature', text: '# M', sites: ['*.nature.com'] },
  ]);
  const substack = pickTemplate(list, 'https://a.substack.com/p/x', false);
  assert.equal(substack.template.id, 'c1');
  assert.equal(substack.matched, true);
  assert.equal(pickTemplate(list, 'https://www.nature.com/articles/1', true).template.id, 'c2');
});

test('rules are read from what was typed', () => {
  assert.equal(normalizeTemplateRule('https://www.substack.com/inbox'), '*.substack.com', 'a URL with no * means its domain');
  assert.equal(normalizeTemplateRule('substack.com'), '*.substack.com');
  assert.equal(normalizeTemplateRule('*.substack.com'), '*.substack.com');
  assert.equal(normalizeTemplateRule('*.substack.com/p/*'), '*.substack.com/p/*');
  assert.equal(normalizeTemplateRule('https://a.org/blog/*'), 'a.org/blog/*');
  assert.equal(normalizeTemplateRule('*://*.nature.com/articles/*'), '*.nature.com/articles/*');
  assert.equal(normalizeTemplateRule('news.*'), 'news.*');
  assert.equal(normalizeTemplateRule('  '), '');
  assert.equal(normalizeTemplateRule('not a url'), '');
  assert.equal(normalizeTemplateRule('has space*'), '');
});

test('wildcards stand for anything, across hosts and paths', () => {
  const yes = [
    ['*.substack.com', 'https://jane.substack.com/p/x'],
    ['*.substack.com', 'https://substack.com/'],
    ['*.substack.com/p/*', 'https://jane.substack.com/p/x'],
    ['*.substack.com/p/*', 'https://substack.com/p/x'],
    ['*.substack.*', 'https://jane.substack.co.uk/'],
    ['news.*', 'https://news.ycombinator.com/item?id=1'],
    ['*blog*', 'https://myblog.example.org/post'],
    ['x.com/*/status/*', 'https://x.com/jane/status/123?s=20'],
    ['x.com/*/status/*', 'https://www.x.com/jane/status/123'],
    ['a.org/blog/*', 'http://a.org/blog/2024/post'],
    ['a.org/*?id=*', 'https://a.org/page?id=3'],
    ['nature.com/ARTICLES/*', 'https://nature.com/articles/s1'],
  ];
  for (const [rule, url] of yes) assert.equal(templateRuleMatches(rule, url), true, `${rule} ${url}`);
  const no = [
    ['*.substack.com', 'https://notsubstack.com/'],
    ['*.substack.com/p/*', 'https://jane.substack.com/about'],
    ['*.substack.com/p/*', 'https://evil.org/jane.substack.com/p/x'],
    ['news.*', 'https://example.org/news.html'],
    ['x.com/*/status/*', 'https://x.com/jane'],
    ['a.org/blog/*', 'https://a.org/blogs/x'],
    ['a.org/blog/*', 'https://b.a.org/blog/x'],
    ['a.b*', 'chrome://a.b/'],
    ['a.b*', 'not a url'],
    ['a.c', 'https://abc'],
    ['a.c*/x', 'https://abc/x'],
  ];
  for (const [rule, url] of no) assert.equal(templateRuleMatches(rule, url), false, `${rule} ${url}`);
});

test('the most specific rule wins, wherever it is listed', () => {
  const list = allTemplates([
    { id: 'c1', name: 'General', sites: ['*.substack.com'] },
    { id: 'c2', name: 'Post', sites: ['*.substack.com/p/*'] },
    { id: 'article', sites: ['jane.substack.com/p/*'] },
  ]);
  assert.equal(pickTemplate(list, 'https://jane.substack.com/p/x', false).template.id, 'article');
  assert.equal(pickTemplate(list, 'https://bob.substack.com/p/x', false).template.id, 'c2');
  assert.equal(pickTemplate(list, 'https://bob.substack.com/about', false).template.id, 'c1');
});
