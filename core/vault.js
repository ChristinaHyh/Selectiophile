// File access to the chosen folder, written against the File System Access API so
// tests can pass an in-memory folder.

import { readFrontmatter } from './note.js';

export const TEMPLATE_NAME = 'Reading Template.md';
export const ARTICLE_TEMPLATE_NAME = 'Article Template.md';

// The spike saw these 5-10% of the time on a file touched moments earlier, so
// another process holding it briefly is a likely cause. They clear up on retry.
const TRANSIENT = new Set(['InvalidStateError', 'NoModificationAllowedError', 'NotReadableError']);
const RETRY_DELAYS = [100, 200, 400, 800, 1600];

export async function withRetry(fn, delays = RETRY_DELAYS) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!TRANSIENT.has(e.name) || attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

// Notes are named by their path inside the folder, like `sub/note.md`.
async function locate(dir, path, { createFolders = false } = {}) {
  const parts = path.split('/');
  const file = parts.pop();
  let parent = dir;
  for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: createFolders });
  return { parent, file };
}

// A subfolder path from what was typed. It can't leave the chosen folder or reach a
// hidden one, so `..` and dot folders are dropped.
export function cleanFolderPath(text) {
  return String(text ?? '').split(/[\\/]+/)
    .map((part) => part.replace(/[:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part && !part.startsWith('.'))
    .join('/');
}

// Subfolders that could hold notes, for suggesting where a template's notes go. A
// subfolder that can't be read (a link, a cloud placeholder, a system folder on
// Windows) is listed without what is inside it, and named in `skipped`; only the
// chosen folder itself failing is an error.
export async function listFolders(dir, skipped = []) {
  const found = [];
  const walk = async (folder, prefix) => {
    const children = [];
    try {
      for await (const [name, handle] of folder.entries()) {
        if (handle.kind === 'directory' && !name.startsWith('.')) children.push([name, handle]);
      }
    } catch (e) {
      if (!prefix) throw e;
      skipped.push({ folder: prefix.slice(0, -1), error: `${e.name}: ${e.message}` });
    }
    for (const [name, handle] of children) {
      found.push(prefix + name);
      await walk(handle, `${prefix}${name}/`);
    }
  };
  await walk(dir, '');
  return found.sort();
}

export const readFile = (dir, name) =>
  withRetry(async () => {
    const { parent, file: fileName } = await locate(dir, name);
    const file = await (await parent.getFileHandle(fileName)).getFile();
    return { text: await file.text(), mtime: file.lastModified };
  });

async function writeFile(dir, name, text, options) {
  await withRetry(async () => {
    const { parent, file } = await locate(dir, name, options);
    const writable = await (await parent.getFileHandle(file, { create: true })).createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => {});
      throw e;
    }
  });
}

export async function fileExists(dir, name) {
  try {
    await withRetry(async () => {
      const { parent, file } = await locate(dir, name);
      await parent.getFileHandle(file);
    });
    return true;
  } catch (e) {
    if (e.name === 'NotFoundError') return false;
    throw e;
  }
}

export async function deleteFile(dir, name) {
  await withRetry(async () => {
    try {
      const { parent, file } = await locate(dir, name);
      await parent.removeEntry(file);
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e;
    }
  });
}

// Writes `change(text)` back, recomputing if the file moved underneath us, then
// reads it back so a save is only reported once it is really on disk.
export async function updateFile(dir, name, change) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readFile(dir, name);
    const next = change(before.text);
    const check = await readFile(dir, name);
    if (check.mtime !== before.mtime) continue;
    if (next !== before.text) await writeFile(dir, name, next);
    await verify(dir, name, next);
    return next;
  }
  throw Object.assign(new Error(`${name} 正在被频繁修改，请稍后重试`), { name: 'BusyError' });
}

export async function createFile(dir, name, text) {
  await writeFile(dir, name, text, { createFolders: true });
  await verify(dir, name, text);
}

async function verify(dir, name, expected) {
  const { text } = await readFile(dir, name);
  if (text !== expected) throw Object.assign(new Error(`写入 ${name} 后读回内容不一致`), { name: 'VerifyError' });
}

