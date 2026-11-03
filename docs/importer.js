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
      let pageWidth = 612;
      let pageHeight = 792;
      let cover = null;
      let bytes = file.size || 0;
      const texts = [];
      for (let i = 1; i <= n; i++) {
        if (signal && signal.aborted) throw abortError();
        onProgress({ phase: 'render', current: i - 1, total: n, detail: `Rendering page ${i} of ${n}` });
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        if (i === 1) {
          pageWidth = base.width || pageWidth;
          pageHeight = base.height || pageHeight;
        }
        let scale = 1500 / (base.width || 1500);
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
        let text = '';
        try {
          const content = await page.getTextContent();
          text = itemsToText(content.items || []);
        } catch (e) {}
        texts.push(text);
        const image = await toBlob(canvas, 'image/jpeg', 0.86);
        const tw = 200;
        const th = Math.max(1, Math.round(canvas.height * (tw / canvas.width)));
        thumb.width = tw;
        thumb.height = th;
        const tctx = thumb.getContext('2d', { alpha: false });
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, tw, th);
        tctx.drawImage(canvas, 0, 0, tw, th);
        const thumbBlob = await toBlob(thumb, 'image/jpeg', 0.72);
        if (!cover) cover = thumbBlob;
        bytes += image.size + thumbBlob.size;
        await BookDB.putPage({ bookId: id, index: i - 1, image, thumb: thumbBlob });
        await BookDB.putText(id, i - 1, text);
        try { page.cleanup(); } catch (e) {}
      }
      if (signal && signal.aborted) throw abortError();
      onProgress({ phase: 'save', current: 0, total: 1, detail: 'Saving the book on this device…' });
      let hasPdf = true;
      try { await BookDB.putPdf(id, file); }
      catch (e) { hasPdf = false; }
      const book = {
        id, title, fileName: file.name || 'book.pdf',
        created: Date.now(), updated: Date.now(), lastOpened: Date.now(),
        pageCount: n, pageWidth, pageHeight,
        lastPage: 0, layout: 'auto', zoom: 1, sidebar: false,
        bookmarks: [], recent: [],
        bytes, hasPdf, ocr: 'none',
        textChars: texts.reduce((sum, text) => sum + text.length, 0),
        cover
      };
      await BookDB.putBook(book);
      onProgress({ phase: 'save', current: 1, total: 1, detail: 'Saved' });
      return { id, needsOcr: textIsSparse(texts), pageCount: n, title };
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

  window.PdfImport = { importFile, ocrBook, textIsSparse, asset };
})();
