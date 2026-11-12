// Site rules: `*.example.org` covers a domain and its subdomains; a bare host covers
// that host only. Chrome match patterns give the same meaning.

const hostOf = (input) => {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isPlainHost = (host) => host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[');

export function ruleFromInput(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  if (text.startsWith('*.')) {
    const host = hostOf(text.slice(2));
    return host ? `*.${host}` : '';
  }
  const host = hostOf(text);
  if (!host) return '';
  return isPlainHost(host) ? host : `*.${host.replace(/^www\./, '')}`;
}

export const matchPattern = (rule) => `*://${rule}/*`;

export function ruleMatches(rule, url) {
  const host = hostOf(url);
  if (!/^https?:/i.test(url) || !host) return false;
  if (!rule.startsWith('*.')) return host === rule;
  const domain = rule.slice(2);
  return host === domain || host.endsWith(`.${domain}`);
}

export const matchingRules = (rules, url) => rules.filter((r) => ruleMatches(r, url));

export const ALL_SITES = '*://*/*';
export const SITE_MODES = ['whitelist', 'blacklist', 'all'];
export const siteModeOf = (mode) => (SITE_MODES.includes(mode) ? mode : 'whitelist');

export function siteActive({ mode, sites = [], blocked = [] }, url) {
  if (!/^https?:/i.test(url || '')) return false;
  const current = siteModeOf(mode);
  if (current === 'all') return true;
  if (current === 'blacklist') return !matchingRules(blocked, url).length;
  return matchingRules(sites, url).length > 0;
}

// What to register the content script on. All-sites and blacklist modes need the
// broad permission; without it nothing runs rather than running somewhere unexpected.
export function scriptPlan({ mode, sites = [], blocked = [] }, { grantedRules = [], hasAll = false }) {
  const current = siteModeOf(mode);
  if (current === 'whitelist') return { matches: sites.filter((r) => grantedRules.includes(r)).map(matchPattern), excludeMatches: [] };
  if (!hasAll) return { matches: [], excludeMatches: [] };
  return { matches: [ALL_SITES], excludeMatches: current === 'blacklist' ? blocked.map(matchPattern) : [] };
}

// AI chat sites: their URLs say nothing about the paper under discussion. The label
// is what a note's source link shows.
const DISCUSSION_SITES = [
  ['chatgpt.com', 'GPT'],
  ['chat.openai.com', 'GPT'],
  ['claude.ai', 'Claude'],
  ['gemini.google.com', 'Gemini'],
  ['chat.deepseek.com', 'DeepSeek'],
  ['kimi.moonshot.cn', 'Kimi'],
  ['kimi.com', 'Kimi'],
  ['doubao.com', '豆包', 'Doubao'],
  ['tongyi.aliyun.com', '通义', 'Tongyi'],
  ['qianwen.com', '千问', 'Qianwen'],
  ['yuanbao.tencent.com', '元宝', 'Yuanbao'],
  ['chatglm.cn', '智谱清言', 'ChatGLM'],
  ['metaso.cn', '秘塔', 'Metaso'],
  ['perplexity.ai', 'Perplexity'],
  ['grok.com', 'Grok'],
  ['copilot.microsoft.com', 'Copilot'],
  ['chat.mistral.ai', 'Mistral'],
  ['poe.com', 'Poe'],
];

export function discussionLabel(url, lang = 'zh') {
  const host = hostOf(url);
  const site = DISCUSSION_SITES.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  if (!site) return '';
  return lang === 'en' ? site[2] || site[1] : site[1];
}

// A chat with its own address, such as /c/123. A temporary chat has none, so its
// address can't stand for one conversation.
export function conversationKey(url) {
  try {
    const { host, pathname } = new URL(url);
    return pathname.split('/').filter(Boolean).length >= 2 ? `${host}${pathname}` : null;
  } catch {
    return null;
  }
}