const isNote = (name, excluded) => name.endsWith('.md') && !name.startsWith('_') && !name.startsWith('.')
  && name !== TEMPLATE_NAME && name !== ARTICLE_TEMPLATE_NAME && name.toLowerCase() !== excluded;

const frontmatterText = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';

const noteFromText = (name, mtime, text) => {
  const fm = readFrontmatter(text);
  const annotated = Date.parse(fm.last_annotated || '');
  return {
    name,
    mtime,
    title: fm.title || name.split('/').pop().replace(/\.md$/, ''),
    doi: fm.doi || '',
    url: fm.url || fm.source || '',
    authors: fm.authors || '',
    lastAnnotated: Number.isNaN(annotated) ? mtime : annotated,
  };
};

// Walks subfolders, skipping hidden ones such as `.obsidian` and `.trash`, and those in
// `skipFolders`, where clipped originals live, and any other file with `clipped` in its
// properties. Reads only files whose modification time changed since the cached scan.
export async function scanNotes(dir, cached = {}, { dashboardName, skipFolders = [] } = {}) {
  const excluded = dashboardName?.toLowerCase();
  const skipped = new Set(skipFolders.map((f) => f.toLowerCase()));
  const notes = {};
  const walk = async (folder, prefix) => {
    for await (const [name, handle] of folder.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') {
        if (!skipped.has(`${prefix}${name}`.toLowerCase())) await walk(handle, `${prefix}${name}/`);
      } else if (isNote(name, excluded)) {
        const path = prefix + name;
        const file = await withRetry(() => handle.getFile());
        const prior = cached[path];
        if (prior?.mtime === file.lastModified) {
          notes[path] = prior;
          continue;
        }
        const text = await withRetry(() => file.text());
        // A clipped original kept among notes is still no note.
        if (!/^clipped:/m.test(frontmatterText(text))) notes[path] = noteFromText(path, file.lastModified, text);
      }
    }
  };
  await walk(dir, '');
  return notes;
}

export const DEFAULT_DASHBOARD_NAME = '_dashboard';

// A safe file name from what the user typed, falling back to the default.
export function dashboardFileName(name) {
  const clean = String(name ?? '').replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return `${clean || DEFAULT_DASHBOARD_NAME}.md`;
}

// The name is matched without regard to case, so an existing `_Dashboard.md` is found
// on any file system instead of gaining a twin.
async function findByName(dir, fileName) {
  const wanted = fileName.toLowerCase();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.toLowerCase() === wanted) return name;
  }
  return null;
}

// Creates a missing dashboard, and replaces one still holding a text the extension
// wrote (`generated`), so it follows the layout and language. One the person edited
// stays theirs.
// `generated` null replaces whatever is there. Says `created`, `updated`, `same` or
// `kept` (edited by the person, so left alone).
// `folder`, inside the chosen folder, is created when missing.
export async function syncDashboard(dir, wanted, fileName = dashboardFileName(), generated = [], folder = '') {
  for (const part of cleanFolderPath(folder).split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
  const existing = await findByName(dir, fileName);
  if (!existing) {
    await createFile(dir, fileName, wanted);
    return 'created';
  }
  const { text } = await readFile(dir, existing);
  if (text === wanted) return 'same';
  if (generated && !generated.includes(text)) return 'kept';
  await createFile(dir, existing, wanted);
  return 'updated';
}

// Where `path` inside `root` sits relative to `dir`, if inside it at all: clipped
// originals may go to the vault root while notes live in a subfolder, or both may be
// one folder. Nothing is created.
export async function relativeFolder(dir, root, path) {
  let handle = root;
  try {
    for (const part of path.split('/').filter(Boolean)) handle = await handle.getDirectoryHandle(part);
  } catch (e) {
    if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
    throw e;
  }
  if (typeof dir.resolve === 'function') {
    const parts = await dir.resolve(handle);
    return parts?.length ? parts.join('/') : null;
  }
  return dir === root ? path : null;
}
