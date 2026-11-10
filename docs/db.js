/* Books live in IndexedDB on this device. Nothing here is uploaded. */
(() => {
  'use strict';
  const DB_NAME = 'flipbook';
  const DB_VERSION = 4;
  let dbp = null;
  const queues = new Map();

  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pages')) {
          const pages = db.createObjectStore('pages', { keyPath: ['bookId', 'index'] });
          pages.createIndex('byBook', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('texts')) {
          const texts = db.createObjectStore('texts', { keyPath: ['bookId', 'index'] });
          texts.createIndex('byBook', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outlines')) db.createObjectStore('outlines', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('chapters')) {
          const chapters = db.createObjectStore('chapters', { keyPath: 'id' });
          chapters.createIndex('byBook', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('annotations')) {
          const notes = db.createObjectStore('annotations', { keyPath: 'id' });
          notes.createIndex('byBook', 'bookId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbp = null;
        reject(request.error);
      };
    });
    return dbp;
  }

  function txDone(db, names, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const stores = {};
      names.forEach((name) => { stores[name] = tx.objectStore(name); });
      try { fn(stores, tx); }
      catch (err) { reject(err); try { tx.abort(); } catch (e) {} return; }
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        const err = tx.error || (event && event.target && event.target.error);
        reject(err || new Error('Storage write failed'));
      };
      tx.onabort = (event) => {
        const err = tx.error || (event && event.target && event.target.error);
        reject(err || new Error('Storage write was aborted'));
      };
    });
  }

  async function listBooks() {
    const db = await open();
    const books = await req(db.transaction('books').objectStore('books').getAll());
    books.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    return books;
  }

  async function getBook(id) {
    const db = await open();
    return req(db.transaction('books').objectStore('books').get(id));
  }

  async function copyBlob(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function' || !blob.size) return null;
    try {
      const bytes = await blob.arrayBuffer();
      if (!bytes || !bytes.byteLength) return null;
      return new Blob([bytes], { type: blob.type || 'image/jpeg' });
    } catch (e) {
      return null;
    }
  }

  async function putCover(bookId, blob) {
    const copy = await copyBlob(blob);
    if (!copy) return null;
    const db = await open();
    await txDone(db, ['covers'], 'readwrite', (stores) => { stores.covers.put({ bookId, blob: copy }); });
    return copy;
  }

  async function getCover(bookId) {
    const db = await open();
    const row = await req(db.transaction('covers').objectStore('covers').get(bookId));
    if (row && row.blob && row.blob.size) return copyBlob(row.blob);
    const book = await getBook(bookId);
    if (book && book.cover && book.cover.size) {
      const copy = await putCover(bookId, book.cover);
      if (copy) return copy;
    }
    const page = await getPage(bookId, 0);
    if (page && page.thumb && page.thumb.size) return putCover(bookId, page.thumb);
    return null;
  }

  async function putBook(book) {
    if (book && book.cover) {
      await putCover(book.id, book.cover);
      delete book.cover;
    }
    const db = await open();
    await txDone(db, ['books'], 'readwrite', (stores) => { stores.books.put(book); });
    return book;
  }

  function patchBook(id, patch) {
    const prev = queues.get(id) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const book = await getBook(id);
      if (!book) return null;
      Object.assign(book, patch, { updated: Date.now() });
      await putBook(book);
      return book;
    });
    queues.set(id, next.catch(() => {}));
    return next;
  }

  async function putPage(record) {
    const image = await copyBlob(record.image);
    const thumb = await copyBlob(record.thumb);
    if (!image || !thumb) throw new Error('Could not store a page image');
    const db = await open();
    await txDone(db, ['pages'], 'readwrite', (stores) => {
      stores.pages.put({ bookId: record.bookId, index: record.index, image, thumb });
    });
  }

  async function putText(bookId, index, text) {
    const db = await open();
    await txDone(db, ['texts'], 'readwrite', (stores) => {
      stores.texts.put({ bookId, index, text: text || '' });
    });
  }

  async function getPage(bookId, index) {
    const db = await open();
    return req(db.transaction('pages').objectStore('pages').get([bookId, index]));
  }

  async function getTexts(bookId) {
    const db = await open();
    const rows = await req(db.transaction('texts').objectStore('texts').index('byBook').getAll(bookId));
    const book = await getBook(bookId);
    const n = book ? book.pageCount : 0;
    const out = new Array(n).fill('');
    (rows || []).forEach((row) => {
      if (row.index >= 0 && row.index < out.length) out[row.index] = row.text || '';
    });
    return out;
  }

  async function putPdf(bookId, blob) {
    const db = await open();
    await txDone(db, ['pdfs'], 'readwrite', (stores) => { stores.pdfs.put({ bookId, blob }); });
  }

  async function getPdf(bookId) {
    const db = await open();
    const row = await req(db.transaction('pdfs').objectStore('pdfs').get(bookId));
    return row ? row.blob : null;
  }

  // Delete by primary key, then continue. cursor.delete() plus continue() in the
  // same turn never finishes on some browsers, which locks the database.
  // A key cursor avoids reading every page image while the store is locked.
  function wipeIndex(store, indexName, id) {
    const index = store.index(indexName);
    const request = typeof index.openKeyCursor === 'function'
      ? index.openKeyCursor(IDBKeyRange.only(id))
      : index.openCursor(IDBKeyRange.only(id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }

  function dropOrphans(store, ids, keyOnly) {
    const request = keyOnly && typeof store.openKeyCursor === 'function'
      ? store.openKeyCursor()
      : store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      let bookId = null;
      if (keyOnly) {
        const key = cursor.primaryKey;
        bookId = Array.isArray(key) ? key[0] : key;
      } else if (cursor.value && cursor.value.bookId) {
        bookId = cursor.value.bookId;
      }
      if (bookId && !ids.has(bookId)) store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }

  async function deleteBook(id) {
    const db = await open();
    await txDone(db, ['books', 'pages', 'texts', 'pdfs', 'covers', 'outlines', 'chapters', 'annotations'], 'readwrite', (stores) => {
      stores.books.delete(id);
      stores.pdfs.delete(id);
      stores.covers.delete(id);
      stores.outlines.delete(id);
      wipeIndex(stores.pages, 'byBook', id);
      wipeIndex(stores.texts, 'byBook', id);
      wipeIndex(stores.chapters, 'byBook', id);
      wipeIndex(stores.annotations, 'byBook', id);
    });
    queues.delete(id);
  }

  async function vacuum() {
    const books = await listBooks();
    const ids = new Set(books.map((book) => book.id));
    const db = await open();
    await txDone(db, ['pages', 'texts', 'pdfs', 'covers', 'outlines', 'chapters', 'annotations'], 'readwrite', (stores) => {
      ['pages', 'texts', 'pdfs', 'covers', 'outlines'].forEach((name) => {
        dropOrphans(stores[name], ids, true);
      });
      ['chapters', 'annotations'].forEach((name) => {
        dropOrphans(stores[name], ids, false);
      });
    });
  }

  async function getClickSound() {
    const db = await open();
    const row = await req(db.transaction('settings').objectStore('settings').get('click-sound'));
    if (!row || !row.bytes || !row.bytes.byteLength) return null;
    return { name: row.name || 'Custom sound', type: row.type || '', bytes: row.bytes };
  }

  async function putClickSound(info) {
    const bytes = info && info.bytes;
    if (!bytes || !bytes.byteLength) throw new Error('That sound file is empty.');
    if (bytes.byteLength > 1048576) throw new Error('That sound is over 1 MB.');
    const stored = bytes.slice(0);
    const db = await open();
    await txDone(db, ['settings'], 'readwrite', (stores) => {
      stores.settings.put({
        id: 'click-sound',
        name: String(info.name || 'Custom sound').slice(0, 120),
        type: String(info.type || ''),
        bytes: stored
      });
    });
  }

  async function clearClickSound() {
    const db = await open();
    await txDone(db, ['settings'], 'readwrite', (stores) => { stores.settings.delete('click-sound'); });
  }

  function newId(prefix) {
    const rand = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(16).slice(2));
    return prefix + rand;
  }

  function clamp01(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
  }

  async function getOutline(bookId) {
    const db = await open();
    const row = await req(db.transaction('outlines').objectStore('outlines').get(bookId));
    if (!row) return null;
    return Array.isArray(row.items) ? row.items : [];
  }

  async function putOutline(bookId, items) {
    const db = await open();
    await txDone(db, ['outlines'], 'readwrite', (stores) => {
      stores.outlines.put({ bookId, items: Array.isArray(items) ? items : [] });
    });
  }

  async function listByBook(storeName, bookId) {
    const db = await open();
    const rows = await req(db.transaction(storeName).objectStore(storeName).index('byBook').getAll(bookId));
    return rows || [];
  }

  async function listChapters(bookId) {
    const rows = await listByBook('chapters', bookId);
    rows.sort((a, b) => a.page - b.page || (a.created || 0) - (b.created || 0));
    return rows.map((row) => ({
      id: row.id, bookId: row.bookId, title: row.title, page: row.page, created: row.created || 0, updated: row.updated || 0
    }));
  }

  async function putChapter(info) {
    const title = String(info && info.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const page = info && info.page | 0;
    if (!info || !info.bookId) throw new Error('Missing book.');
    if (!title) throw new Error('Give the chapter a title.');
    if (page < 0) throw new Error('That page number is not in this book.');
    const now = Date.now();
    const record = {
      id: info.id || newId('c'),
      bookId: info.bookId,
      title,
      page,
      created: info.created || now,
      updated: now
    };
    const db = await open();
    await txDone(db, ['chapters'], 'readwrite', (stores) => { stores.chapters.put(record); });
    return record;
  }

  async function deleteChapter(id) {
    const db = await open();
    await txDone(db, ['chapters'], 'readwrite', (stores) => { stores.chapters.delete(id); });
  }

  async function listAnnotations(bookId) {
    const rows = await listByBook('annotations', bookId);
    rows.sort((a, b) => a.page - b.page || a.y - b.y || (a.created || 0) - (b.created || 0));
    return rows;
  }

  async function putAnnotation(info) {
    if (!info || !info.bookId) throw new Error('Missing book.');
    const kind = info.kind === 'note' ? 'note' : 'area';
    const page = info.page | 0;
    if (page < 0) throw new Error('That page is not in this book.');
    const now = Date.now();
    const record = {
      id: info.id || newId('a'),
      bookId: info.bookId,
      page,
      kind,
      x: clamp01(info.x),
      y: clamp01(info.y),
      w: kind === 'area' ? clamp01(info.w) : 0,
      h: kind === 'area' ? clamp01(info.h) : 0,
      text: String(info.text || '').slice(0, 2000),
      created: info.created || now,
      updated: now
    };
    if (kind === 'area' && (record.w < 0.01 || record.h < 0.01)) throw new Error('Drag a larger highlight.');
    const db = await open();
    await txDone(db, ['annotations'], 'readwrite', (stores) => { stores.annotations.put(record); });
    return record;
  }

  async function deleteAnnotation(id) {
    const db = await open();
    await txDone(db, ['annotations'], 'readwrite', (stores) => { stores.annotations.delete(id); });
  }

  window.BookDB = {
    open, listBooks, getBook, putBook, patchBook, putPage, putText, getPage, getTexts, getCover, putPdf, getPdf, deleteBook, vacuum,
    getClickSound, putClickSound, clearClickSound,
    getOutline, putOutline, listChapters, putChapter, deleteChapter, listAnnotations, putAnnotation, deleteAnnotation
  };
})();
