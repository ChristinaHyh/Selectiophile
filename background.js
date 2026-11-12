import { createService, linkFieldOf } from './core/service.js';
import { askJev, buildBlockRequest, decideBlock } from './core/router.js';
import { loadFolder } from './core/handle.js';
import { syncDashboard, dashboardFileName } from './core/vault.js';
import { dashboardMarkdown, earlierDashboards } from './core/dashboard.js';
import './core/i18n.js';
import './core/profile-engine.js';
import { ALL_SITES, matchPattern, scriptPlan, siteActive } from './core/sites.js';
import { THEMES, themeOf } from './core/theme.js';
import { normalizePage } from './core/page.js';
import { articleSelectors } from './core/clip-check.js';

const kv = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
  all: () => chrome.storage.local.get(null),
};

const JEV_TIMEOUT_MS = 15000;

const { t, setLang, resolveLang } = globalThis.SelectiophileI18n;
const { parseBundledProfile, clipTemplate } = globalThis.SelectiophileProfiles;

const currentLang = async () => resolveLang(await kv.get('lang'), chrome.i18n.getUILanguage());

const bundledText = async (path) => (await fetch(chrome.runtime.getURL(path))).text();

const BUNDLED_PROFILES = [
  'papers-acs-clipper.json', 'papers-mdpi-clipper.json', 'papers-scid-clipper.json',
  'papers-nature-clipper.json', 'papers-science-clipper.json', 'web-article-clipper.json',
];
let bundledProfiles = null;

async function getDefaultProfiles() {
  bundledProfiles ||= await Promise.all(BUNDLED_PROFILES.map(async (f) => parseBundledProfile(await bundledText(`profiles/${f}`))));
  return bundledProfiles;
}

const service = createService({
  getFolder: loadFolder,
  kv,
  getJevKey: async () => (await kv.get('jevKey')) || '',
  askJev: (key, body) => askJev(key, body, { signal: AbortSignal.timeout(JEV_TIMEOUT_MS) }),
  // A closed tab is fine: the job stays pending and the popup lists it.
  notify: (tabId, update) => (tabId == null
    ? Promise.resolve()
    : chrome.tabs.sendMessage(tabId, { type: 'job:update', ...update }).catch(() => {})),
  newId: () => crypto.randomUUID().slice(0, 8),
  getLang: currentLang,
  getBundledTemplate: (id = 'paper') => bundledText(id === 'article' ? 'Article Template.md' : 'Reading Template.md'),
  getDefaultProfiles,
  onNoteWritten: () => syncDashboardFile(),
  requestClip: (request) => autoClip(request),
});

// ---------------------------------------------------------------------------
// Clipping the original. Web Clipper's template engine is large, so it is loaded
// into a page only when that page is clipped.
// ---------------------------------------------------------------------------
const CLIPPER_JS = ['vendor/clipper.js', 'content/clip-prep.js'];

// Runs in the page's own world: what MathJax 3 holds of each formula, by the formula's
// position among mjx-container. Written in TeX, that is the TeX itself, as the authors
// wrote it; one MathJax hasn't drawn yet (lazy typesetting, as on MDPI) has nothing
// else. Using a macro the page defines, which Obsidian wouldn't know, it is the MathML
// MathJax made of it, as it is for a formula written in MathML.
function mathjaxMathml() {
  const mj = globalThis.MathJax;
  const list = mj?.startup?.document?.math;
  if (!list) return [];
  const position = new Map([...document.querySelectorAll('mjx-container')].map((c, i) => [c, i]));
  const macros = Object.keys(mj.config?.tex?.macros || {}).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pageMacro = macros.length ? new RegExp(`\\\\(?:${macros.join('|')})(?![A-Za-z])`) : null;
  const mathml = (item) => {
    const source = String(item.math || '').trim();
    if (item.inputJax?.name === 'MathML' && source.startsWith('<math')) return source;
    try {
      const mml = typeof mj.startup.toMML === 'function' ? mj.startup.toMML(item.root) : '';
      return /<math[^>]*>\s*<\/math>/.test(mml) ? '' : mml;
    } catch {
      return '';
    }
  };
  // Comments end at the line's end, which a formula on one line wouldn't have; blank
  // lines would end the paragraph in Markdown.
  const cleanTex = (tex, display) => {
    const out = tex.replace(/(^|[^\\])%.*$/gm, '$1').replace(/\n\s*\n/g, '\n').trim();
    return display ? out : out.replace(/\s+/g, ' ');
  };
  const found = [];
  for (const item of list) {
    const c = item.typesetRoot;
    if (!position.has(c)) continue;
    const display = Boolean(item.display);
    const tex = item.inputJax?.name === 'TeX' ? cleanTex(String(item.math || ''), display) : '';
    const mml = !tex || pageMacro?.test(tex) ? mathml(item) : '';
    if (mml) found.push({ index: position.get(c), display, mml });
    else if (tex) found.push({ index: position.get(c), display, tex });
  }
  return found;
}

