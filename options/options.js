import { saveFolder, loadFolder, clearFolder } from '../core/handle.js';
import { ALL_SITES, ruleFromInput, matchPattern, siteModeOf } from '../core/sites.js';
import { THEMES, themeOf, applyTheme } from '../core/theme.js';
import { COLORS, colorList } from '../core/colors.js';
import '../core/combo.js';
import { buildBackup, parseBackup, mergeBackup, backupFileName } from '../core/backup.js';
import { leafHeadings } from '../core/note.js';
import { allTemplates, normalizeTemplateRule } from '../core/templates.js';
import { MAX_TYPES, storedTypes } from '../core/doctypes.js';
import { cleanFolderPath } from '../core/vault.js';
import { profileTemplate } from '../core/profile-template.js';
import { applyLanguage, t } from '../core/page-i18n.js';
import '../core/profile-engine.js';

const { parseProfile, profileWarnings, toClipperJson } = globalThis.SelectiophileProfiles;
const { comboFromEvent, shortcutsOf } = globalThis.SelectiophileCombo;

const DEFAULT_ROUNDS = 2;
const DEFAULT_AUTO_SAVE_PERCENT = 90;

// Redrawn in place when the language changes, see renderAll at the end.
let lang = await applyLanguage({ onChange: (next) => { lang = next; renderAll(); } });
const $ = (id) => document.getElementById(id);
const call = async (type, payload = {}) => {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || t('后台没有响应'));
  return res.result;
};

const FOLDER_TEXT = {
  granted: ['ok', (name) => t('{name}：已授权', { name })],
  prompt: ['warn', (name) => t('{name}：需要重新授权', { name })],
  denied: ['err', (name) => t('{name}：授权被拒绝', { name })],
  none: ['', () => t('还没有选择')],
};

// The vault's name, for its top level in the folder lists.
let vaultName = '';
const vaultTop = () => (vaultName ? t('库的顶层（{name}）', { name: vaultName }) : t('库的顶层'));

async function showFolder() {
  const s = await call('folder:status');
  vaultName = s.state === 'none' ? '' : s.name || '';
  const [cls, text] = FOLDER_TEXT[s.state] || FOLDER_TEXT.none;
  $('folderCheck').className = `check ${cls}`;
  $('folder').textContent = text(s.name);
  $('welcome').hidden = s.state !== 'none';
  $('regrant').hidden = s.state === 'none' || s.state === 'granted';
  if ($('regrant').hidden) $('regrant').classList.remove('primary');
}

const folderNote = (text, bad = false) => {
  $('folderOut').className = bad ? 'result bad' : 'result';
  $('folderOut').textContent = text;
};

// Writing held highlights may ask Jev about each, and the first look at a large vault
// reads every note: that goes on below, while the folder already shows as chosen.
async function folderReady() {
  folderNote(t('正在检查文件夹，写入暂存的划线…'));
  try {
    await call('folder:ready');
    folderNote('');
  } catch (e) {
    folderNote(t('文件夹已授权，但处理暂存的划线时出错：{message}', { message: e.message }), true);
  }
  renderDashboard();
}

async function folderChanged() {
  await showFolder().catch((e) => folderNote(e.message, true));
  renderDashboard();
  renderDocTypes();
  folderReady();
}

// Every outcome says something: a picker that ends without a folder, as when Chrome's
// follow-up question about editing files is dismissed, looks like a cancel.
// A dialog that never opened ends at once; one the person closed took a while.
$('pick').onclick = async () => {
  let dir;
  const started = performance.now();
  try {
    dir = await window.showDirectoryPicker({ id: 'selectiophile', mode: 'readwrite' });
  } catch (e) {
    const unopened = e.name === 'AbortError' && performance.now() - started < 600;
    console.info('Selectiophile: folder picker ended:', e.name, e.message, unopened ? '(no dialog)' : '');
    $('folderDrop').classList.toggle('attention', unopened);
    folderNote(unopened ? t('Chrome 没有打开选择窗口。请把库文件夹拖到下面的框里。')
      : e.name === 'AbortError' ? t('没有选中文件夹') : t('选择文件夹失败：{message}', { message: `${e.name}: ${e.message}` }), true);
    return;
  }
  try {
    // Chrome can hand back the folder without asking about editing. Ask at once, while
    // the click may still count; when Chrome refuses that, the re-grant button asks.
    const writable = await writeAccess(dir);
    await saveFolder(dir);
    console.info('Selectiophile: folder chosen:', dir.name, writable ? 'granted' : await dir.queryPermission({ mode: 'readwrite' }));
    if (!writable) {
      await showFolder().catch(() => {});
      askForRegrant(dir.name);
      return;
    }
  } catch (e) {
    folderNote(t('保存文件夹失败：{message}', { message: `${e.name}: ${e.message}` }), true);
    return;
  }
  folderChanged();
};

