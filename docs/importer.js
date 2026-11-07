/* Turn a local PDF into page images and a text index. Runs entirely in the browser. */
(() => {
  'use strict';

  function asset(path) {
    return new URL(path, document.baseURI).toString();
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode a page image'))), type, quality);
    });
  }

  function abortError() {
    const err = new Error('Cancelled');
    err.name = 'AbortError';
    return err;
  }

  function itemsToText(items) {
    let line = '';
    const lines = [];
    items.forEach((item) => {
      line += item.str || '';
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    });
    if (line) lines.push(line);
    return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function textIsSparse(texts) {
    if (!texts.length) return false;
    const rich = texts.filter((text) => (text || '').replace(/\s+/g, '').length >= 25).length;
    return rich / texts.length < 0.35;
  }

  async function destPage(pdf, dest) {
    try {
      let explicit = dest;
      if (!explicit) return null;
      if (typeof explicit === 'string') explicit = await pdf.getDestination(explicit);
      if (typeof explicit === 'string') explicit = await pdf.getDestination(explicit);
      if (!Array.isArray(explicit) || explicit[0] == null) return null;
      const index = await pdf.getPageIndex(explicit[0]);
      if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return null;
      return index;
    } catch (e) {
      return null;
    }
  }

  async function outlineTree(pdf, nodes, depth) {
    if (!nodes || !nodes.length || depth > 12) return [];
    const out = [];
    for (const node of nodes) {
      const title = String(node && node.title || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      const page = await destPage(pdf, node && node.dest);
      const items = await outlineTree(pdf, node && node.items, depth + 1);
      if (!title && !items.length) continue;
      if (page == null && !items.length) continue;
      out.push({ title: title || 'Untitled', page, items });
    }
    return out;
  }

  async function readOutline(pdf) {
    try {
      const raw = await pdf.getOutline();
      return await outlineTree(pdf, raw, 0);
    } catch (e) {
      return [];
    }
  }

  async function outlineFromBlob(blob) {
    if (!blob) return [];
    configurePdf();
    const data = await blob.arrayBuffer();
    const task = pdfjsLib.getDocument({
      data,
      cMapUrl: asset('vendor/pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/')
    });
    const pdf = await task.promise;
    try { return await readOutline(pdf); }
    finally { try { await pdf.destroy(); } catch (e) {} }
  }

  // Portrait width and height, in PDF points. A sheet that merely matches one of
  // these, turned either way, is one page. Tabloid and A3 are left out on purpose:
  // those sizes are what a two-page spread usually is.
  const SINGLE_SHEETS = [
    [612, 792], [595.28, 841.89], [419.53, 595.28], [612, 1008],
    [522, 756], [396, 612], [432, 648], [360, 576], [288, 432]
  ];

  function near(value, target) {
    return Math.abs(value - target) <= Math.max(14, target * 0.035);
  }

  function matchesSingleSheet(width, height) {
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    return SINGLE_SHEETS.some(([sheetWidth, sheetHeight]) => near(short, sheetWidth) && near(long, sheetHeight));
  }

  // A wide rectangle whose two halves each look like a normal portrait page.
  function isSpread(width, height) {
    if (!(width > height) || width < 880) return false;
    if (matchesSingleSheet(width, height)) return false;
    const ratio = width / height;
    const half = (width / 2) / height;
    return ratio >= 1.28 && half >= 0.58 && half <= 0.86;
  }

  function splitItems(items, viewport) {
    const left = [];
    const right = [];
    const mid = viewport.width / 2;
    (items || []).forEach((item) => {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      let center = transform[4];
      try {
        const start = viewport.convertToViewportPoint(transform[4], transform[5]);
        const end = viewport.convertToViewportPoint(transform[4] + (item.width || 0), transform[5]);
        center = (start[0] + end[0]) / 2;
      } catch (e) {}
      (center >= mid ? right : left).push(item);
    });
    return [left, right];
  }

  function sliceCanvas(source, start, width) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, source.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, start, 0, width, source.height, 0, 0, width, source.height);
    return canvas;
  }

  function titleFrom(file, meta) {
    let title = meta && meta.info && meta.info.Title;
    if (title != null && typeof title !== 'string') title = String(title);
    if (typeof title === 'string') title = title.replace(/\s+/g, ' ').trim();
    if (title && title.length > 1 && !/^untitled$/i.test(title)) return title.slice(0, 140);
    const fromName = (file.name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
    return fromName || 'Untitled book';
  }

  function configurePdf() {
    if (!window.pdfjsLib) throw new Error('The PDF reader failed to load.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = asset('vendor/pdfjs/pdf.worker.min.js');
  }

  async function importFile(file, opts) {
    const onProgress = (opts && opts.onProgress) || (() => {});
    const signal = opts && opts.signal;
    const id = (crypto.randomUUID && crypto.randomUUID()) || ('b' + Date.now() + Math.random().toString(16).slice(2));
    const canvas = document.createElement('canvas');
    const thumb = document.createElement('canvas');
    let pdf = null;
    try {
      if (signal && signal.aborted) throw abortError();
      configurePdf();
      onProgress({ phase: 'read', current: 0, total: 1, detail: 'Reading the file…' });
      const data = await file.arrayBuffer();
      if (signal && signal.aborted) throw abortError();
      const task = pdfjsLib.getDocument({
        data,
        cMapUrl: asset('vendor/pdfjs/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/')
      });
      if (signal) signal.addEventListener('abort', () => { try { task.destroy(); } catch (e) {} }, { once: true });
      try {
        pdf = await task.promise;
      } catch (err) {
        if (signal && signal.aborted) throw abortError();
        const name = err && err.name;
        if (name === 'PasswordException') throw new Error('This PDF is password-protected, so it can’t be opened here.');
        if (name === 'InvalidPDFException') throw new Error('That file doesn’t look like a PDF this browser can read.');
        throw err;
      }
      const n = pdf.numPages;
      if (!n) throw new Error('This PDF has no pages.');
      let meta = null;
      try { meta = await pdf.getMetadata(); } catch (e) {}
      const title = titleFrom(file, meta);
      let outline = [];
      try { outline = await readOutline(pdf); } catch (e) { outline = []; }
      const splitWide = !opts || opts.split !== false;
      let pageWidth = 612;
      let pageHeight = 792;
      let sized = false;
      let cover = null;
      let bytes = file.size || 0;
      let leaf = 0;
      let splitSheets = 0;
      const texts = [];
      const pageMap = [];
      async function storeLeaf(source, text) {
        const image = await toBlob(source, 'image/jpeg', 0.86);
        const tw = 200;
        const th = Math.max(1, Math.round(source.height * (tw / source.width)));
        thumb.width = tw;
        thumb.height = th;
        const tctx = thumb.getContext('2d', { alpha: false });
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, tw, th);
        tctx.drawImage(source, 0, 0, tw, th);
        const thumbBlob = await toBlob(thumb, 'image/jpeg', 0.72);
        if (!cover) cover = thumbBlob;
        bytes += image.size + thumbBlob.size;
        texts.push(text || '');
        await BookDB.putPage({ bookId: id, index: leaf, image, thumb: thumbBlob });
        await BookDB.putText(id, leaf, text || '');
        leaf += 1;
      }
      for (let i = 1; i <= n; i++) {
        if (signal && signal.aborted) throw abortError();
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const spread = splitWide && isSpread(base.width, base.height);
        if (spread) splitSheets += 1;
        onProgress({
          phase: 'render',
          current: i - 1,
          total: n,
          detail: spread ? `Splitting sheet ${i} of ${n} into two pages` : `Rendering page ${i} of ${n}`
        });
        if (!sized) {
          pageWidth = spread ? base.width / 2 : base.width;
          pageHeight = base.height;
          sized = true;
        }
        const basis = spread ? base.width / 2 : base.width;
        let scale = 1500 / (basis || 1500);
        if ((base.height || 1) * scale > 2100) scale = 2100 / base.height;
        scale = Math.min(2.4, Math.max(0.85, scale));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        try {
          await page.render({ canvasContext: ctx, viewport }).promise;
        } catch (e) {
          ctx.fillStyle = '#f4efe2';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        let items = [];
        try {
          const content = await page.getTextContent();
          items = content.items || [];
        } catch (e) {}
        pageMap[i - 1] = leaf;
        if (spread) {
          const mid = Math.round(canvas.width / 2);
          const halves = splitItems(items, viewport);
          await storeLeaf(sliceCanvas(canvas, 0, mid), itemsToText(halves[0]));
          await storeLeaf(sliceCanvas(canvas, mid, canvas.width - mid), itemsToText(halves[1]));
        } else {
          await storeLeaf(canvas, itemsToText(items));
        }
        try { page.cleanup(); } catch (e) {}
      }
      if (splitSheets) {
        const remap = (nodes) => (nodes || []).map((node) => ({
          title: node.title,
          page: node.page == null ? null : (pageMap[node.page] == null ? null : pageMap[node.page]),
          items: remap(node.items)
        }));
        outline = remap(outline);
      }
      try { await BookDB.putOutline(id, outline); } catch (e) {}
      if (signal && signal.aborted) throw abortError();
      onProgress({ phase: 'save', current: 0, total: 1, detail: 'Saving the book on this device…' });
      let hasPdf = true;
      try { await BookDB.putPdf(id, file); }
      catch (e) { hasPdf = false; }
      const book = {
        id, title, fileName: file.name || 'book.pdf',
        created: Date.now(), updated: Date.now(), lastOpened: Date.now(),
        pageCount: leaf, pageWidth, pageHeight, splitSheets,
        lastPage: 0, layout: 'auto', zoom: 1, sidebar: false,
        bookmarks: [], recent: [],
        bytes, hasPdf, ocr: 'none',
        textChars: texts.reduce((sum, text) => sum + text.length, 0),
        cover
      };
      await BookDB.putBook(book);
      onProgress({ phase: 'save', current: 1, total: 1, detail: 'Saved' });
      return { id, needsOcr: textIsSparse(texts), pageCount: leaf, splitSheets, title };
    } catch (err) {
      try { await BookDB.deleteBook(id); } catch (e) {}
      if (signal && signal.aborted) return null;
      if (err && err.name === 'AbortError') return null;
      if (err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message || '')))) {
        throw new Error('This browser ran out of room to store the book.');
      }
      throw err;
    } finally {
      try { if (pdf && pdf.destroy) await pdf.destroy(); } catch (e) {}
      canvas.width = 1;
      canvas.height = 1;
      thumb.width = 1;
      thumb.height = 1;
    }
  }

  async function ocrBook(bookId, opts) {
    const onProgress = (opts && opts.onProgress) || (() => {});
    const signal = opts && opts.signal;
    if (!window.Tesseract) throw new Error('Text recognition failed to load.');
    const book = await BookDB.getBook(bookId);
    if (!book) throw new Error('That book is no longer saved in this browser.');
    onProgress({ phase: 'ocr', current: 0, total: book.pageCount, detail: 'Loading the recognition engine…' });
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: asset('vendor/tesseract/worker.min.js'),
      corePath: asset('vendor/tesseract/'),
      langPath: asset('vendor/tesseract/tessdata'),
      logger: (message) => {
        if (!message || !message.status) return;
        const status = String(message.status).replace(/_/g, ' ');
        onProgress({
          phase: 'ocr',
          current: 0,
          total: book.pageCount,
          detail: status.charAt(0).toUpperCase() + status.slice(1),
          fraction: typeof message.progress === 'number' ? message.progress : 0
        });
      }
    });
    try {
      if (signal && signal.aborted) throw abortError();
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      for (let i = 0; i < book.pageCount; i++) {
        if (signal && signal.aborted) throw abortError();
        onProgress({
          phase: 'ocr',
          current: i,
          total: book.pageCount,
          detail: `Reading page ${i + 1} of ${book.pageCount}`
        });
        const record = await BookDB.getPage(bookId, i);
        if (!record || !record.image) continue;
        const result = await worker.recognize(record.image);
        const text = (result && result.data && result.data.text ? result.data.text : '').trim();
        await BookDB.putText(bookId, i, text);
      }
      const texts = await BookDB.getTexts(bookId);
      await BookDB.patchBook(bookId, {
        ocr: 'done',
        textChars: texts.reduce((sum, text) => sum + text.length, 0)
      });
      return texts;
    } finally {
      try { await worker.terminate(); } catch (e) {}
    }
  }

  window.PdfImport = { importFile, ocrBook, textIsSparse, asset, outlineFromBlob, readOutline, isSpread };
})();
