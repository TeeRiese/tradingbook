// Storage layer: reads/writes the trading journal JSON file.
// Uses the File System Access API when available (Chrome/Edge), with a
// download+upload fallback for browsers that don't support it (Safari/Firefox).

const Storage = (() => {
  const STATE_KEY = 'tradingbook_autosave';
  let fileHandle = null;
  let supportsFSA = 'showOpenFilePicker' in window;

  function emptyBook() {
    return {
      version: 1,
      name: I18n.t('storage.newBookName'),
      settings: {
        startingCapital: 10000,
        currency: 'EUR',
      },
      tags: [],
      trades: [],
    };
  }

  // Turns a book name into a safe filename stem, e.g. "Live-Konto 2026" -> "live-konto-2026".
  function slugifyFilename(name) {
    const slug = (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'trading-book';
  }

  async function openFile() {
    if (supportsFSA) {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'Trading Book JSON',
          accept: { 'application/json': ['.json'] },
        }],
        multiple: false,
      });
      fileHandle = handle;
      const fileName = handle.name.replace(/\.json$/i, '');
      storeHandleForNextSession(handle, fileName); // fire-and-forget
      const file = await handle.getFile();
      const text = await file.text();
      return { data: JSON.parse(text), fileName };
    }
    return openFileFallback();
  }

  function openFileFallback() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return reject(new Error('Keine Datei ausgewählt'));
        const reader = new FileReader();
        reader.onload = () => {
          try {
            resolve({ data: JSON.parse(reader.result), fileName: file.name.replace(/\.json$/i, '') });
          } catch (e) {
            reject(e);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  async function saveFile(data, forcePicker = false) {
    const text = JSON.stringify(data, null, 2);
    if (supportsFSA) {
      if (!fileHandle || forcePicker) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: `${slugifyFilename(data.name)}.json`,
          types: [{
            description: 'Trading Book JSON',
            accept: { 'application/json': ['.json'] },
          }],
        });
        storeHandleForNextSession(fileHandle, fileHandle.name.replace(/\.json$/i, '')); // fire-and-forget
      }
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    }
    return saveFileFallback(text, data.name);
  }

  function saveFileFallback(text, name) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugifyFilename(name)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  function hasActiveHandle() {
    return !!fileHandle;
  }

  function clearHandle() {
    fileHandle = null;
  }

  // Local autosave cache so a page refresh doesn't lose unsaved work.
  // Returns false when it couldn't write (e.g. localStorage quota exceeded on
  // very large books) so the UI can tell the user autosave is unavailable.
  function cacheLocally(data) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Cheap existence check — no JSON.parse. Used to decide whether to show
  // "Letzte Sitzung fortsetzen" immediately on load, without waiting for a
  // potentially large cached book to parse first (that parse happens lazily,
  // only once the button is actually clicked — see readLocalCache()).
  function hasLocalCache() {
    try {
      return localStorage.getItem(STATE_KEY) != null;
    } catch (e) {
      return false;
    }
  }

  function readLocalCache() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // --- File handle persistence across reloads ---------------------------
  // A FileSystemFileHandle is a live JS object and can't be put in
  // localStorage (only strings). It CAN be stored in IndexedDB though
  // (handles are structured-cloneable) — that's what lets "Letzte Sitzung
  // fortsetzen" reconnect to the same on-disk file after a reload instead of
  // forcing the user to re-pick it. Permission still has to be re-confirmed
  // per session (browser security, not something we can skip), but that's a
  // single click on a small browser prompt, not re-browsing to the file.
  const HANDLE_DB = 'tradingbook-handles';
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'current';

  function openHandleDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function storeHandleForNextSession(handle, fileName) {
    try {
      const db = await openHandleDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put({ handle, fileName }, HANDLE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* IndexedDB unavailable — no worse off than before this feature existed */ }
  }

  async function getStoredHandleRecord() {
    try {
      const db = await openHandleDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readonly');
        const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }

  // Must be called from a click handler — requestPermission() needs a user
  // gesture. Re-attaches the stored handle as the active save target on
  // success so the next "Speichern" writes straight back to the file, with
  // no picker. Returns the filename on success, null otherwise (denied,
  // nothing stored, or the API isn't available).
  async function reconnectStoredHandle() {
    if (!supportsFSA) return null;
    const record = await getStoredHandleRecord();
    if (!record || !record.handle) return null;
    try {
      let perm = await record.handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await record.handle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') return null;
      fileHandle = record.handle;
      return record.fileName || null;
    } catch (e) {
      return null;
    }
  }

  return {
    supportsFSA,
    emptyBook,
    openFile,
    saveFile,
    hasActiveHandle,
    clearHandle,
    hasLocalCache,
    cacheLocally,
    readLocalCache,
    reconnectStoredHandle,
  };
})();