// A folder dragged from the file manager: the same kind of handle the picker gives,
// for when the system's folder dialog fails (it does on some systems after updates).
// The handle has to be asked for while the drop is handled, before anything awaits.
function acceptFolderDrop(zone, onFolder, report) {
  const files = (e) => [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file');
  zone.addEventListener('dragover', (e) => {
    if (!files(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    zone.classList.add('dropping');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropping');
  });
  zone.addEventListener('drop', async (e) => {
    if (!files(e)) return;
    e.preventDefault();
    zone.classList.remove('dropping');
    const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
    const pending = item.getAsFileSystemHandle?.();
    let handle;
    try {
      handle = await pending;
    } catch (err) {
      report(t('读取拖入的文件夹失败：{message}', { message: `${err.name}: ${err.message}` }));
      return;
    }
    if (!handle) return report(t('这个浏览器不支持拖入文件夹。'));
    if (handle.kind !== 'directory') return report(t('请拖入文件夹，而不是文件。'));
    console.info('Selectiophile: folder dropped:', handle.name);
    onFolder(handle);
  });
}

// A picked or dropped folder can come with read access only. Asking right away works
// while Chrome still counts the click; otherwise it needs another click.
async function writeAccess(dir) {
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dir.requestPermission({ mode: 'readwrite' }).catch(() => 'prompt')) === 'granted';
}

// The notes folder is chosen but not writable: point at the one button that fixes it.
function askForRegrant(name) {
  folderNote(t('已选择 {name}，还差一步：点「重新授权」，在 Chrome 的提示里选允许编辑。', { name }), true);
  $('regrant').classList.add('primary');
  $('regrant').focus();
}

// Saved before asking about editing, so a prompt that never answers loses nothing.
acceptFolderDrop($('folderCard'), async (dir) => {
  $('folderDrop').classList.remove('attention');
  await saveFolder(dir);
  await showFolder().catch(() => {});
  const writable = await writeAccess(dir);
  console.info('Selectiophile: dropped folder saved:', dir.name, writable ? 'granted' : await dir.queryPermission({ mode: 'readwrite' }));
  if (writable) {
    folderChanged();
    return;
  }
  await showFolder().catch(() => {});
  askForRegrant(dir.name);
}, (text) => folderNote(text, true));

$('regrant').onclick = async () => {
  const dir = await loadFolder();
  if (!dir) return;
  if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') {
    folderChanged();
    return;
  }
  showFolder();
};

$('saveKey').onclick = async () => {
  await chrome.storage.local.set({ jevKey: $('key').value.trim() });
  $('key').value = '';
  $('keyOut').textContent = t('Key 已保存');
};

$('testKey').onclick = async () => {
  $('keyOut').textContent = t('测试中…');
  try {
    $('keyOut').textContent = await call('jev:test');
  } catch (e) {
    $('keyOut').textContent = t('失败：{message}', { message: e.message });
  }
};

async function getMode() {
  return siteModeOf((await chrome.storage.local.get('siteMode')).siteMode);
}

// The list being edited depends on the mode.
const listKey = (mode) => (mode === 'blacklist' ? 'blockedSites' : 'sites');

async function getSites() {
  return (await chrome.storage.local.get(listKey(await getMode())))[listKey(await getMode())] || [];
}

const modeHelp = (mode) => ({
  whitelist: t('只在下面列出的网站上运行。粘贴网址或域名，比如 arxiv.org，也可以在网页上点工具栏图标添加。'),
  blacklist: t('在所有网站上运行，除了下面列出的。粘贴网址或域名，也可以在网页上点工具栏图标添加。'),
  all: t('在所有网站上运行。'),
})[mode];

async function renderMode() {
  const mode = await getMode();
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('modeHelp').textContent = modeHelp(mode);
  $('siteEditor').hidden = mode === 'all';
  $('sites').hidden = mode === 'all';
  const missing = mode !== 'whitelist' && !(await chrome.permissions.contains({ origins: [ALL_SITES] }));
  $('siteOut').textContent = missing ? t('还没有访问所有网站的权限，请重新点一次当前模式。') : '';
}

document.querySelectorAll('#modeSeg button').forEach((button) => {
  button.onclick = async () => {
    const { mode } = button.dataset;
    // Must run directly in the click for Chrome to allow the prompt.
    if (mode !== 'whitelist' && !(await chrome.permissions.request({ origins: [ALL_SITES] }))) {
      $('siteOut').textContent = t('没有获得访问所有网站的权限，模式未改变。');
      return;
    }
    await chrome.storage.local.set({ siteMode: mode });
    await renderMode();
    renderSites();
  };
});

const COMMENT_ICON = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';

function toolbarPreview(lite, shortcut) {
  const box = document.createElement('span');
  box.className = 'tb-preview';
  for (const c of COLORS) {
    const dot = document.createElement('i');
    dot.style.background = c.solid;
    box.append(dot);
  }
  const sep = document.createElement('span');
  sep.className = 'sep';
  const comment = document.createElement('span');
  comment.className = 'tb-comment';
  comment.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${COMMENT_ICON}"/></svg>`;
  if (!lite) {
    comment.append(t('评论'));
    if (shortcut) {
      const kbd = document.createElement('kbd');
      kbd.textContent = shortcut;
      comment.append(kbd);
    }
  }
  box.append(sep, comment);
  return box;
}

async function renderToolbarStyle() {
  const { toolbarStyle = 'standard', shortcuts } = await chrome.storage.local.get(['toolbarStyle', 'shortcuts']);
  const { comment } = shortcutsOf(shortcuts);
  $('toolbarSeg').replaceChildren(...[
    ['standard', 'Standard', t('颜色 + 评论 + 快捷键')],
    ['lite', 'Lite', t('只显示颜色和图标')],
  ].map(([style, name, desc]) => {
    const card = document.createElement('button');
    card.className = `theme${style === toolbarStyle ? ' on' : ''}`;
    card.dataset.style = style;
    const title = document.createElement('b');
    title.textContent = name;
    const small = document.createElement('small');
    small.textContent = desc;
    card.append(title, small, toolbarPreview(style === 'lite', comment));
    card.onclick = async () => {
      await chrome.storage.local.set({ toolbarStyle: style });
      renderToolbarStyle();
    };
    return card;
  }));
}

const SHORTCUT_INPUTS = { save: 'shortcutSave', comment: 'shortcutComment', review: 'shortcutReview' };

async function renderShortcuts() {
  const shortcuts = shortcutsOf((await chrome.storage.local.get('shortcuts')).shortcuts);
  for (const [action, id] of Object.entries(SHORTCUT_INPUTS)) $(id).value = shortcuts[action];
}

for (const [action, id] of Object.entries(SHORTCUT_INPUTS)) {
  $(id).addEventListener('keydown', async (e) => {
    if (e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    const cleared = e.key === 'Backspace' || e.key === 'Delete';
    const combo = cleared ? '' : comboFromEvent(e);
    if (!combo && !cleared) return;
    const shortcuts = shortcutsOf((await chrome.storage.local.get('shortcuts')).shortcuts);
    if (combo && Object.entries(shortcuts).some(([other, value]) => other !== action && value === combo)) {
      $('shortcutOut').textContent = t('这个快捷键已被另一项使用');
      return;
    }
    $('shortcutOut').textContent = '';
    await chrome.storage.local.set({ shortcuts: { ...shortcuts, [action]: combo } });
    await renderShortcuts();
    renderToolbarStyle();
  });
}

async function renderAutoSave() {
  const { autoSavePercent = DEFAULT_AUTO_SAVE_PERCENT } = await chrome.storage.local.get('autoSavePercent');
  $('autoSave').value = autoSavePercent;
}

$('autoSave').onchange = async () => {
  const typed = Math.round(Number($('autoSave').value));
  const value = $('autoSave').value.trim() && Number.isFinite(typed) ? Math.max(50, Math.min(100, typed)) : DEFAULT_AUTO_SAVE_PERCENT;
  $('autoSave').value = value;
  await chrome.storage.local.set({ autoSavePercent: value });
};

async function renderRounds() {
  const { discussionRounds = DEFAULT_ROUNDS } = await chrome.storage.local.get('discussionRounds');
  $('rounds').value = discussionRounds;
}

$('rounds').onchange = async () => {
  const value = Math.max(0, Math.min(20, Math.round(Number($('rounds').value)) || 0));
  $('rounds').value = value;
  await chrome.storage.local.set({ discussionRounds: value });
};

async function renderShowHighlights() {
  const { showHighlights = true } = await chrome.storage.local.get('showHighlights');
  $('showHighlights').checked = showHighlights;
}

$('showHighlights').onchange = () => chrome.storage.local.set({ showHighlights: $('showHighlights').checked });

async function renderShowFab() {
  const { showFab = true } = await chrome.storage.local.get('showFab');
  $('showFab').checked = showFab;
}

$('showFab').onchange = () => chrome.storage.local.set({ showFab: $('showFab').checked });

async function getDashboard() {
  const { dashboard } = await chrome.storage.local.get('dashboard');
  return { auto: true, name: '_dashboard', ...dashboard };
}

const saveDashboard = async (change) => chrome.storage.local.set({ dashboard: { ...(await getDashboard()), ...change } });

// The dashboard goes in a folder inside the vault, by default its top: picked from
// its subfolders, or dragged in from the file manager, so no system dialog is needed.
async function moveDashboard(folder) {
  await saveDashboard({ folder });
  const state = await call('dashboard:create').catch(() => '');
  dashNote(dashboardResult(state));
  $('dashOverwrite').hidden = state !== 'kept';
}

async function renderDashboard() {
  const dashboard = await getDashboard();
  $('dashAuto').checked = dashboard.auto;
  $('dashName').value = dashboard.name;
  $('dashFolderBox').replaceChildren(folderPicker(dashboard.folder || '', 'dashFolder', moveDashboard));
}

// A folder dragged in counts by where it is in the vault; one outside it can't be
// shown by Dataview, so it is refused. The vault's own grant covers it.
acceptFolderDrop($('dashDrop'), async (handle) => {
  const vault = await loadFolder();
  if (!vault) return dashNote(t('请先选择笔记文件夹'), true);
  const parts = await vault.resolve(handle).catch(() => null);
  if (!parts) return dashNote(t('{folder} 不在库 {vault} 里，请拖入库里的文件夹。', { folder: handle.name, vault: vault.name }), true);
  await moveDashboard(parts.join('/'));
  renderDashboard();
}, (message) => dashNote(message, true));

function dashNote(text, bad = false) {
  $('dashOut').className = bad ? 'result bad' : 'result';
  $('dashOut').textContent = text;
}

// Small parts shared by the editors below, in the style of the page's panels.
const ICON_PATHS = {
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
function svgIcon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = ICON_PATHS[name];
  return node;
}

function iconButton(name, title, onclick, { danger = false, disabled = false } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = danger ? 'icon-btn danger' : 'icon-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.disabled = disabled;
  b.append(svgIcon(name));
  b.onclick = onclick;
  return b;
}

// A dropdown drawn like the page's panels, where a native one would be the system's.
// Arrow keys move, Enter picks, Esc closes.
let closeOpenPicker = null;
function picker(options, value, onchange, { label = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'pick';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pick-btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  if (label) {
    button.title = label;
    button.setAttribute('aria-label', label);
  }
  const text = document.createElement('span');
  text.textContent = (options.find(([v]) => v === value) || [value, value])[1];
  button.append(text, svgIcon('down'));
  const list = document.createElement('div');
  list.className = 'picker-list pick-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  const items = options.map(([v, l]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(v === value));
    const name = document.createElement('span');
    name.textContent = l;
    item.append(name);
    if (v === value) item.append(svgIcon('check'));
    item.onclick = () => {
      close();
      button.focus();
      if (v !== value) onchange(v);
    };
    return item;
  });
  list.append(...items);
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  function close() {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
    if (closeOpenPicker === close) closeOpenPicker = null;
  }
  function open() {
    closeOpenPicker?.();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside, true);
    closeOpenPicker = close;
    (items.find((i) => i.getAttribute('aria-selected') === 'true') || items[0])?.focus();
  }
  button.onclick = () => (list.hidden ? open() : close());
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open();
      const at = items.indexOf(document.activeElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    return undefined;
  });
  wrap.append(button, list);
  return wrap;
}

