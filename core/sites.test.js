import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleFromInput, ruleMatches, matchPattern, matchingRules, siteActive, scriptPlan, siteModeOf, conversationKey, discussionLabel } from './sites.js';

test('rules are derived from pasted URLs and domains', () => {
  assert.equal(ruleFromInput('https://www.nature.com/articles/s1?x=1'), '*.nature.com');
  assert.equal(ruleFromInput('arxiv.org'), '*.arxiv.org');
  assert.equal(ruleFromInput('*.sciencedirect.com'), '*.sciencedirect.com');
  assert.equal(ruleFromInput('http://127.0.0.1:8000/a'), '127.0.0.1');
  assert.equal(ruleFromInput('  '), '');
  assert.equal(ruleFromInput('not a url'), '');
});

test('a rule covers its domain and subdomains only', () => {
  assert.ok(ruleMatches('*.nature.com', 'https://nature.com/a'));
  assert.ok(ruleMatches('*.nature.com', 'https://www.nature.com/a'));
  assert.ok(!ruleMatches('*.nature.com', 'https://notnature.com/a'));
  assert.ok(!ruleMatches('*.nature.com', 'chrome://nature.com'));
  assert.ok(ruleMatches('127.0.0.1', 'http://127.0.0.1:8000/a'));
  assert.deepEqual(matchingRules(['*.a.org', '*.b.org'], 'https://x.b.org'), ['*.b.org']);
});

test('the three site modes', () => {
  const sites = ['*.a.org'];
  const blocked = ['*.b.org'];
  assert.equal(siteActive({ mode: 'whitelist', sites, blocked }, 'https://x.a.org/p'), true);
  assert.equal(siteActive({ mode: 'whitelist', sites, blocked }, 'https://c.org'), false);
  assert.equal(siteActive({ mode: 'blacklist', sites, blocked }, 'https://x.b.org/p'), false);
  assert.equal(siteActive({ mode: 'blacklist', sites, blocked }, 'https://x.a.org'), true);
  assert.equal(siteActive({ mode: 'all', sites, blocked }, 'https://x.b.org'), true);
  assert.equal(siteActive({ mode: 'all' }, 'chrome://extensions'), false);
  assert.equal(siteActive({ sites }, 'https://a.org'), true, 'whitelist is the default');
  assert.equal(siteModeOf('nonsense'), 'whitelist');
});

test('script registration follows the mode and the permissions held', () => {
  const config = { sites: ['*.a.org', '*.c.org'], blocked: ['*.b.org'] };
  assert.deepEqual(scriptPlan({ ...config, mode: 'whitelist' }, { grantedRules: ['*.a.org'] }), { matches: ['*://*.a.org/*'], excludeMatches: [] });
  assert.deepEqual(scriptPlan({ ...config, mode: 'all' }, { hasAll: true }), { matches: ['*://*/*'], excludeMatches: [] });
  assert.deepEqual(scriptPlan({ ...config, mode: 'blacklist' }, { hasAll: true }), { matches: ['*://*/*'], excludeMatches: ['*://*.b.org/*'] });
  assert.deepEqual(scriptPlan({ ...config, mode: 'blacklist' }, { hasAll: false }), { matches: [], excludeMatches: [] });
});

test('only a chat with its own address counts as one conversation', () => {
  assert.equal(conversationKey('https://chatgpt.com/c/abc?x=1'), 'chatgpt.com/c/abc');
  assert.equal(conversationKey('https://gemini.google.com/app/123'), 'gemini.google.com/app/123');
  assert.equal(conversationKey('https://chatgpt.com/?temporary-chat=true'), null);
  assert.equal(conversationKey('https://chatgpt.com/'), null);
  assert.equal(conversationKey('nonsense'), null);
});

test('source labels are just the assistant\'s name', () => {
  assert.equal(discussionLabel('https://chatgpt.com/c/1'), 'GPT');
  assert.equal(discussionLabel('https://gemini.google.com/app/1'), 'Gemini');
  assert.equal(discussionLabel('https://poe.com/chat/1'), 'Poe');
  assert.equal(discussionLabel('https://example.org/'), '');
});

test('match pattern form', () => {
  assert.equal(matchPattern('*.nature.com'), '*://*.nature.com/*');
});