// The clip is made from a copy of the page, prepared as the formula userscript would.
// The article's text is read first from the page itself, where what is hidden shows as
// hidden, to check afterwards that the clip lost nothing.
async function clipInTab(tabId, template, url) {
  const [{ result: loaded }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => Boolean(globalThis.SelectiophileClipPrep) });
  if (!loaded) await chrome.scripting.executeScript({ target: { tabId }, files: CLIPPER_JS });
  const mathml = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: mathjaxMathml })
    .then(([r]) => r?.result || [])
    .catch(() => []);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [template, url, mathml, articleSelectors(template)],
    func: async (clipTemplate, pageUrl, pageMathml, selectors) => {
      try {
        const prep = globalThis.SelectiophileClipPrep;
        const blocks = prep.articleBlocks?.(document, selectors) ?? null;
        const formulas = prep.articleFormulas?.(document, selectors) ?? null;
        const doc = document.cloneNode(true);
        const page = prep.prepare(doc, { url: pageUrl, mathml: pageMathml, selectors });
        const value = await globalThis.SelectiophileClipper.clipDocument({ template: clipTemplate, doc, url: pageUrl });
        return { ok: true, value: { ...value, page: { ...page, blocks, ...(formulas === null ? {} : { formulas }) } } };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
  });
  if (!result?.ok) throw new Error(result?.error || t('剪藏失败'));
  return result.value;
}

// Whether the tab shows a paper, by the tags papers carry, for a page whose type no
// config decides. A page that can't be read counts as an article.
async function tabIsPaper(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(document.querySelector('meta[name="citation_doi"], meta[name="citation_title"], meta[name="citation_arxiv_id"], meta[name="prism.doi"], meta[name="dc.title" i]')
      || /arxiv\.org\/(abs|html|pdf)\//.test(location.href)),
  }).catch(() => [{ result: false }]);
  return Boolean(result);
}

async function runClip({ tabId, url, noteName, force = false }) {
  if (tabId == null || !url) throw new Error(t('找不到要剪藏的网页'));
  const profile = await service.clipProfile(url, { isPaper: await tabIsPaper(tabId) });
  if (!profile) throw new Error(t('这个网页没有可用的剪藏配置'));
  const result = await clipInTab(tabId, clipTemplate(profile.clip), url);
  return service.saveClip({ url, noteName, result, force });
}

// From the popup: the page comment window opens in the page, whose site may not be
// on the list. Clicking the toolbar icon lets the extension into that tab.
async function openReview(tabId) {
  if (tabId == null) throw new Error(t('找不到要剪藏的网页'));
  const [{ result: ready }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => Boolean(window.__selectiophileLoaded) });
  if (!ready) await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT.js });
  await chrome.tabs.sendMessage(tabId, { type: 'review:open' });
}