const labelled = (node, label) => {
  node.title = label;
  node.setAttribute('aria-label', label);
  return node;
};

$('dashOverwrite').onclick = async () => {
  const state = await call('dashboard:create', { overwrite: true }).catch(() => '');
  dashNote(dashboardResult(state));
  $('dashOverwrite').hidden = true;
};

$('dashAuto').onchange = () => saveDashboard({ auto: $('dashAuto').checked });
$('dashName').onchange = async () => {
  await saveDashboard({ name: $('dashName').value.trim() || '_dashboard' });
  renderDashboard();
};

const dashboardResult = (state) => ({
  created: t('看板已创建'),
  updated: t('看板已更新'),
  same: t('看板已是最新'),
  kept: t('看板文件在 Obsidian 里改过，没有覆盖。'),
  'no-folder': t('请先选择笔记文件夹'),
  'needs-permission': t('这个文件夹需要重新授权'),
})[state] || '';

$('dashCreate').onclick = async () => {
  const state = await call('dashboard:create');
  dashNote(dashboardResult(state));
  $('dashOverwrite').hidden = state !== 'kept';
};

let orphanCount = 0;

$('scanOrphans').onclick = async () => {
  $('clearOrphans').hidden = true;
  try {
    const { highlights, pages } = await call('orphans:scan');
    orphanCount = highlights;
    $('orphanOut').className = 'result';
    if (!highlights) {
      $('orphanOut').textContent = t('没有需要清除的高亮');
      return;
    }
    $('orphanOut').textContent = t('发现 {count} 条高亮的笔记已删除，涉及 {pages} 个网页。如果笔记只是移到了所选文件夹之外，也会算作已删除。', { count: highlights, pages });
    $('clearOrphans').textContent = t('确认清除 {count} 条', { count: orphanCount });
    $('clearOrphans').hidden = false;
  } catch (e) {
    $('orphanOut').className = 'result bad';
    $('orphanOut').textContent = e.message;
  }
};

