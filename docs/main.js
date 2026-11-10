/* Library, import, and the service worker. Books never leave this browser. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  let currentId = null;
  let currentAbort = null;
  let shellReady = false;
  const urls = new Map();
  let coverUrls = [];

  function toast(msg, action, fn, ms) {
    if (window.FlipbookToast) window.FlipbookToast(msg, action, fn, ms);
  }

  function fmt(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function isPdf(file) {
    return !!(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
  }

  function setPill(cls, text) {
    document.querySelectorAll('.offline-pill').forEach((pill) => {
      pill.className = 'offline-pill ' + (cls || '');
      const label = pill.querySelector('.txt');
      if (label) label.textContent = text;
    });
  }

  async function rememberPersist() {
    if (!navigator.storage || !navigator.storage.persist) {
      window.__storagePersistResult = 'unsupported';
      return false;
    }
    try {
      const ok = await navigator.storage.persist();
      window.__storagePersistResult = ok ? 'persisted' : 'requested';
      return ok;
    } catch (e) {
      window.__storagePersistResult = 'error';
      return false;
    }
  }

  async function storageSummary() {
    let usage = 0;
    let quota = 0;
    let persisted = false;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        usage = est.usage || 0;
        quota = est.quota || 0;
      } catch (e) {}
    }
    if (navigator.storage && navigator.storage.persisted) {
      try { persisted = await navigator.storage.persisted(); } catch (e) {}
    }
    let bookBytes = 0;
    try {
      const books = await BookDB.listBooks();
      bookBytes = books.reduce((sum, book) => sum + (book.bytes || 0), 0);
    } catch (e) {}
    const offline = shellReady
      ? 'The app is saved on this device and opens offline.'
      : 'After this page loads once online, it opens offline.';
    const keep = persisted
      ? 'This browser has agreed to keep saved books.'
      : 'If storage gets tight, the browser may clear saved books.';
    return {
      short: `Books ${fmt(bookBytes)} · site ${fmt(usage)}${quota ? ' of ' + fmt(quota) : ''}`,
      offlineLine: offline,
      detail: `${offline} Books stored here use about ${fmt(bookBytes)}. ${keep}`
    };
  }

  async function refreshStorageLabels() {
    const summary = await storageSummary();
    const lib = $('#libStorage');
    if (lib) lib.textContent = summary.short;
    const status = document.querySelector('#menuSheet .offline-status');
    const info = $('#storageInfo');
    if (status) status.textContent = summary.offlineLine;
    if (info) info.textContent = summary.detail;
  }

  function revokeUrls() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.clear();
  }

  async function objectUrl(bookId, index, kind) {
    const key = bookId + ':' + kind + ':' + index;
    if (urls.has(key)) return urls.get(key);
    const record = await BookDB.getPage(bookId, index);
    const blob = record && record[kind];
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    return url;
  }

  function makeSession(book, texts, explicitPage) {
    const id = book.id;
    const width = book.pageWidth || 612;
    const height = book.pageHeight || 792;
    const sparse = window.PdfImport && PdfImport.textIsSparse(texts);
    return {
      title: book.title,
      texts,
      ratio: height / width,
      pageWidth: width,
      pageHeight: height,
      state: {
        page: book.lastPage || 0,
        layout: book.layout || 'auto',
        zoom: book.zoom || 1,
        sidebar: !!book.sidebar
      },
      bookId: id,
      outline: Array.isArray(book.outline) ? book.outline : [],
      chapters: book.chapters || [],
      bookmarks: book.bookmarks || [],
      recent: book.recent || [],
      explicitPage: explicitPage == null ? null : explicitPage,
      hasPdf: !!book.hasPdf,
      showOcr: book.ocr !== 'done' && !!sparse,
      getPageUrl: (index) => objectUrl(id, index, 'image'),
      getThumbUrl: (index) => objectUrl(id, index, 'thumb'),
      onState: (patch) => BookDB.patchBook(id, patch),
      onBookmarks: (list) => BookDB.patchBook(id, { bookmarks: list }),
      onRecent: (list) => BookDB.patchBook(id, { recent: list }),
      onLibrary: () => showLibrary(),
      onDownload: () => downloadPdf(id, book.title),
      onOcr: () => runOcr(id)
    };
  }

  async function openBook(id, explicitPage) {
    const book = await BookDB.getBook(id);
    if (!book) {
      toast('That book is not saved in this browser.');
      await showLibrary();
      return;
    }
    try {
      const stored = await BookDB.getOutline(id);
      if (stored) book.outline = stored;
      else if (book.hasPdf && window.PdfImport && PdfImport.outlineFromBlob) {
        const blob = await BookDB.getPdf(id);
        const outline = blob ? await PdfImport.outlineFromBlob(blob) : [];
        await BookDB.putOutline(id, outline);
        book.outline = outline;
      } else {
        book.outline = [];
        await BookDB.putOutline(id, []);
      }
      book.chapters = await BookDB.listChapters(id);
    } catch (e) {
      book.outline = book.outline || [];
      book.chapters = book.chapters || [];
    }
    const texts = await BookDB.getTexts(id);
    Reader.close();
    revokeUrls();
    currentId = id;
    document.body.classList.add('reading');
    try {
      await Reader.open(makeSession(book, texts, explicitPage == null ? null : explicitPage));
    } catch (err) {
      console.error(err);
      toast('Could not open that book.');
      await showLibrary();
      return;
    }
    history.replaceState(null, '', '#b=' + encodeURIComponent(id));
    await BookDB.patchBook(id, { lastOpened: Date.now() });
  }

  function hideToast() {
    const toastBox = document.getElementById('toast');
    if (toastBox) toastBox.classList.add('hidden');
  }

  async function showLibrary() {
    if (window.Reader) Reader.close();
    hideToast();
    revokeUrls();
    currentId = null;
    document.body.classList.remove('reading');
    document.title = 'Flipbook';
    history.replaceState(null, '', location.pathname + location.search);
    await refreshLibrary();
  }

  function subtitle(book) {
    const pages = `${book.pageCount} page${book.pageCount === 1 ? '' : 's'}`;
    return book.lastPage > 0 ? `${pages} · last page ${book.lastPage + 1}` : pages;
  }

  function startRename(card, book) {
    const heading = card.querySelector('h3');
    if (!heading) return;
    const input = document.createElement('input');
    input.className = 'nameedit';
    input.value = book.title || '';
    input.maxLength = 140;
    input.setAttribute('aria-label', 'Book title');
    heading.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      if (save) {
        const title = input.value.trim() || book.title || 'Untitled book';
        await BookDB.patchBook(book.id, { title });
      }
      await refreshLibrary();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function refreshLibrary() {
    const list = $('#bookList');
    const empty = $('#emptyLib');
    if (!list) return;
    coverUrls.forEach((url) => URL.revokeObjectURL(url));
    coverUrls = [];
    list.replaceChildren();
    let books = [];
    try { books = await BookDB.listBooks(); } catch (e) {}
    if (empty) empty.hidden = books.length > 0;
    for (const book of books) {
      const card = document.createElement('article');
      card.className = 'bookcard';
      card.dataset.id = book.id;
      const img = document.createElement('img');
      img.className = 'cover';
      img.alt = '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const heading = document.createElement('h3');
      heading.textContent = book.title || 'Untitled book';
      const sub = document.createElement('p');
      sub.className = 'sub';
      sub.textContent = subtitle(book);
      meta.append(heading, sub);
      const acts = document.createElement('div');
      acts.className = 'cardacts';
      const openBtn = mkButton('Open');
      const renameBtn = mkButton('Rename');
      renameBtn.setAttribute('aria-label', `Rename ${book.title || 'book'}`);
      const deleteBtn = mkButton('Delete');
      deleteBtn.setAttribute('aria-label', `Delete ${book.title || 'book'}`);
      acts.append(openBtn, renameBtn, deleteBtn);
      card.append(img, meta, acts);
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); openBook(book.id); });
      renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(card, book); });
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = book.title || 'this book';
        if (!confirm(`Delete "${name}" from this browser? The file on your device is not touched.`)) return;
        await BookDB.deleteBook(book.id);
        if (currentId === book.id) await showLibrary();
        else await refreshLibrary();
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, input')) return;
        openBook(book.id);
      });
      // Title goes up before the cover read. A cleanup lock on covers must not
      // leave the shelf looking empty.
      list.appendChild(card);
      try {
        const cover = await BookDB.getCover(book.id);
        if (cover) {
          const url = URL.createObjectURL(cover);
          coverUrls.push(url);
          img.src = url;
        }
      } catch (e) {}
    }
    await refreshStorageLabels();
  }

  function mkButton(text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    return button;
  }

  function showProgress(progress) {
    const titles = { read: 'Opening PDF', render: 'Rendering pages', save: 'Saving on this device', ocr: 'Recognizing text' };
    $('#impTitle').textContent = titles[progress.phase] || 'Working';
    $('#impStatus').textContent = progress.detail || '';
    let fraction = 0.08;
    if (progress.total) fraction = Math.max(0.08, progress.current / progress.total);
    else if (typeof progress.fraction === 'number') fraction = Math.max(0.08, progress.fraction);
    $('#impBar').style.width = Math.round(Math.min(1, fraction) * 100) + '%';
    $('#impDetail').textContent = progress.phase === 'ocr'
      ? 'English recognition stays on this device.'
      : 'Nothing is uploaded.';
  }

  function askOcr() {
    return new Promise((resolve) => {
      const box = $('#ocrOffer');
      box.classList.remove('hidden');
      const finish = (value) => {
        box.classList.add('hidden');
        $('#ocrRun').onclick = null;
        $('#ocrSkip').onclick = null;
        resolve(value);
      };
      $('#ocrRun').onclick = () => finish(true);
      $('#ocrSkip').onclick = () => finish(false);
    });
  }

  async function importOne(file) {
    const ac = new AbortController();
    currentAbort = ac;
    $('#importer').classList.remove('hidden');
    showProgress({ phase: 'read', current: 0, total: 1, detail: file.name || 'PDF' });
    let result = null;
    if (window.BookDB && BookDB.setImporting) BookDB.setImporting(true);
    try {
      result = await PdfImport.importFile(file, { signal: ac.signal, onProgress: showProgress, split: splitWideOn() });
    } catch (err) {
      console.error(err);
      toast((err && err.message) || 'Could not open that PDF');
      if (!document.body.classList.contains('reading')) await refreshLibrary();
      return;
    } finally {
      if (window.BookDB && BookDB.setImporting) BookDB.setImporting(false);
      $('#importer').classList.add('hidden');
      currentAbort = null;
    }
    if (!result) {
      toast('Import cancelled');
      return;
    }
    if (result.needsOcr) {
      const run = await askOcr();
      if (run) {
        const ocrAbort = new AbortController();
        currentAbort = ocrAbort;
        $('#importer').classList.remove('hidden');
        try {
          await PdfImport.ocrBook(result.id, { signal: ocrAbort.signal, onProgress: showProgress });
        } catch (err) {
          console.error(err);
          if (!(ocrAbort.signal.aborted || (err && err.name === 'AbortError'))) {
            toast((err && err.message) || 'Text recognition failed. The book is still saved.');
          } else toast('Text recognition cancelled. The book is still saved.');
        } finally {
          $('#importer').classList.add('hidden');
          currentAbort = null;
        }
      } else {
        await BookDB.patchBook(result.id, { ocr: 'skipped' });
      }
    }
    await rememberPersist();
    await openBook(result.id);
    if (result.splitSheets) {
      const count = result.splitSheets;
      toast(count === 1 ? 'Split 1 wide sheet into two pages.' : `Split ${count} wide sheets into two pages each.`);
    }
  }

  async function importFiles(fileList) {
    const files = [...fileList].filter(isPdf);
    if (!files.length) {
      toast('Choose a PDF file.');
      return;
    }
    for (const file of files) await importOne(file);
    if (!document.body.classList.contains('reading')) await refreshLibrary();
  }

  async function runOcr(id) {
    const ac = new AbortController();
    currentAbort = ac;
    $('#importer').classList.remove('hidden');
    try {
      const texts = await PdfImport.ocrBook(id, { signal: ac.signal, onProgress: showProgress });
      if (currentId === id && texts) {
        Reader.setTexts(texts);
        Reader.setFlags({ showOcr: false });
      }
      toast('Text recognition finished. Search is ready.');
    } catch (err) {
      console.error(err);
      if (ac.signal.aborted || (err && err.name === 'AbortError')) toast('Text recognition cancelled');
      else toast((err && err.message) || 'Text recognition failed');
    } finally {
      $('#importer').classList.add('hidden');
      currentAbort = null;
    }
  }

  async function downloadPdf(id, title) {
    const blob = await BookDB.getPdf(id);
    if (!blob) {
      toast('The original PDF was not kept on this device.');
      return;
    }
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const safe = (title || 'book').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'book';
    link.href = url;
    link.download = /\.pdf$/i.test(safe) ? safe : safe + '.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function registerSW() {
    const secure = window.isSecureContext && location.protocol !== 'file:';
    if (!secure || !('serviceWorker' in navigator)) {
      setPill('warn', 'Online only');
      return;
    }
    setPill('busy', 'Saving…');
    let hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !refreshing && !currentAbort) {
        refreshing = true;
        location.reload();
        return;
      }
      hadController = true;
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {});
      return navigator.serviceWorker.ready;
    }).then(() => {
      shellReady = true;
      setPill('ok', 'Available offline');
      refreshStorageLabels();
    }).catch((err) => {
      console.error(err);
      shellReady = false;
      setPill('warn', 'Online only');
    });
  }

  function carriesFiles(event) {
    return !!(event.dataTransfer && event.dataTransfer.types && [...event.dataTransfer.types].includes('Files'));
  }

  function splitWideOn() {
    const box = $('#splitWide');
    return !box || box.checked;
  }

  function wireShell() {
    const splitBox = $('#splitWide');
    if (splitBox) {
      try { if (localStorage.getItem('flipbook.splitWide') === '0') splitBox.checked = false; } catch (e) {}
      splitBox.addEventListener('change', () => {
        try { localStorage.setItem('flipbook.splitWide', splitBox.checked ? '1' : '0'); } catch (e) {}
      });
    }
    $('#pickFile').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', () => {
      const files = [...$('#fileInput').files];
      $('#fileInput').value = '';
      if (files.length) importFiles(files);
    });
    const zone = $('#dropzone');
    window.addEventListener('dragenter', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      zone.classList.add('over');
    });
    window.addEventListener('dragover', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      zone.classList.add('over');
    });
    window.addEventListener('dragleave', (event) => {
      if (event.target === zone || event.target === document.documentElement) zone.classList.remove('over');
    });
    window.addEventListener('drop', (event) => {
      zone.classList.remove('over');
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      event.preventDefault();
      importFiles(files);
    });
    $('#impCancel').addEventListener('click', () => { if (currentAbort) currentAbort.abort(); });
    document.addEventListener('flipbook-menu', () => { refreshStorageLabels(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && currentAbort && !$('#importer').classList.contains('hidden')) {
        currentAbort.abort();
        return;
      }
      if (document.body.classList.contains('reading')) return;
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((event.key === 'n' || event.key === 'N') && window.Fairy && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (!Fairy.supported) toast('A custom cursor needs a mouse or trackpad');
        else {
          Fairy.cycle();
          toast(Fairy.cursor === 'off' ? 'Normal cursor (N to change)' : Fairy.label + ' cursor (N to change)');
        }
      }
    });
  }

  async function boot() {
    wireShell();
    registerSW();
    rememberPersist();
    try {
      await BookDB.open();
    } catch (err) {
      console.error(err);
      toast('This browser blocked local storage, so books can’t be saved here.');
      return;
    }
    // A stuck cleanup used to run before the shelf loaded, so saved books looked
    // deleted and the next import waited forever on "Rendering pages".
    // Draw the saved book first, then drop orphan pages.
    const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const id = params.get('b');
    let explicit = null;
    if (params.has('p')) {
      const page = parseInt(params.get('p'), 10);
      if (!Number.isNaN(page)) explicit = page - 1;
    }
    if (id) {
      const book = await BookDB.getBook(id);
      if (book) {
        await openBook(id, explicit);
        BookDB.vacuum().catch((err) => console.error(err));
        return;
      }
    }
    await refreshLibrary();
    BookDB.vacuum().catch((err) => console.error(err));
  }

  window.FlipbookApp = { openBook, showLibrary, importFiles, refreshLibrary };
  boot();
})();
