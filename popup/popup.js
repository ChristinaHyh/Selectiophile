import { ruleFromInput, matchingRules, matchPattern, siteActive, siteModeOf } from '../core/sites.js';
import { themeOf, applyTheme } from '../core/theme.js';
import { applyLanguage, t } from '../core/page-i18n.js';

const $ = (id) => document.getElementById(id);
const call = async (type, payload = {}) => {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || t('后台没有响应'));
  return res.result;
};

const getList = async (key) => (await chrome.storage.local.get(key))[key] || [];

async function renderSite(tab) {
  const url = tab?.url || '';
  const webPage = /^https?:/i.test(url);
  const button = $('toggleSite');
  $('host').textContent = webPage ? new URL(url).hostname : t('这个页面无法使用');
  $('state').className = 'state';
  if (!webPage) {
    $('state').textContent = t('浏览器内置页面不能划线');
    button.hidden = true;
    return;
  }
  const mode = siteModeOf((await chrome.storage.local.get('siteMode')).siteMode);
  const key = mode === 'blacklist' ? 'blockedSites' : 'sites';
  const list = await getList(key);
  const matched = matchingRules(list, url);
  const on = siteActive({ mode, sites: mode === 'whitelist' ? list : [], blocked: mode === 'blacklist' ? list : [] }, url);
  $('state').textContent = on ? t('已启用，可以划线') : t('未启用');
  $('state').className = on ? 'state on' : 'state';

  button.hidden = mode === 'all';
  if (mode === 'all') {
    $('state').textContent = t('所有网站模式，已启用');
    return;
  }
  const inList = matched.length > 0;
  // Saved but never granted, as when the prompt was dismissed: say so and offer it again.
  const origins = matched.map(matchPattern);
  if (mode === 'whitelist' && inList && !(await chrome.permissions.contains({ origins }))) {
    $('state').textContent = t('已加入白名单，但还没有授权');
    $('state').className = 'state';
    button.textContent = t('授权这个网站');
    button.className = 'primary';
    button.onclick = async () => {
      await chrome.permissions.request({ origins }).catch(() => {});
      renderSite(tab);
    };
    return;
  }
  const label = {
    whitelist: inList ? t('移出白名单') : t('加入白名单'),
    blacklist: inList ? t('移出黑名单') : t('加入黑名单'),
  };
  button.textContent = label[mode];
  button.className = on ? '' : 'primary';
  button.onclick = async () => {
    $('siteOut').textContent = '';
    if (inList) {
      await chrome.storage.local.set({ [key]: list.filter((r) => !matched.includes(r)) });
      if (mode === 'whitelist') await chrome.permissions.remove({ origins: matched.map(matchPattern) }).catch(() => {});
    } else {
      const rule = ruleFromInput(url);
      // Saved before the prompt, because the prompt can close this popup.
      await chrome.storage.local.set({ [key]: [...list, rule] });
      if (mode === 'whitelist' && !(await chrome.permissions.request({ origins: [matchPattern(rule)] }))) {
        await chrome.storage.local.set({ [key]: list });
        $('siteOut').textContent = t('没有获得这个网站的权限');
      }
    }
    renderSite(tab);
  };
}

async function renderFolder() {
  const s = await call('folder:status');
  const grant = $('grant');
  grant.hidden = true;
  const folder = $('folder');
  const check = $('folderCheck');
  if (s.state === 'granted') {
    folder.textContent = t('文件夹：{name}', { name: s.name });
    check.className = 'check ok';
  } else if (s.state === 'none') {
    folder.textContent = t('还没有选择笔记文件夹');
    check.className = 'check err';
    grant.hidden = false;
    grant.textContent = t('去设置');
    grant.onclick = () => chrome.runtime.openOptionsPage();
  } else {
    folder.textContent = t('{name}：需要重新授权', { name: s.name });
    check.className = 'check warn';
    grant.hidden = false;
    grant.textContent = t('去设置');
    grant.onclick = () => chrome.runtime.openOptionsPage();
  }
}

const item = (top, bottom, action) => {
  const li = document.createElement('li');
  const preview = document.createElement('span');
  preview.className = 'preview';
  preview.textContent = top;
  const where = document.createElement('span');
  where.className = 'where';
  where.textContent = bottom;
  li.append(preview, where);
  if (action) li.append(action);
  return li;
};

async function renderJev() {
  const { jevKey } = await chrome.storage.local.get('jevKey');
  $('jev').textContent = jevKey ? t('Jev：已配置') : t('Jev：未配置，需手动选择内容块');
  $('jevCheck').className = jevKey ? 'check ok' : 'check warn';
}

async function renderLogo() {
  const { theme } = await chrome.storage.local.get('theme');
  $('logo').src = `../icons/icon${themeOf(theme) === 'lagoon' ? '-lagoon' : ''}.svg`;
}

// A dropdown in the panel style. `options` are { value, label }.
function fillPicker({ button, label, list, options, selected, onPick }) {
  const buttons = options.map((o) => {
    const option = document.createElement('button');
    option.setAttribute('role', 'option');
    option.dataset.value = o.value;
    option.textContent = o.label;
    option.setAttribute('aria-selected', String(o.value === selected));
    option.onclick = () => {
      buttons.forEach((b) => b.setAttribute('aria-selected', String(b === option)));
      label.textContent = o.label;
      closePickers();
      button.focus();
      onPick(o);
    };
    return option;
  });
  list.replaceChildren(...buttons);
  label.textContent = options.find((o) => o.value === selected)?.label ?? '';
  button.onclick = () => {
    const opening = list.hidden;
    closePickers();
    list.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
  };
}