$('clearOrphans').onclick = async () => {
  $('clearOrphans').hidden = true;
  try {
    const { highlights } = await call('orphans:clear');
    $('orphanOut').className = 'result';
    $('orphanOut').textContent = t('已清除 {count} 条高亮', { count: highlights });
  } catch (e) {
    $('orphanOut').className = 'result bad';
    $('orphanOut').textContent = e.message;
  }
};


async function renderSites() {
  const mode = await getMode();
  const sites = await getSites();
  // A blacklist entry only stops the script, so it needs no permission of its own.
  const granted = await Promise.all(sites.map((r) => mode === 'blacklist' || chrome.permissions.contains({ origins: [matchPattern(r)] })));
  $('sites').replaceChildren(...sites.map((rule, i) => {
    const remove = document.createElement('button');
    remove.className = 'quiet';
    remove.textContent = t('移除');
    remove.onclick = async () => {
      await chrome.storage.local.set({ [listKey(mode)]: (await getSites()).filter((r) => r !== rule) });
      if (mode === 'whitelist') await chrome.permissions.remove({ origins: [matchPattern(rule)] }).catch(() => {});
      renderSites();
    };
    const li = document.createElement('li');
    li.append(rule);
    // Restoring a backup can add sites, but permission takes a click on each.
    if (!granted[i]) {
      li.className = 'ungranted';
      const grant = document.createElement('button');
      grant.className = 'quiet grant';
      grant.textContent = t('授权');
      grant.onclick = async () => {
        await chrome.permissions.request({ origins: [matchPattern(rule)] });
        renderSites();
      };
      li.append(grant);
    }
    li.append(remove);
    return li;
  }));
}

$('addSite').onclick = async () => {
  $('siteOut').textContent = '';
  const rule = ruleFromInput($('siteInput').value);
  if (!rule) {
    $('siteOut').textContent = t('无法识别这个网址');
    return;
  }
  const mode = await getMode();
  // Must run first and directly in the click for Chrome to allow the prompt.
  if (mode === 'whitelist' && !(await chrome.permissions.request({ origins: [matchPattern(rule)] }))) {
    $('siteOut').textContent = t('没有获得这个网站的权限');
    return;
  }
  const sites = await getSites();
  if (!sites.includes(rule)) await chrome.storage.local.set({ [listKey(mode)]: [...sites, rule] });
  $('siteInput').value = '';
  renderSites();
};

async function renderThemes() {
  const current = themeOf((await chrome.storage.local.get('theme')).theme);
  $('brandIcon').src = `../icons/icon${current === 'lagoon' ? '-lagoon' : ''}.svg`;
  $('themes').replaceChildren(...Object.entries(THEMES).map(([id, theme]) => {
    const card = document.createElement('button');
    card.className = 'theme';
    card.dataset.theme = id;
    card.setAttribute('aria-pressed', String(id === current));
    const top = document.createElement('span');
    top.className = 'top';
    const img = document.createElement('img');
    img.src = `../icons/icon${id === 'lagoon' ? '-lagoon' : ''}.svg`;
    img.alt = '';
    const text = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = t(theme.name);
    const desc = document.createElement('small');
    desc.textContent = t(theme.desc);
    text.append(name, desc);
    top.append(img, text);
    const strip = document.createElement('span');
    strip.className = 'strip';
    for (const color of theme.palette) {
      const swatch = document.createElement('i');
      swatch.style.background = color;
      strip.append(swatch);
    }
    card.append(top, strip);
    card.onclick = async () => {
      await chrome.storage.local.set({ theme: id });
      renderThemes();
    };
    return card;
  }));
}

async function renderColors() {
  const names = (await chrome.storage.local.get('colors')).colors || {};
  $('colors').replaceChildren(...colorList(names, lang).map((c) => {
    const row = document.createElement('div');
    row.className = 'color-row';
    const dot = document.createElement('i');
    dot.style.background = c.solid;
    const label = document.createElement('span');
    label.textContent = c.label;
    const input = document.createElement('input');
    input.value = c.purpose;
    input.placeholder = t('用途，比如 方法、结论');
    input.dataset.color = c.id;
    input.maxLength = 20;
    input.onchange = async () => {
      const current = (await chrome.storage.local.get('colors')).colors || {};
      await chrome.storage.local.set({ colors: { ...current, [c.id]: input.value.trim() } });
      $('colorOut').textContent = t('{label}已保存', { label: c.label });
    };
    row.append(dot, label, input);
    return row;
  }));
}

