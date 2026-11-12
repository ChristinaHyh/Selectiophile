import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './profile-engine.js';
import { profileTemplate } from './profile-template.js';

const { parseProfile, parseBundledProfile, toClipperJson, profileWarnings, matchProfile, evaluateProfile, formatDate } = globalThis.SelectiophileProfiles;

// A small stand-in for the DOM calls the engine makes.
function fakeDoc({ meta = {}, selectors = {} }) {
  const metaNodes = Object.entries(meta).flatMap(([name, values]) => [values].flat().map((content) => ({
    getAttribute: (a) => (a === 'name' ? name : a === 'content' ? content : null),
  })));
  return {
    querySelectorAll(selector) {
      if (selector === 'meta') return metaNodes;
      const attr = selector.match(/^meta\[name=([\w.]+)\]$/);
      if (attr) return metaNodes.filter((n) => n.getAttribute('name') === attr[1]);
      if (selector.startsWith('meta[name^=dc]')) return metaNodes.filter((n) => /^dc.*subject$/.test(n.getAttribute('name')));
      if (selector === 'bad[') throw new Error('syntax');
      return (selectors[selector] || []).map((text) => ({ textContent: text, innerHTML: text, getAttribute: () => null }));
    },
  };
}

const run = (value, doc, variables = {}, type = 'text') =>
  evaluateProfile({ properties: [{ name: 'x', value, type }] }, doc, variables).x?.value;

const read = (name) => readFileSync(new URL(`../profiles/${name}`, import.meta.url), 'utf8');
const load = (name) => parseBundledProfile(read(name));

test('the bundled configs parse: notes get metadata, clipping gets the whole file', () => {
  const bundled = [
    ['papers-acs-clipper.json', 'https://pubs.acs.org/', 8],
    ['papers-mdpi-clipper.json', 'https://www.mdpi.com/', 8],
    ['papers-scid-clipper.json', 'https://www.sciencedirect.com/science/article/', 8],
    ['papers-nature-clipper.json', 'https://www.nature.com/articles/', 8],
    // science.org shows no keywords.
    ['papers-science-clipper.json', 'https://www.science.org/doi/', 7],
    // Pages no other config is for: no trigger, its own path.
    ['web-article-clipper.json', null, 6],
  ];
  for (const [file, trigger, count] of bundled) {
    const profile = load(file);
    assert.deepEqual(profile.triggers, trigger ? [trigger] : []);
    assert.equal(Boolean(profile.fallback), !trigger);
    assert.equal(profile.properties.length, count, file);
    assert.ok(!profile.properties.some((p) => p.name === 'source' || p.name === 'collection'));
    assert.deepEqual(profileWarnings(profile), { unknownFilters: [], schemaTriggers: [] }, file);
    assert.equal(profile.clip.path, trigger ? 'references/papers' : 'references/articles');
    assert.equal(profile.clip.noteContentFormat, JSON.parse(read(file)).noteContentFormat);
    assert.equal(profile.clip.properties.length, JSON.parse(read(file)).properties.length);
    assert.ok(profile.clip.properties.some((p) => p.name === 'source'), file);
  }
});

test('an uploaded config keeps every field, and downloads as a Web Clipper file', () => {
  const raw = {
    name: 'mine', triggers: ['https://x.org/'], noteContentFormat: '{{content}}', noteNameFormat: '{{title}}', path: 'refs',
    properties: [{ name: 'title', value: '{{title}}', type: 'text' }, { name: 'collection', value: 'papers', type: 'text' }],
  };
  const profile = parseProfile(JSON.stringify(raw));
  assert.equal(profile.properties.length, 2, 'uploaded configs keep collection for notes too');
  assert.deepEqual(profile.clip, { noteContentFormat: '{{content}}', noteNameFormat: '{{title}}', path: 'refs', properties: raw.properties });
  const back = toClipperJson(profile);
  for (const key of ['name', 'triggers', 'noteContentFormat', 'noteNameFormat', 'path', 'properties']) assert.deepEqual(back[key], raw[key], key);
  const metadataOnly = parseProfile(JSON.stringify({ name: 'm', triggers: ['https://x.org/'], properties: raw.properties }));
  assert.equal(metadataOnly.clip, undefined);
  assert.equal(toClipperJson(metadataOnly).noteContentFormat, undefined);
});