// Only while the tab still shows the page the highlight came from.
async function autoClip({ tabId, pageKey, noteName }) {
  const tab = tabId == null ? null : await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || normalizePage({ url: tab.url }).url !== pageKey) return;
  const update = await runClip({ tabId, url: tab.url, noteName })
    .then((r) => ({ state: 'clipped', ...r }))
    .catch((e) => ({ state: 'clip-error', message: e.message, code: e.code }));
  await chrome.tabs.sendMessage(tabId, { type: 'clip:update', ...update }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Content script registration, limited to allowed sites the user has granted.
// ---------------------------------------------------------------------------
const CONTENT_SCRIPT = { id: 'selectiophile-content', js: ['core/i18n.js', 'core/profile-engine.js', 'core/combo.js', 'content/content.js'], runAt: 'document_idle' };

async function siteConfig() {
  return { mode: await kv.get('siteMode'), sites: (await kv.get('sites')) || [], blocked: (await kv.get('blockedSites')) || [] };
}

async function grantedRules(rules) {
  const checks = await Promise.all(rules.map((r) => chrome.permissions.contains({ origins: [matchPattern(r)] })));
  return rules.filter((_, i) => checks[i]);
}

let syncing = Promise.resolve();

function syncContentScripts() {
  syncing = syncing.then(doSync).catch((e) => console.warn('Selectiophile: content script sync failed', e));
  return syncing;
}

async function doSync() {
  const config = await siteConfig();
  const { matches, excludeMatches } = scriptPlan(config, {
    grantedRules: await grantedRules(config.sites),
    hasAll: await chrome.permissions.contains({ origins: [ALL_SITES] }),
  });
  // Scripts registered under another id, as Lectiophile's `lectiophile-content` before
  // the rename, would load the page script a second time.
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const stale = registered.filter((s) => s.id !== CONTENT_SCRIPT.id).map((s) => s.id);
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  const current = registered.find((s) => s.id === CONTENT_SCRIPT.id);
  if (!matches.length) {
    if (current) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT.id] });
    return;
  }
  const unchanged = JSON.stringify(current?.matches || []) === JSON.stringify(matches)
    && JSON.stringify(current?.excludeMatches || []) === JSON.stringify(excludeMatches);
  if (unchanged) return;
  const script = { ...CONTENT_SCRIPT, matches, excludeMatches };
  if (current) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  await injectOpenTabs(config);
}

// A newly allowed site works without a reload. The script guards against loading twice.
async function injectOpenTabs(config) {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id == null || !tab.url || !siteActive(config, tab.url)) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPT.js });
    } catch {
      // The page may forbid injection.
    }
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await syncContentScripts();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(syncContentScripts);
chrome.permissions.onAdded.addListener(syncContentScripts);
chrome.permissions.onRemoved.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.sites || changes.siteMode || changes.blockedSites) syncContentScripts();
  if (changes.sites || changes.siteMode || changes.blockedSites || changes.settings || changes.theme) updateAllBadges();
  if (changes.theme) applyThemeIcon().catch(() => {});
  if (changes.lang || changes.dashboard || changes.clip) syncDashboardFile().catch(() => {});
});

// Detection is on unless turned off. The dashboard goes in a folder of the vault, by
// default its top. Its text is preset, in the language of the settings. A file still
// holding what was written before, or an earlier version's text, follows; one edited
// in Obsidian is kept unless `overwrite` says otherwise.
// One at a time, each reading the settings when it runs, so the last one leaves the
// latest language in the file.
let dashboardQueue = Promise.resolve();
function syncDashboardFile(options) {
  const run = dashboardQueue.then(() => writeDashboard(options));
  dashboardQueue = run.catch(() => {});
  return run;
}

async function writeDashboard({ force = false, overwrite = false } = {}) {
  const { auto = true, name, folder = '' } = (await kv.get('dashboard')) || {};
  if (!auto && !force) return 'off';
  const dir = await loadFolder();
  if (!dir) return 'no-folder';
  if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return 'needs-permission';
  const lang = await currentLang();
  const linkField = linkFieldOf(await kv.get('clip'));
  const wanted = dashboardMarkdown({ linkField, lang });
  const written = await kv.get('dashboardWritten');
  const generated = [
    ...earlierDashboards({ linkField }),
    ...['zh', 'en'].map((l) => dashboardMarkdown({ linkField, lang: l })),
    ...(written ? [written] : []),
  ];
  const state = await syncDashboard(dir, wanted, dashboardFileName(name), overwrite ? null : generated, folder);
  if (state !== 'kept') await kv.set('dashboardWritten', wanted);
  return state;
}