const PROFILE_ERRORS = {
  'bad-json': (file) => t('{file}：这不是有效的 JSON 文件', { file }),
  'no-properties': (file) => t('{file}：没有可用的 properties', { file }),
  'no-triggers': (file) => t('{file}：没有 triggers，无法匹配网页', { file }),
};

const BUILTIN_FILES = { paper: 'Reading Template.md', article: 'Article Template.md' };

const getStoredTemplates = async () => (await chrome.storage.local.get('templates')).templates || [];

async function currentTemplates() {
  const { templates = [], templateText } = await chrome.storage.local.get(['templates', 'templateText']);
  return allTemplates(templates, templateText);
}

// Changes one template's stored entry, creating it for a built-in on first use.
async function patchTemplate(id, change) {
  const stored = await getStoredTemplates();
  const found = stored.find((x) => x.id === id);
  await chrome.storage.local.set({
    templates: found ? stored.map((x) => (x.id === id ? { ...x, ...change } : x)) : [...stored, { id, ...change }],
  });
}

const makeButton = (label, onClick, className = 'small') => {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.onclick = onClick;
  return button;
};

// A type the person added starts from the article template.
async function templateTextOf(template) {
  return template.text || (await fetch(chrome.runtime.getURL(BUILTIN_FILES[template.id] || BUILTIN_FILES.article))).text();
}

function downloadText(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let uploadTarget = null;

function chooseFile(input, typeId) {
  uploadTarget = typeId;
  $(input).click();
}

// undefined until first read, null when the folder can't be read.
let subfolders;
// Why the list couldn't be read, when the folder is granted but reading failed.
let subfolderError = '';

async function readSubfolders() {
  let error = '';
  const next = await call('folders:list').catch((e) => {
    error = e.message;
    return null;
  });
  const changed = JSON.stringify(next) !== JSON.stringify(subfolders) || error !== subfolderError;
  subfolders = next;
  subfolderError = error;
  return changed;
}

function subfolderNote(query) {
  if (subfolders === undefined) return t('正在读取子文件夹…');
  if (subfolderError) return t('读取子文件夹失败：{message}。也可以直接输入名称', { message: subfolderError });
  if (subfolders === null) return t('读取不到子文件夹，请先授权文件夹。也可以直接输入名称');
  return subfolders.length || query ? '' : t('还没有子文件夹，可以直接输入名称');
}

// An input with a list: pick an existing subfolder, or type a name to have it created
// with the first note. The list is read again on each opening, so a folder just made in
// Obsidian shows up without reloading this page.
function folderPicker(value, id, onSave) {
  const wrap = document.createElement('div');
  wrap.className = 'folder-combo';
  const input = document.createElement('input');
  input.id = id;
  input.autocomplete = 'off';
  input.placeholder = vaultTop();
  input.value = cleanFolderPath(value);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-list`);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'folder-toggle';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', t('显示子文件夹'));
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const list = document.createElement('div');
  list.id = `${id}-list`;
  list.className = 'picker-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(input, toggle, list);

  let saved = input.value;
  // Only typing narrows the list, so opening it always shows every folder.
  let query = '';
  let rows = [];
  let active = -1;

  const save = async (value) => {
    input.value = cleanFolderPath(value);
    if (input.value === saved) return;
    saved = input.value;
    await onSave(saved);
  };

  const close = () => {
    list.hidden = true;
    wrap.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const pick = (value) => {
    close();
    save(value);
  };

  const paint = () => {
    const known = subfolders || [];
    const current = cleanFolderPath(input.value);
    const wanted = query.toLowerCase();
    // The highlight stays on its folder when a fresh read shifts the rows.
    const activeValue = rows[active]?.value;
    rows = [
      ...(query ? [] : [{ value: '' }]),
      ...known.filter((name) => name.toLowerCase().includes(wanted)).map((value) => ({ value })),
    ];
    const typed = query || current;
    if (subfolders && typed && !known.includes(typed)) rows.push({ value: typed, isNew: true });
    active = rows.findIndex((row) => row.value === activeValue);
    const buttons = rows.map((row, i) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.tabIndex = -1;
      option.id = `${id}-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(row.value === current));
      option.classList.toggle('active', i === active);
      if (row.isNew) {
        option.textContent = t('新建文件夹：{name}', { name: row.value });
      } else if (!row.value) {
        option.textContent = vaultTop();
      } else {
        const cut = row.value.lastIndexOf('/') + 1;
        const parent = document.createElement('span');
        parent.className = 'parent';
        parent.textContent = row.value.slice(0, cut);
        option.append(parent, row.value.slice(cut));
      }
      option.onclick = () => pick(row.value);
      return option;
    });
    const note = subfolderNote(query);
    const noteRow = document.createElement('div');
    noteRow.className = 'picker-note';
    noteRow.textContent = note;
    list.replaceChildren(...buttons, ...(note ? [noteRow] : []));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', buttons[active].id);
      buttons[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const show = () => {
    list.hidden = false;
    wrap.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  };

  const open = async () => {
    if (!list.hidden) return;
    query = '';
    show();
    paint();
    active = rows.findIndex((row) => row.value === cleanFolderPath(input.value));
    paint();
    list.scrollIntoView({ block: 'nearest' });
    if ((await readSubfolders()) && !list.hidden) {
      paint();
      list.scrollIntoView({ block: 'nearest' });
    }
  };

  input.onclick = open;
  input.oninput = () => {
    query = cleanFolderPath(input.value);
    active = -1;
    if (list.hidden) show();
    paint();
  };
  input.onblur = () => {
    close();
    save(input.value);
  };
  input.onkeydown = (e) => {
    // Enter and arrows belong to the IME while it is composing Chinese.
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) {
        open();
      } else if (rows.length) {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        active = active < 0 && step < 0 ? rows.length - 1 : (active + step + rows.length) % rows.length;
        paint();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(!list.hidden && active >= 0 ? rows[active].value : input.value);
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      close();
    }
  };
  // Clicks in the list and on the arrow must not take focus, or blur would close it first.
  toggle.onmousedown = (e) => e.preventDefault();
  list.onmousedown = (e) => e.preventDefault();
  toggle.onclick = () => {
    if (list.hidden) {
      input.focus();
      open();
    } else {
      close();
    }
  };
  return wrap;
}

