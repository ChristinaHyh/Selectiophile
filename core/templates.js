// Note templates. Two always exist, for papers and for other articles; more can be
// added. A template's site rules only decide which one a new note starts from.
import { ruleFromInput, ruleMatches } from './sites.js';

export const BUILTIN_TEMPLATES = ['paper', 'article'];

const isBuiltin = (id) => BUILTIN_TEMPLATES.includes(id);

// Stored entries add a text and sites to a built-in, or are whole custom templates.
// `legacyText` is the single template earlier versions kept.
export function allTemplates(stored = [], legacyText = null) {
  const byId = new Map(stored.map((t) => [t.id, t]));
  const builtins = BUILTIN_TEMPLATES.map((id) => ({
    id,
    builtin: true,
    name: '',
    sites: byId.get(id)?.sites || [],
    folder: byId.get(id)?.folder || '',
    text: byId.get(id)?.text ?? (id === 'paper' ? legacyText : null),
  }));
  const custom = stored.filter((t) => !isBuiltin(t.id)).map((t) => ({ sites: [], ...t, builtin: false }));
  return [...custom, ...builtins];
}

// A rule is a plain domain, or a pattern with `*` standing for anything: `*.substack.com`,
// `*.substack.*`, `news.*`, `x.com/*/status/*`, `https://a.org/blog/*`.
const isPattern = (rule) => rule.includes('/') || rule.replace(/^\*\./, '').includes('*');

// Returns '' for what can't be a rule. A pasted URL with no `*` means its whole domain.
export function normalizeTemplateRule(input) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return '';
  const bare = text.replace(/^(https?|\*):\/\//i, '');
  if (!bare.replace(/^\*\./, '').includes('*')) return ruleFromInput(text);
  return bare;
}

const escapeRegExp = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function patternMatches(rule, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  const wholeDomain = rule.startsWith('*.');
  const body = (wholeDomain ? rule.slice(2) : rule).split('*').map(escapeRegExp).join('.*');
  const regex = new RegExp(`^${wholeDomain ? '(?:[^/]*\\.)?' : ''}${body}$`, 'i');
  const rest = rule.includes('/') ? `${parsed.pathname}${parsed.search}` : '';
  return [parsed.hostname, parsed.hostname.replace(/^www\./, '')].some((host) => regex.test(host + rest));
}

export const templateRuleMatches = (rule, url) => (isPattern(rule) ? patternMatches(rule, url) : ruleMatches(rule, url));

// The more literal text a rule has, the more specific it is.
const specificity = (rule) => rule.replace(/\*/g, '').length;

// The most specific matching rule wins, then custom templates. Otherwise a paper gets the
// paper template and anything else the article one. `matched` says a rule chose it.
export function pickTemplate(templates, url, isPaper) {
  let byRule = null;
  let best = -1;
  for (const template of templates) {
    for (const rule of template.sites) {
      if (specificity(rule) > best && templateRuleMatches(rule, url)) {
        byRule = template;
        best = specificity(rule);
      }
    }
  }
  if (byRule) return { template: byRule, matched: true };
  return { template: templates.find((t) => t.id === (isPaper ? 'paper' : 'article')), matched: false };
}