test('MDPI config produces the expected metadata', () => {
  const doc = fakeDoc({
    meta: {
      citation_author: ['Zhang, Wei', 'Li, Ming-Hua'],
      citation_publication_date: '2024/03/05',
      citation_title: 'Deep Learning for Protein Folding Studies',
      citation_doi: '10.3390/ijms25051234',
      citation_journal_title: 'Int. J. Mol. Sci.',
      'dc.subject': ['proteins', 'folding', 'proteins'],
    },
  });
  const v = evaluateProfile(load('papers-mdpi-clipper.json'), doc, { url: 'https://www.mdpi.com/1/2', date: '2026-11-05' });
  assert.equal(v.title.value, 'Zhang(2024)-Deep Learning for');
  assert.equal(v.doi.value, '10.3390/ijms25051234');
  assert.equal(v.paper_id.value, '25051234');
  assert.deepEqual(v.authors.value, ['[[Wei Zhang]]', '[[Ming-Hua Li]]']);
  assert.equal(v.published.value, '2024-03-05');
  assert.equal(v.created.value, '2026-11-05');
  assert.equal(v.journal.value, 'Int. J. Mol. Sci.');
  assert.deepEqual(v.keywords.value, ['proteins', 'folding']);
  assert.equal(v.authors.type, 'multitext');
});

test('ACS config: selectors, fallbacks and a DOI-derived id', () => {
  const doc = fakeDoc({
    meta: { citation_online_date: '2023-07-14', citation_title: 'Catalysis at Low Temperature', citation_doi: '10.1021/jacs.3c01234', citation_publication_date: '' },
    selectors: { '.al-author-name > .linked-name': ['Ada Lovelace', 'Alan Turing', 'Ada Lovelace'] },
  });
  const v = evaluateProfile(load('papers-acs-clipper.json'), doc, { url: 'https://pubs.acs.org/doi/x' });
  assert.equal(v.paper_id.value, '3c01234');
  assert.equal(v.published.value, '2023-07-14', 'falls back to the online date');
  assert.deepEqual(v.authors.value, ['[[Ada Lovelace]]', '[[Alan Turing]]']);
  assert.equal(v.title.value, 'Lovelace(2023)-Catalysis at Low', 'the year falls back to the online date too');
});

test('ACS config: the year also comes from dc.Date', () => {
  const doc = fakeDoc({
    meta: { 'dc.Date': '2026-08-13', citation_title: 'How to Build Machine-Learning Models' },
    selectors: { '.al-author-name > .linked-name': ['Kai Zhang'] },
  });
  const v = evaluateProfile(load('papers-acs-clipper.json'), doc, { url: 'https://pubs.acs.org/doi/x' });
  assert.equal(v.title.value, 'Zhang(2026)-How to Build');
});

test('ScienceDirect config uses page selectors', () => {
  const doc = fakeDoc({
    meta: { citation_publication_date: '2022', citation_title: 'A Study of Things', citation_doi: '10.1016/j.foo.2022.1234567' },
    selectors: { '#author-group .surname': ['Curie', 'Bohr'], '#author-group .react-xocs-alternative-link': ['Marie Curie', 'Niels Bohr'], '#keys0001 .keyword span': ['a', 'b'] },
  });
  const v = evaluateProfile(load('papers-scid-clipper.json'), doc, {});
  assert.equal(v.title.value, 'Curie(2022)-A Study of');
  assert.equal(v.paper_id.value, '0221234567');
  assert.equal(v.published.value, '2022-01-01');
  assert.deepEqual(v.keywords.value, ['a', 'b']);
});

test('filters', () => {
  const doc = fakeDoc({ selectors: { '.a': ['one two', 'three'], '.b': ['solo'] }, meta: { k: 'v', m: 'x/y.z' } });
  assert.equal(run('{{selector:.a|first}}', doc), 'one two');
  assert.equal(run('{{selector:.a|last}}', doc), 'three');
  assert.equal(run('{{selector:.b|first}}', doc), 'solo', 'a single value passes through');
  assert.deepEqual(run('{{selector:.a}}', doc), ['one two', 'three']);
  assert.equal(run('{{selector:.a|join:" + "}}', doc), 'one two + three');
  assert.equal(run('{{meta:name:M|split:"/"|last|split:"."|last}}', doc), 'z', 'names ignore case');
  assert.equal(run('{{meta:name:m|replace:"/[^a-z]/g":""}}', doc), 'xyz');
  assert.equal(run('{{meta:name:m|replace:"x":"a","y":"b"}}', doc), 'a/b.z');
  assert.equal(run('{{meta:name:m|slice:-1}}', doc), 'z');
  assert.equal(run('{{meta:name:k|upper}}', doc), 'V');
  assert.equal(run('{{meta:name:m|safe_name}}', doc), 'x y.z');
});