// ---------------------------------------------------------------------------
// Document types: each with its metadata configs, note template and clipping.
// ---------------------------------------------------------------------------
const typeName = (type) => (type.builtin ? { paper: t('学术文献'), article: t('网页文章') }[type.id] : type.name);
const templateLabel = (type) => (type.builtin
  ? { paper: t('学术文献模板'), article: t('网页文章模板') }[type.id]
  : t('{name}模板', { name: type.name }));

async function saveTypes(change) {
  const types = await call('doctypes:list');
  change(types);
  await chrome.storage.local.set({ docTypes: storedTypes(types) });
}

const patchType = (id, patch) => saveTypes((types) => {
  const found = types.find((x) => x.id === id);
  if (found) Object.assign(found, patch);
});

async function setProfileType(name, typeId) {
  const { profileTypes = {} } = await chrome.storage.local.get('profileTypes');
  await chrome.storage.local.set({ profileTypes: { ...profileTypes, [name]: typeId } });
}

const blockTitle = (text) => Object.assign(document.createElement('h4'), { className: 'type-block-title', textContent: text });

function docNote(messages) {
  $('docOut').replaceChildren(...messages.map((m) => {
    const line = document.createElement('div');
    line.textContent = m.text;
    if (m.bad) line.className = 'bad';
    return line;
  }));
}

function profileRow(p, type, types) {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.name;
  const trigger = document.createElement('span');
  trigger.className = 'trigger';
  trigger.textContent = p.fallback ? t('没有专用配置的网页') : p.triggers.join('  ');
  trigger.title = p.fallback ? '' : p.triggers.join('\n');
  const kind = document.createElement('span');
  kind.className = p.uploaded ? 'kind mine' : 'kind';
  kind.textContent = p.uploaded ? t('已上传') : t('内置');
  li.append(name, trigger, kind);
  const others = types.filter((x) => x.id !== type.id);
  // The general config belongs with web articles: it decides what isn't a paper.
  if (!p.fallback && others.length) {
    li.append(picker([['', t('移到…')], ...others.map((x) => [x.id, typeName(x)])], '', async (v) => {
      await setProfileType(p.name, v);
      renderDocTypes();
    }, { label: t('把 {name} 移到其他类别', { name: p.name }) }));
  }
  li.append(makeButton(t('下载'), async () => {
    const text = p.file
      ? await (await fetch(chrome.runtime.getURL(`profiles/${p.file}`))).text()
      : JSON.stringify(toClipperJson((await chrome.storage.local.get('profiles')).profiles.find((x) => x.name === p.name)), null, 2);
    downloadText(p.file || `${p.name}.json`, text, 'application/json');
  }, 'quiet'));
  if (p.uploaded) {
    li.append(makeButton(t('移除'), async () => {
      const { profiles: stored = [] } = await chrome.storage.local.get('profiles');
      await chrome.storage.local.set({ profiles: stored.filter((x) => x.name !== p.name) });
      renderDocTypes();
    }, 'quiet'));
  }
  return li;
}

function templateBlock(type, template) {
  const box = document.createElement('div');
  box.className = 'tpl';
  box.dataset.id = type.id;
  const head = document.createElement('div');
  head.className = 'tpl-head';
  const name = document.createElement('span');
  name.className = 'tpl-name';
  name.textContent = templateLabel(type);
  const state = document.createElement('span');
  state.className = 'tpl-state';
  state.textContent = template.text
    ? t('已上传（{count} 个内容块）', { count: leafHeadings(template.text).length })
    : type.builtin ? t('内置') : t('未上传，暂用网页文章模板');
  head.append(name, state);

  // Pages on these sites start their notes from this template, without asking.
  const sites = document.createElement('div');
  sites.className = 'tpl-sites';
  for (const rule of template.sites || []) {
    const chip = document.createElement('span');
    chip.className = 'rule';
    chip.append(rule, makeButton(t('移除'), async () => {
      await patchTemplate(type.id, { sites: template.sites.filter((r) => r !== rule) });
      renderDocTypes();
    }, 'quiet'));
    sites.append(chip);
  }
  const add = document.createElement('div');
  add.className = 'tpl-add';
  const input = labelled(document.createElement('input'), t('直接用这个模板的网站'));
  input.placeholder = t('直接用这个模板的网站，比如 *.substack.com/p/*');
  const addRule = async () => {
    const rule = normalizeTemplateRule(input.value);
    if (!rule) {
      docNote([{ bad: true, text: t('无法识别这个网址') }]);
      return;
    }
    docNote([]);
    // A site belongs to one template, or which one applies would be unclear.
    const all = await currentTemplates();
    await Promise.all(all.filter((x) => x.id !== type.id && x.sites.includes(rule))
      .map((x) => patchTemplate(x.id, { sites: x.sites.filter((r) => r !== rule) })));
    if (!(template.sites || []).includes(rule)) await patchTemplate(type.id, { sites: [...(template.sites || []), rule] });
    renderDocTypes();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) addRule();
  };
  add.append(input, makeButton(t('添加'), addRule));

  const folderRow = document.createElement('div');
  folderRow.className = 'tpl-folder';
  const folderLabel = document.createElement('label');
  folderLabel.textContent = t('笔记保存到');
  folderLabel.htmlFor = `tpl-folder-${type.id}`;
  folderRow.append(folderLabel, folderPicker(template.folder, folderLabel.htmlFor, (folder) => patchTemplate(type.id, { folder })));

  const actions = document.createElement('div');
  actions.className = 'tpl-actions';
  actions.append(makeButton(t('上传模板'), () => chooseFile('templateFile', type.id)));
  actions.append(makeButton(t('下载'), async () => downloadText(`${templateLabel(type)}.md`, await templateTextOf(template))));
  if (template.text) {
    actions.append(makeButton(type.builtin ? t('恢复内置模板') : t('移除上传的模板'), async () => {
      await patchTemplate(type.id, { text: null });
      if (type.id === 'paper') await chrome.storage.local.remove('templateText');
      renderDocTypes();
    }));
  }
  box.append(head, ...(template.sites?.length ? [sites] : []), add, folderRow, actions);
  return box;
}

