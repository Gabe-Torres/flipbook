/* Books live in IndexedDB on this device. Nothing here is uploaded. */
(() => {
  'use strict';
  const DB_NAME = 'flipbook';
  const DB_VERSION = 1;
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
      tx.onerror = () => reject(tx.error || new Error('Storage write failed'));
      tx.onabort = () => reject(tx.error || new Error('Storage write was aborted'));
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

  async function putBook(book) {
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
    const db = await open();
    await txDone(db, ['pages'], 'readwrite', (stores) => { stores.pages.put(record); });
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

  async function deleteBook(id) {
    const db = await open();
    await txDone(db, ['books', 'pages', 'texts', 'pdfs'], 'readwrite', (stores) => {
      stores.books.delete(id);
      stores.pdfs.delete(id);
      const wipe = (index) => {
        const cursor = index.openCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          row.delete();
          row.continue();
        };
      };
      wipe(stores.pages.index('byBook'));
      wipe(stores.texts.index('byBook'));
    });
    queues.delete(id);
  }

  async function vacuum() {
    const books = await listBooks();
    const ids = new Set(books.map((book) => book.id));
    const db = await open();
    await txDone(db, ['pages', 'texts', 'pdfs'], 'readwrite', (stores) => {
      ['pages', 'texts', 'pdfs'].forEach((name) => {
        const cursor = stores[name].openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const bookId = row.value && row.value.bookId ? row.value.bookId : row.key;
          if (!ids.has(bookId)) row.delete();
          row.continue();
        };
      });
    });
  }

  window.BookDB = {
    open, listBooks, getBook, putBook, patchBook, putPage, putText, getPage, getTexts, putPdf, getPdf, deleteBook, vacuum
  };
})();
