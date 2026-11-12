// Export and import of the plugin's own data: page highlights (position and color),
// page-to-note links, clipped originals, page comments, color purposes, sites and display choices. The Jev key never leaves the browser,
// and the folder permission can't be exported, so it is chosen again after a restore.

const BACKUP_VERSION = 1;
const isHighlightKey = (key) => key.startsWith('hl:');
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const keepValid = (map, isValid) =>
  (isObject(map) ? Object.fromEntries(Object.entries(map).filter(([, v]) => isValid(v))) : {});

const VALIDATORS = {
  discussions: (v) => isObject(v) && Array.isArray(v.notes) && v.notes.every((n) => typeof n === 'string'),
  bindings: (v) => typeof v === 'string',
  colors: (v) => typeof v === 'string',
  entries: (v) => isObject(v) && typeof v.noteName === 'string' && typeof v.at === 'number',
  pending: (v) => isObject(v) && typeof v.quote === 'string' && isObject(v.page),
  clips: (v) => isObject(v) && typeof v.file === 'string' && typeof v.at === 'number',
  reviews: (v) => isObject(v) && typeof v.text === 'string' && typeof v.at === 'number',
};
const isHighlight = (v) => isObject(v) && typeof v.anchor === 'string';
const isProfile = (v) => isObject(v) && typeof v.name === 'string' && Array.isArray(v.triggers) && Array.isArray(v.properties);
const isSiteRule = (v) => typeof v === 'string' && /^(\*\.)?[a-z0-9.[\]:-]+$/i.test(v);

const SITE_LISTS = ['sites', 'blockedSites'];
const SCALARS = ['theme', 'toolbarStyle', 'siteMode', 'lang', 'templateText'];
// Settings held whole, each checked for its own shape.
const SETTINGS = {
  dashboard: (v) => isObject(v) && typeof v.auto === 'boolean' && typeof v.name === 'string',
  shortcuts: (v) => isObject(v) && Object.values(v).every((x) => typeof x === 'string'),
  discussionRounds: (v) => Number.isInteger(v) && v >= 0 && v <= 20,
  templates: (v) => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.id === 'string' && (x.sites === undefined || Array.isArray(x.sites))),
  showHighlights: (v) => typeof v === 'boolean',
  showFab: (v) => typeof v === 'boolean',
  autoSavePercent: (v) => Number.isInteger(v) && v >= 50 && v <= 100,
  clip: (v) => isObject(v) && ['ask', 'auto', 'off'].includes(v.mode) && typeof v.field === 'string',
  profileLinks: (v) => isObject(v) && Object.values(v).every((l) => isObject(l) && ['template', 'clipPath'].every((k) => l[k] === undefined || typeof l[k] === 'string')),
  docTypes: (v) => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.id === 'string'
    && (x.name === undefined || typeof x.name === 'string') && (x.clipPath === undefined || typeof x.clipPath === 'string')
    && (x.autoClip === undefined || typeof x.autoClip === 'boolean')),
  profileTypes: (v) => isObject(v) && Object.values(v).every((x) => typeof x === 'string'),
};

const pad = (n) => String(n).padStart(2, '0');

export const backupFileName = (d) =>
  `selectiophile-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;

export function buildBackup(storage, now = new Date()) {
  const data = {};
  for (const [key, value] of Object.entries(storage)) {
    if (key === 'profiles') data.profiles = value;
    else if (key in VALIDATORS || isHighlightKey(key) || SITE_LISTS.includes(key) || SCALARS.includes(key) || key in SETTINGS) data[key] = value;
  }
  return { app: 'selectiophile', version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
}

// Keeps only known, well-formed fields, so a hand-edited or foreign file can't put
// anything else into storage.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('bad json'), { code: 'bad-json' });
  }
  // Backups made before the rename say `lectiophile`.
  if (!['selectiophile', 'lectiophile'].includes(parsed?.app) || !isObject(parsed.data)) throw Object.assign(new Error('not a backup'), { code: 'not-backup' });
  if (parsed.version !== BACKUP_VERSION) throw Object.assign(new Error('bad version'), { code: 'bad-version', version: parsed.version });
  const data = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (key in VALIDATORS) data[key] = keepValid(value, VALIDATORS[key]);
    else if (isHighlightKey(key)) data[key] = keepValid(value, isHighlight);
    else if (key === 'profiles' && Array.isArray(value)) data.profiles = value.filter(isProfile);
    else if (SITE_LISTS.includes(key) && Array.isArray(value)) data[key] = value.filter(isSiteRule);
    else if (SCALARS.includes(key) && typeof value === 'string') data[key] = value;
    else if (key in SETTINGS && SETTINGS[key](value)) data[key] = value;
  }
  return { data, exportedAt: parsed.exportedAt };
}

// Merging never removes anything. For a record present on both sides the local copy
// wins, since it may be newer; color purposes and the theme are choices, so the file wins.
export function mergeBackup(current, data) {
  const patch = {};
  let highlights = 0;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'profiles') {
      const names = new Set(value.map((p) => p.name));
      patch.profiles = [...value, ...(current.profiles || []).filter((p) => !names.has(p.name))];
    } else if (SITE_LISTS.includes(key)) {
      patch[key] = [...new Set([...(current[key] || []), ...value])];
    } else if (SCALARS.includes(key) || key in SETTINGS) {
      patch[key] = value;
    } else if (key === 'colors') {
      patch.colors = { ...current.colors, ...value };
    } else {
      patch[key] = { ...value, ...current[key] };
      if (isHighlightKey(key)) highlights += Object.keys(value).filter((id) => !current[key]?.[id]).length;
    }
  }
  return { patch, highlights };
}