function clipBlock(type, profiles, fallbackPath) {
  const box = document.createElement('div');
  box.className = 'type-clip';
  // Whether the page clips by itself; if not, from the toolbar icon.
  const toggle = document.createElement('label');
  toggle.className = 'toggle';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.dataset.clip = 'autoClip';
  check.checked = type.autoClip;
  check.onchange = () => patchType(type.id, { autoClip: check.checked });
  toggle.append(check, Object.assign(document.createElement('span'), { textContent: t('自动剪藏') }));
  const help = document.createElement('p');
  help.className = 'help toggle-help';
  help.textContent = t('创建笔记/页面简评时是否自动剪藏。关闭时，可以点工具栏图标手动剪藏。');

  // The configs' own folders show until one is set for the whole type.
  const own = [...new Set(profiles.map((p) => p.clipPath).filter((x) => x && !x.includes('{{')))];
  const placeholder = (own.length ? own : [fallbackPath].filter(Boolean)).join(t('、'));
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.textContent = t('剪藏到');
  label.htmlFor = `clip-path-${type.id}`;
  const input = document.createElement('input');
  input.id = label.htmlFor;
  input.value = type.clipPath;
  input.placeholder = placeholder;
  input.maxLength = 120;
  input.onchange = async () => {
    input.value = cleanFolderPath(input.value);
    await patchType(type.id, { clipPath: input.value });
  };
  field.append(label, input);
  box.append(toggle, help, field);
  return box;
}

// Which types are folded, kept across visits; all open at first.
let foldedTypes = new Set();
async function readFolded() {
  const { foldedTypes: stored = [] } = await chrome.storage.local.get('foldedTypes');
  foldedTypes = new Set(stored);
}
const saveFolded = () => chrome.storage.local.set({ foldedTypes: [...foldedTypes] });

function typeCard(type, types, profiles, templates) {
  const card = document.createElement('div');
  card.className = 'card doc-type';
  card.dataset.type = type.id;
  const head = document.createElement('div');
  head.className = 'type-head';
  const body = document.createElement('div');
  body.className = 'type-body';
  body.id = `type-body-${type.id}`;
  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'icon-btn type-fold';
  fold.setAttribute('aria-controls', body.id);
  fold.append(svgIcon('down'));
  const summary = document.createElement('span');
  summary.className = 'type-summary';
  const setFolded = (folded) => {
    card.classList.toggle('folded', folded);
    body.hidden = folded;
    fold.setAttribute('aria-expanded', String(!folded));
    const label = folded ? t('展开') : t('收起');
    fold.title = label;
    fold.setAttribute('aria-label', `${label}：${typeName(type)}`);
  };
  fold.onclick = () => {
    const folded = !card.classList.contains('folded');
    setFolded(folded);
    if (folded) foldedTypes.add(type.id);
    else foldedTypes.delete(type.id);
    saveFolded();
  };
  head.append(fold);
  if (type.builtin) {
    const title = Object.assign(document.createElement('h3'), { textContent: typeName(type) });
    title.onclick = () => fold.click();
    head.append(title);
  } else {
    const rename = labelled(document.createElement('input'), t('类别名称'));
    rename.className = 'type-rename';
    rename.value = type.name;
    rename.maxLength = 40;
    rename.onchange = async () => {
      await patchType(type.id, { name: rename.value.trim() || type.name });
      renderDocTypes();
    };
    head.append(rename, iconButton('trash', t('删除类别'), async () => {
      if (!window.confirm(t('删除类别"{name}"？它上传的模板会一起删除，配置会回到学术文献。', { name: type.name }))) return;
      await saveTypes((all) => all.splice(all.findIndex((x) => x.id === type.id), 1));
      await chrome.storage.local.set({ templates: (await getStoredTemplates()).filter((x) => x.id !== type.id) });
      renderDocTypes();
    }, { danger: true }));
  }

  const mine = profiles.filter((p) => p.type === type.id);
  const list = document.createElement('ul');
  list.className = 'rows';
  list.append(...mine.map((p) => profileRow(p, type, types)));
  const empty = document.createElement('p');
  empty.className = 'help';
  empty.textContent = t('还没有配置。上传配置后，它匹配的网页归入这一类。');
  const upload = document.createElement('div');
  upload.className = 'inline upload-row';
  upload.append(makeButton(t('上传配置'), () => chooseFile('profileFile', type.id)));

  const template = templates.find((x) => x.id === type.id) || { id: type.id, builtin: false, name: type.name, folder: '', text: null, sites: [] };
  const fallback = profiles.find((p) => p.fallback)?.clipPath || '';
  body.append(
    blockTitle(t('元数据配置')), ...(mine.length ? [list] : [empty]), upload,
    blockTitle(t('笔记模板')), templateBlock(type, template),
    blockTitle(t('剪藏')), clipBlock(type, mine, fallback),
  );
  // Folded, the head still says what the type holds.
  summary.textContent = [
    t('{n} 个配置', { n: mine.length }),
    type.autoClip ? t('自动剪藏') : '',
  ].filter(Boolean).join(' · ');
  head.querySelector('h3, .type-rename').after(summary);
  card.append(head, body);
  setFolded(foldedTypes.has(type.id));
  return card;
}