// ---------------------------------------------------------------------------
// Toolbar badge: shows the extension is active on this site.
// ---------------------------------------------------------------------------
// PIN outranks ON: a forgotten pin sends every highlight to one note.
async function updateBadge(tabId, url) {
  const { pinned } = (await kv.get('settings')) || {};
  const text = pinned ? 'PIN' : url && siteActive(await siteConfig(), url) ? 'ON' : '';
  const { badge } = THEMES[themeOf(await kv.get('theme'))];
  await chrome.action.setBadgeBackgroundColor({ tabId, color: pinned ? '#a64d59' : badge }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

async function applyThemeIcon() {
  const { iconPrefix } = THEMES[themeOf(await kv.get('theme'))];
  await chrome.action.setIcon({ path: Object.fromEntries([16, 32, 48].map((s) => [s, `icons/${iconPrefix}${s}.png`])) });
}
applyThemeIcon().catch(() => {});

async function updateAllBadges() {
  for (const tab of await chrome.tabs.query({})) if (tab.id != null) updateBadge(tab.id, tab.url);
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') updateBadge(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) updateBadge(tabId, tab.url);
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
async function folderStatus() {
  const dir = await loadFolder();
  if (!dir) return { state: 'none' };
  return { state: await dir.queryPermission({ mode: 'readwrite' }), name: dir.name };
}

async function folderReady() {
  await syncDashboardFile().catch(() => {});
  await service.flush();
}

async function jevTest() {
  const key = await kv.get('jevKey');
  if (!key) throw new Error(t('还没有填写 Key'));
  const { json, ms } = await askJev(key, buildBlockRequest({
    paperTitle: 'Gut Microbiota and Depression',
    quote: 'Recipient mice displayed significantly reduced sucrose preference.',
    comment: 'This is the key result.',
  }), { signal: AbortSignal.timeout(JEV_TIMEOUT_MS) });
  const d = decideBlock(json.answers.block);
  return t('连接正常：{block}，概率 {p}，{ms}ms', { block: d.block, p: d.top.toFixed(2), ms: ms.toFixed(0) });
}

async function listProfiles() {
  const uploaded = new Set(((await kv.get('profiles')) || []).map((p) => p.name));
  const bundled = await getDefaultProfiles();
  const types = await service.profileTypes();
  return (await service.allProfiles()).map((p) => ({
    name: p.name,
    triggers: p.triggers,
    uploaded: uploaded.has(p.name),
    file: uploaded.has(p.name) ? null : BUNDLED_PROFILES[bundled.findIndex((b) => b.name === p.name)],
    fallback: Boolean(p.fallback),
    clipPath: p.clip?.path ?? null,
    type: types[p.name],
  }));
}

async function clipStatus({ url, tabId }) {
  return service.clipStatus({ url, isPaper: tabId == null ? false : await tabIsPaper(tabId) });
}

const HANDLERS = {
  'job:submit': (m, s) => service.submit(m.job, s.tab?.id),
  'job:confirm': (m) => service.confirm(m),
  'job:cancel': (m) => service.cancel(m),
  'job:resume': (m, s) => service.resume(m, s.tab?.id),
  'jobs:flush': () => service.flush(),
  'entry:remove': (m) => service.remove(m),
  'entry:inspect': (m) => service.inspect(m),
  'entry:recolor': (m) => service.recolor(m),
  'entry:setComment': (m) => service.setComment(m),
  'entry:move': (m) => service.move(m),
  'page:status': (m) => service.pageStatus(m.rawPage),
  'pin:set': (m) => service.setPinned(m),
  'notes:list': () => service.listNotes(),
  'folders:list': () => service.listFolders(),
  'headings:list': (m) => service.listHeadings(m),
  overview: () => service.overview(),
  'dashboard:create': (m) => syncDashboardFile({ force: true, overwrite: Boolean(m.overwrite) }),
  'orphans:scan': () => service.scanOrphans(),
  'orphans:clear': () => service.clearOrphans(),
  'profiles:list': listProfiles,
  'profile:state': (m) => service.profileState(m),
  'profile:choose': (m) => service.chooseProfile(m),
  'folder:status': folderStatus,
  'folder:ready': folderReady,
  'options:open': () => chrome.runtime.openOptionsPage(),
  'jev:test': jevTest,
  'clip:status': (m) => clipStatus(m),
  'doctypes:list': () => service.docTypes(),
  'clip:run': (m, s) => runClip({ tabId: m.tabId ?? s.tab?.id, url: m.url ?? s.tab?.url, noteName: m.noteName, force: m.force }),
  'review:status': (m, s) => service.reviewStatus({ url: m.url ?? s.tab?.url, rawPage: m.rawPage }),
  'review:save': (m, s) => service.saveReview({ url: m.url ?? s.tab?.url, rawPage: m.rawPage, text: m.text, tabId: m.tabId ?? s.tab?.id }),
  'review:open': (m) => openReview(m.tabId),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  currentLang()
    .then((lang) => {
      setLang(lang);
      return handler(msg, sender);
    })
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
  return true;
});