test('literals, mixed text and missing values', () => {
  const doc = fakeDoc({ meta: { k: 'v' }, selectors: { '.a': ['1', '2'] } });
  assert.equal(run('papers', doc), 'papers');
  assert.equal(run('{{meta:name:k}}-{{selector:.a}}', doc), 'v-1, 2');
  assert.equal(run('{{meta:name:none}}', doc), undefined, 'empty values are dropped');
  assert.equal(run('{{meta:name:none ?? meta:name:k}}', doc), 'v');
  assert.equal(run('{{meta:name:none ?? url}}', doc, { url: 'u' }), 'u');
  assert.equal(run('{{selector:bad[}}', doc), undefined, 'a broken selector is not fatal');
  assert.equal(run('{{meta:name:none|date:"YYYY"}}', doc), undefined);
});

test('dates', () => {
  assert.equal(formatDate('2024/3/5'), '2024-03-05');
  assert.equal(formatDate('2024-03'), '2024-03-01');
  assert.equal(formatDate('5 March 2024'), '2024-03-05');
  assert.equal(formatDate('March 5, 2024'), '2024-03-05');
  assert.equal(formatDate('Mar 2024'), '2024-03-01');
  assert.equal(formatDate('2024-12-31T23:59:59Z', 'YYYY'), '2024');
  assert.equal(formatDate('not a date'), 'not a date');
});

test('triggers: prefix and regex, first match wins, schema never matches', () => {
  const profiles = [
    { name: 'mine', triggers: ['https://www.mdpi.com/2/'], properties: [] },
    { name: 'regex', triggers: ['/nature\\.com\\/articles/'], properties: [] },
    { name: 'schema', triggers: ['schema:@Article'], properties: [] },
    { name: 'mdpi', triggers: ['https://www.mdpi.com/'], properties: [] },
    { name: 'broken', triggers: ['/(/'], properties: [] },
  ];
  assert.equal(matchProfile(profiles, 'https://www.mdpi.com/2/3').name, 'mine');
  assert.equal(matchProfile(profiles, 'https://www.mdpi.com/9').name, 'mdpi');
  assert.equal(matchProfile(profiles, 'https://www.nature.com/articles/s1').name, 'regex');
  assert.equal(matchProfile(profiles, 'https://x.org'), null);
});

test('uploads are validated, and unsupported parts are reported', () => {
  assert.throws(() => parseProfile('nope'), (e) => e.code === 'bad-json');
  assert.throws(() => parseProfile('{"name":"a","triggers":["x"]}'), (e) => e.code === 'no-properties');
  assert.throws(() => parseProfile('{"properties":[{"name":"a","value":"b"}]}'), (e) => e.code === 'no-triggers');
  const profile = parseProfile(JSON.stringify({
    name: 'p',
    triggers: ['https://x.org/', 'schema:@Article'],
    properties: [{ name: 'a', value: '{{title|mystery:"x"}}' }, { name: 'bad:name', value: 'v' }, { name: 'n', value: 5 }],
  }));
  assert.deepEqual(profile.properties.map((p) => p.name), ['a']);
  assert.deepEqual(profileWarnings(profile), { unknownFilters: ['mystery'], schemaTriggers: ['schema:@Article'] });
});

test('the config template parses, works, and explains every field in both languages', () => {
  for (const lang of ['zh', 'en']) {
    const raw = profileTemplate(lang);
    assert.ok(raw._notes.length >= 8);
    assert.ok(raw.properties.every((p) => p._note), lang);
    const profile = parseProfile(JSON.stringify(raw));
    assert.deepEqual(profileWarnings(profile), { unknownFilters: [], schemaTriggers: [] });
    assert.equal(profile.properties[0]._note, undefined, 'notes are not kept');
    assert.ok(!raw.properties.some((p) => p.name === 'source' || p.name === 'collection'));
    const doc = fakeDoc({ meta: {
      citation_author: ['Wei Zhang', 'Ming Li'], citation_publication_date: '2024/03/05', citation_title: 'Deep Learning for Proteins',
      citation_doi: '10.3390/abc', citation_journal_title: 'J', citation_keywords: 'a; b',
    } });
    const v = evaluateProfile(profile, doc, { date: '2026-11-06' });
    assert.equal(v.title.value, 'Zhang(2024)-Deep Learning for');
    assert.deepEqual(v.authors.value, ['[[Wei Zhang]]', '[[Ming Li]]']);
    assert.equal(v.published.value, '2024-03-05');
    assert.equal(v.paper_id.value, 'abc');
    assert.deepEqual(v.keywords.value, ['a', 'b']);
  }
});