async function renderDocTypes() {
  const [types, profiles, templates] = await Promise.all([
    call('doctypes:list'), call('profiles:list').catch(() => []), currentTemplates(), readFolded(),
  ]);
  $('docTypes').replaceChildren(...types.map((type) => typeCard(type, types, profiles, templates)));
  $('addDocType').disabled = types.length >= MAX_TYPES;
  readSubfolders();
}

$('addDocType').onclick = async () => {
  const id = crypto.randomUUID().slice(0, 8);
  await saveTypes((types) => types.push({ id, builtin: false, name: t('新类别'), autoClip: false, clipPath: '' }));
  await renderDocTypes();
  const input = $('docTypes').querySelector(`[data-type="${id}"] .type-rename`);
  input?.focus();
  input?.select();
};

$('profileTemplate').onclick = () => {
  downloadText('selectiophile-config-template.json', JSON.stringify(profileTemplate(lang), null, 2), 'application/json');
};

$('profileFile').onchange = async () => {
  const files = [...$('profileFile').files];
  const typeId = uploadTarget;
  $('profileFile').value = '';
  const messages = [];
  const { profiles: stored = [] } = await chrome.storage.local.get('profiles');
  let next = stored;
  const placed = [];
  for (const file of files) {
    try {
      const profile = parseProfile(await file.text());
      next = [profile, ...next.filter((p) => p.name !== profile.name)];
      if (!profile.fallback) placed.push(profile.name);
      messages.push({ text: t('已添加配置"{name}"', { name: profile.name }) });
      const { unknownFilters, schemaTriggers } = profileWarnings(profile);
      if (unknownFilters.length) messages.push({ bad: true, text: t('"{name}"：不支持的过滤器 {filters}，这些步骤会被跳过', { name: profile.name, filters: unknownFilters.join(', ') }) });
      if (schemaTriggers.length) messages.push({ bad: true, text: t('"{name}"：schema 触发条件不支持，已忽略', { name: profile.name }) });
    } catch (e) {
      messages.push({ bad: true, text: (PROFILE_ERRORS[e.code] || PROFILE_ERRORS['bad-json'])(file.name) });
    }
  }
  await chrome.storage.local.set({ profiles: next });
  if (typeId) for (const name of placed) await setProfileType(name, typeId);
  docNote(messages);
  renderDocTypes();
};

$('templateFile').onchange = async () => {
  const [file] = $('templateFile').files;
  $('templateFile').value = '';
  if (!file || !uploadTarget) return;
  const text = await file.text();
  if (!leafHeadings(text).length) {
    docNote([{ bad: true, text: t('这个模板没有标题，无法归类划线') }]);
    return;
  }
  docNote([]);
  await patchTemplate(uploadTarget, { text });
  if (uploadTarget === 'paper') await chrome.storage.local.remove('templateText');
  renderDocTypes();
};

function renderLang() {
  document.querySelectorAll('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

document.querySelectorAll('#langSeg button').forEach((button) => {
  button.onclick = () => chrome.storage.local.set({ lang: button.dataset.lang });
});

$('exportData').onclick = async () => {
  const now = new Date();
  const backup = buildBackup(await chrome.storage.local.get(null), now);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName(now);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const count = Object.entries(backup.data).filter(([k]) => k.startsWith('hl:')).reduce((n, [, v]) => n + Object.keys(v).length, 0);
  $('backupOut').className = 'result';
  $('backupOut').textContent = t('已导出 {count} 条高亮', { count });
};

$('importData').onclick = () => $('importFile').click();

const backupError = (e) => ({
  'bad-json': t('这不是有效的 JSON 文件'),
  'not-backup': t('这不是 Selectiophile 的备份文件'),
  'bad-version': t('不支持这个备份版本：{version}', { version: e.version }),
})[e.code] || e.message;

$('importFile').onchange = async () => {
  const [file] = $('importFile').files;
  $('importFile').value = '';
  if (!file) return;
  try {
    const { data } = parseBackup(await file.text());
    const { patch, highlights } = mergeBackup(await chrome.storage.local.get(null), data);
    await chrome.storage.local.set(patch);
    $('backupOut').className = 'result';
    $('backupOut').textContent = t('已恢复，新增 {count} 条高亮。刷新网页后显示。', { count: highlights });
    await Promise.all([renderMode(), renderSites(), renderColors(), renderThemes(), renderToolbarStyle(), renderDocTypes(), renderShortcuts(), renderAutoSave(), renderRounds(), renderShowHighlights(), renderShowFab(), renderDashboard()]);
  } catch (e) {
    $('backupOut').className = 'result bad';
    $('backupOut').textContent = t('恢复失败：{message}', { message: backupError(e) });
  }
};

function trackActiveSection() {
  const links = [...document.querySelectorAll('.nav a')];
  const nav = document.querySelector('.nav');
  // On a narrow screen the links are a row that scrolls: the current one stays in view.
  const setActive = (id) => links.forEach((a) => {
    const on = a.getAttribute('href') === `#${id}`;
    a.classList.toggle('active', on);
    if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' });
  });
  setActive(links[0].getAttribute('href').slice(1));
  const observer = new IntersectionObserver((seen) => {
    const visible = seen.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) setActive(visible.target.id);
  }, { rootMargin: '-10% 0px -70% 0px' });
  document.querySelectorAll('main section').forEach((s) => observer.observe(s));
}

function renderAll() {
  closeOpenPicker?.();
  // Folder lists name the vault, so they wait for it.
  showFolder().catch(() => {}).then(() => {
    renderDocTypes();
    renderDashboard();
  });
  renderMode();
  renderSites();
  renderThemes();
  renderToolbarStyle();
  renderColors();
  renderLang();
  renderShortcuts();
  renderAutoSave();
  renderRounds();
  renderShowHighlights();
  renderShowFab();
}

applyTheme();
renderAll();
trackActiveSection();
