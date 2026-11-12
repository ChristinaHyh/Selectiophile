// Folder handles can only be persisted in IndexedDB, not chrome.storage.

const open = () => new Promise((resolve, reject) => {
  // Named before the rename to Selectiophile; a new name would lose the granted folders.
  const req = indexedDB.open('lectiophile', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function write(change) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    change(tx.objectStore('kv'));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export const saveFolder = (handle, key = 'folder') => write((store) => store.put(handle, key));

export const clearFolder = (key) => write((store) => store.delete(key));

export async function loadFolder(key = 'folder') {
  const db = await open();
  const handle = await new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}
