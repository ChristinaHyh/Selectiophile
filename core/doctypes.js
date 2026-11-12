// Document types: papers, web articles, and any the person adds. Each has its
// metadata configs, one note template (stored under the type's id in `templates`),
// whether its pages are clipped by themselves (`autoClip`: when a note is first made
// or a page comment is saved), and the folder clips go to.
// No browser APIs, so the settings page and the service share it, and Node tests it.

export const BUILTIN_TYPES = ['paper', 'article'];
export const MAX_TYPES = 12;

const DEFAULT_AUTO_CLIP = { paper: true, article: false };

const cleanPath = (path) => String(path ?? '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/');
const cleanName = (name) => String(name ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);

// What is stored, or, before the person changed anything, what earlier versions'
// settings mean: a custom template was a kind of document of its own, the clip mode
// applied to all, and the general article folder belonged to web articles.
export function docTypesOf(stored, legacy = {}) {
  if (Array.isArray(stored) && stored.length) {
    const byId = new Map(stored.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
    const builtins = BUILTIN_TYPES.map((id) => typeOf(byId.get(id) || { id }, true));
    const custom = [...byId.values()].filter((x) => !BUILTIN_TYPES.includes(x.id)).map((x) => typeOf(x, false));
    return [...builtins, ...custom].slice(0, MAX_TYPES);
  }
  const mode = legacy.clip?.mode;
  const auto = (id) => (mode === 'auto' ? true : mode === 'off' ? false : DEFAULT_AUTO_CLIP[id] ?? false);
  const builtins = BUILTIN_TYPES.map((id) => typeOf({
    id, autoClip: auto(id), clipPath: id === 'article' ? legacy.clip?.articlePath : '',
  }, true));
  const custom = (legacy.templates || [])
    .filter((x) => x && typeof x.id === 'string' && !BUILTIN_TYPES.includes(x.id))
    .map((x) => typeOf({ id: x.id, name: x.name, autoClip: auto(x.id) }, false));
  return [...builtins, ...custom].slice(0, MAX_TYPES);
}

function typeOf(x, builtin) {
  return {
    id: x.id,
    builtin,
    name: builtin ? '' : cleanName(x.name) || 'Untitled',
    autoClip: typeof x.autoClip === 'boolean' ? x.autoClip : DEFAULT_AUTO_CLIP[x.id] ?? false,
    clipPath: cleanPath(x.clipPath),
  };
}

// What is stored back: only what can't be derived. A `reviewClip` an earlier version
// stored is dropped: one switch covers notes and page comments now.
export const storedTypes = (types) => types.map(({ id, builtin, name, autoClip, clipPath }) => (
  builtin ? { id, autoClip, clipPath } : { id, name, autoClip, clipPath }
));

// The type a config belongs to. The general article config always goes with web
// articles; others go where they were put, else where an earlier version's template
// link put them, else with papers.
export function profileTypeOf(profile, assigned = {}, types = [], legacyLinks = {}) {
  if (profile?.fallback) return 'article';
  const known = (id) => types.some((x) => x.id === id);
  const id = assigned[profile?.name];
  if (known(id)) return id;
  const linked = legacyLinks[profile?.name]?.template;
  if (known(linked)) return linked;
  return 'paper';
}

// A page's type: its config's, when one that isn't the general one matched;
// otherwise papers (and conversations, whose notes are usually about papers) and
// web articles. `matched` says a config chose it, so the page deserves a note
// without asking.
export function pageTypeOf({ profile, isPaper, discussion }, assigned, types, legacyLinks) {
  if (!discussion && profile && !profile.fallback) {
    return { id: profileTypeOf(profile, assigned, types, legacyLinks), matched: true };
  }
  return { id: isPaper || discussion ? 'paper' : 'article', matched: false };
}