function closePickers() {
  for (const list of document.querySelectorAll('.picker-list')) list.hidden = true;
  for (const button of document.querySelectorAll('.picker')) button.setAttribute('aria-expanded', 'false');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('.picker-list:not([hidden])')) {
    e.preventDefault();
    closePickers();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.picker-wrap')) closePickers();
});

let pickedNote = null;

async function renderPin(pinned, pinnedLabel) {
  const notes = await call('notes:list');
  $('pinBox').hidden = !pinned && !notes.length;
  $('pinnedRow').hidden = !pinned;
  $('pinRow').hidden = Boolean(pinned);
  closePickers();
  if (pinned) {
    $('pinned').textContent = pinnedLabel;
    return;
  }
  if (!notes.length) return;
  pickedNote = notes.find((n) => n.name === pickedNote) ? pickedNote : notes[0].name;
  fillPicker({
    button: $('pinCurrent'),
    label: $('pinLabel'),
    list: $('pinList'),
    options: notes.map((n) => ({ value: n.name, label: n.label })),
    selected: pickedNote,
    onPick: ({ value }) => { pickedNote = value; },
  });
}

// Which config this page's new note uses, as Web Clipper lets you pick a template.
async function renderProfile(tab) {
  const url = tab?.url || '';
  if (!/^https?:/i.test(url)) return;
  const state = await call('profile:state', { url });
  $('profileBox').hidden = !state.available;
  if (!state.available) return;
  fillPicker({
    button: $('profileCurrent'),
    label: $('profileLabel'),
    list: $('profileList'),
    options: [
      { value: 'auto', label: state.matched ? t('自动：{name}', { name: state.matched }) : t('自动：没有匹配的配置') },
      ...state.names.map((name) => ({ value: name, label: name })),
      { value: 'none', label: t('不使用配置') },
    ],
    selected: state.selected,
    onPick: async ({ value }) => {
      await call('profile:choose', { url, selected: value });
      renderClip(tab);
    },
  });
  await renderClip(tab);
}

// Clipping the original, for pages whose config has a body template.
async function renderClip(tab) {
  const status = await call('clip:status', { url: tab.url, tabId: tab.id }).catch(() => ({ available: false }));
  $('clipRow').hidden = !status.available;
  if (!status.available) return;
  $('clipState').textContent = status.file ? t('原文已剪藏：{name}', { name: status.label })
    : status.folder ? t('原文还没有剪藏，将存到 {folder}', { folder: status.folder }) : t('原文还没有剪藏');
  $('clipRun').textContent = status.file ? t('重新剪藏') : t('剪藏原文');
  $('clipRun').className = status.file ? 'small' : 'small primary';
  $('clipRun').onclick = async () => {
    $('clipRun').disabled = true;
    $('clipOut').textContent = t('正在剪藏原文…');
    try {
      const r = await call('clip:run', { tabId: tab.id, url: tab.url, force: Boolean(status.file) });
      $('clipOut').textContent = (r.linked ? t('已保存，并关联到《{note}》', { note: r.linked }) : t('已保存。这个网页还没有笔记，划线后会自动关联。'))
        + (r.warning ? `\n${r.warning}` : '');
    } catch (e) {
      $('clipOut').textContent = t('剪藏失败：{message}', { message: e.message });
    }
    $('clipRun').disabled = false;
    const keep = $('clipOut').textContent;
    await renderClip(tab);
    $('clipOut').textContent = keep;
  };
}

async function setPin(noteName) {
  await call('pin:set', { noteName });
  renderOverview();
}

$('pin').onclick = () => setPin(pickedNote);
$('unpin').onclick = () => setPin(null);

async function renderOverview() {
  const { pending, entries, pinned, pinnedLabel } = await call('overview');
  await renderPin(pinned, pinnedLabel);

  $('pendingBox').hidden = !pending.length;
  $('pending').replaceChildren(...pending.map((j) => {
    const discard = document.createElement('button');
    discard.className = 'quiet';
    discard.textContent = t('丢弃');
    discard.onclick = async () => {
      await call('job:cancel', { id: j.id });
      renderOverview();
    };
    const open = document.createElement('a');
    open.href = j.url;
    open.target = '_blank';
    open.textContent = t('打开来源页');
    const row = document.createElement('div');
    row.className = 'row-actions';
    row.append(open, discard);
    const li = item(j.preview, j.awaiting ? t('等待你选择') : t('等待写入'));
    li.append(row);
    return li;
  }));

  $('recentBox').hidden = !entries.length;
  $('recent').replaceChildren(...entries.map((e) => item(e.preview, `${e.noteLabel} # ${e.heading}`)));
}

$('retry').onclick = async () => {
  await call('jobs:flush');
  renderOverview();
};
$('options').onclick = () => chrome.runtime.openOptionsPage();

// A page comment is written in a window on the page itself, so the popup closes.
async function renderReview(tab) {
  if (!/^https?:/i.test(tab?.url || '')) return;
  const status = await call('review:status', { url: tab.url }).catch(() => ({ available: false }));
  if (!status.available) return;
  $('reviewBox').hidden = false;
  $('reviewState').textContent = status.text || t('还没有简评');
  $('reviewOpen').textContent = status.text ? t('修改简评') : t('写简评');
  $('reviewOpen').onclick = async () => {
    try {
      await call('review:open', { tabId: tab.id });
      window.close();
    } catch (e) {
      $('reviewOut').textContent = t('打开简评失败：{message}', { message: e.message });
    }
  };
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
await applyLanguage();
applyTheme();
await Promise.all([renderLogo(), renderSite(tab), renderReview(tab), renderProfile(tab), renderFolder(), renderJev(), renderOverview()]);