test('the template mentions every filter the engine supports', () => {
  const notes = profileTemplate('en')._notes.join(' ');
  for (const name of ['first', 'last', 'split', 'slice', 'join', 'unique', 'wikilink', 'replace', 'date', 'safe_name', 'remove_html', 'remove_attr', 'markdown', 'strip_tags', 'trim', 'lower', 'upper']) {
    assert.ok(notes.includes(name), name);
  }
});

test('the manifest can read the current tab\'s address before a site is allowed', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('activeTab'));
});

test('Nature config produces the expected metadata', () => {
  const doc = fakeDoc({
    meta: {
      citation_author: ['Arute, Frank', 'Arya, Kunal'],
      citation_publication_date: '2019/10',
      citation_online_date: '2019/10/23',
      citation_title: 'Quantum supremacy using a programmable superconducting processor',
      citation_doi: '10.1038/s41586-019-1666-5',
      citation_journal_title: 'Nature',
    },
    selectors: {
      '.c-article-author-list a[data-test=author-name]': ['Frank Arute', 'Kunal Arya'],
      '.c-article-subject-list__subject': ['Quantum information'],
    },
  });
  const v = evaluateProfile(load('papers-nature-clipper.json'), doc, { url: 'https://www.nature.com/articles/s41586-019-1666-5', date: '2026-11-10' });
  assert.equal(v.title.value, 'Arute(2019)-Quantum supremacy using');
  assert.equal(v.paper_id.value, 's41586-019-1666-5');
  assert.deepEqual(v.authors.value, ['[[Frank Arute]]', '[[Kunal Arya]]']);
  assert.equal(v.published.value, '2019-10-23');
  assert.deepEqual([v.keywords.value].flat(), ['Quantum information']);
});

test('Science config takes the DOI from the address', () => {
  const doc = fakeDoc({ meta: { 'dc.Title': 'A mock study of things', 'dc.Date': '2024-03-07' } });
  const v = evaluateProfile(load('papers-science-clipper.json'), doc, { url: 'https://www.science.org/doi/full/10.1126/science.abj8754?af=R', date: '2026-11-10' });
  assert.equal(v.doi.value, '10.1126/science.abj8754');
  assert.equal(v.paper_id.value, 'science.abj8754');
  assert.equal(v.published.value, '2024-03-07');
});

test('a filter after the last fallback formats whichever value a clip finds, as in notes', () => {
  const { clipTemplate } = globalThis.SelectiophileProfiles;
  const acs = load('papers-acs-clipper.json');
  const published = clipTemplate(acs.clip).properties.find((p) => p.name === 'published').value;
  assert.equal(published, '{{meta:name:citation_publication_date|date:"YYYY-MM-DD" ?? meta:name:citation_online_date|date:"YYYY-MM-DD" ?? meta:name:dc.Date|date:"YYYY-MM-DD" ?? meta:name:publish_date|date:"YYYY-MM-DD" ?? published|date:"YYYY-MM-DD"}}');
  const values = (v) => clipTemplate({ properties: [{ name: 'x', value: v }] }).properties[0].value;
  // Own filters on any fallback, one value, or none: as written.
  for (const v of ['{{a|slice:0,4 ?? b|slice:0,4}}', '{{a ?? b|first ?? c}}', '{{a|date:"YYYY"}}', '{{a ?? b}}', 'plain', '{{a|x}} and {{b ?? c}}']) {
    assert.equal(values(v), v);
  }
  // A quoted `??` or `|` inside an argument is no separator.
  assert.equal(values('{{a ?? b|replace:"??":"|"}}'), '{{a|replace:"??":"|" ?? b|replace:"??":"|"}}');
  assert.equal(values('x {{a ?? b|upper}} y'), 'x {{a|upper ?? b|upper}} y');
  // The page reads the same either way.
  const doc = fakeDoc({ meta: { citation_publication_date: '2025/03/12' } });
  assert.equal(run(published, doc), run(acs.clip.properties.find((p) => p.name === 'published').value, doc));
  assert.equal(run(published, doc), '2025-03-12');
  // ACS pages since 2026 carry their date only as `publish_date`, which the title's year reads too.
  const now = fakeDoc({ meta: { publish_date: '2026-08-13', citation_author: 'Zhang, Kai', citation_title: 'How to Build Machine-Learning Models' } });
  assert.equal(run(published, now), '2026-08-13');
  assert.match(run(acs.clip.properties.find((p) => p.name === 'title').value, now), /\(2026\)-/);
});
