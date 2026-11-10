/* Flipbook reader. Page images and text come from the book open in this browser. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const V = window.APP_VERSION || { version: 'dev' };

  let SESSION = null;
  let RATIO = 1.35;
  let epoch = 0;
  let bookmarks = [];
  let recent = [];
  let bookId = '';
  let outline = [];
  let chapters = [];
  let annotations = [];
  let annoMode = 'read';
  let chapterEdit = '';
  let noteEdit = null;
  let markDrag = null;
  let DATA = { pages: [] };
  let flip = null, mode = null, imgs = [], current = 0, N = 0, phone = false, land = false;
  let wired = false;
  const state = { page: 0, layout: 'auto', zoom: 1, sidebar: false };

  function toast(msg, action, fn, ms = 2600) {
    const t = $('#toast'); if (!t) return;
    $('.msg', t).textContent = msg;
    const a = $('.act', t);
    if (action) { a.textContent = action; a.classList.remove('hidden'); a.onclick = () => { t.classList.add('hidden'); fn(); }; }
    else a.classList.add('hidden');
    t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  window.FlipbookToast = toast;

  function saveState() {
    if (!SESSION) return;
    state.page = current;
    SESSION.onState && SESSION.onState({
      lastPage: current,
      layout: state.layout,
      zoom: state.zoom,
      sidebar: !!state.sidebar
    });
  }
  function saveBookmarks() { if (SESSION && SESSION.onBookmarks) SESSION.onBookmarks(bookmarks.slice()); }
  function saveRecent() { if (SESSION && SESSION.onRecent) SESSION.onRecent(recent.slice()); }

  function detectDevice() {
    const coarsePointer = matchMedia('(pointer: coarse)').matches;
    const w = innerWidth, h = innerHeight;
    phone = w <= 700 || (coarsePointer && Math.min(w, h) <= 520);
    land = phone && w > h;
    document.body.classList.toggle('phone', phone);
    document.body.classList.toggle('land', land);
    placeSearch();
  }
  const coarse = () => matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);
  function stageBox() {
    const st = $('#stage'); const cs = getComputedStyle(st);
    let w = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let h = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w < 20) w = Math.max(200, innerWidth - 24);
    if (h < 20) h = Math.max(200, innerHeight - 120);
    return { w, h };
  }
  function computeLayout() {
    const { w, h } = stageBox();
    const pwSpread = Math.min(w / 2, h / RATIO), pwSingle = Math.min(w, h / RATIO);
    let m;
    if (state.layout === 'single') m = 'portrait';
    else if (state.layout === 'spread') m = 'landscape';
    else m = phone ? 'portrait' : ((w >= 700 && pwSpread >= pwSingle * 0.7) ? 'landscape' : 'portrait');
    const pw = Math.max(50, Math.floor(m === 'landscape' ? pwSpread : pwSingle));
    return { m, pw, ph: Math.floor(pw * RATIO) };
  }
  function sizeBook(L) {
    const b = $('#book'); if (!b) return;
    b.style.width = (L.m === 'landscape' ? L.pw * 2 : L.pw) + 'px';
    b.style.height = L.ph + 'px';
  }
  function build(startAt) {
    const myEpoch = epoch;
    const L = computeLayout(); mode = L.m;
    if (flip) { try { flip.destroy(); } catch (e) {} flip = null; }
    $('#bookWrap').innerHTML = '<div id="book"></div>';
    sizeBook(L);
    imgs = [];
    const nodes = [];
    for (let i = 0; i < N; i++) {
      const d = document.createElement('div');
      d.className = 'page'; d.dataset.density = (i === 0 || i === N - 1) ? 'hard' : 'soft'; d.dataset.i = i;
      const im = document.createElement('img'); im.alt = `Page ${i + 1}`; im.draggable = false; im.decoding = 'async';
      d.appendChild(im); nodes.push(d); imgs.push(im);
    }
    const pw = SESSION.pageWidth || 1000;
    const ph = SESSION.pageHeight || Math.round(pw * RATIO);
    const curl = curls();
    flip = new St.PageFlip($('#book'), {
      width: pw, height: ph, size: 'stretch',
      minWidth: L.m === 'portrait' ? 100000 : 50, maxWidth: 4000, minHeight: 50, maxHeight: 6000,
      showCover: true, usePortrait: true, autoSize: false, drawShadow: curl,
      maxShadowOpacity: 0.5, flippingTime: phone ? 550 : 700, mobileScrollSupport: false,
      showPageCorners: curl && annoMode === 'read' && !phone && !coarse(), disableFlipByClick: true,
      useMouseEvents: curl && annoMode === 'read' && !coarse(), swipeDistance: 30,
      startPage: Math.max(0, Math.min(N - 1, startAt || 0))
    });
    flip.loadFromHTML(nodes);
    installBackwardTurn(flip);
    flip.on('flip', (e) => { if (myEpoch === epoch) onPage(e.data); });
    renderRibbons();
    paintMarks();
    onPage(flip.getCurrentPageIndex());
  }
  function relayout(force) {
    if (!SESSION || !N) return;
    const wasPhone = phone, wasLand = land;
    detectDevice();
    const L = computeLayout();
    if (force || L.m !== mode || wasPhone !== phone || wasLand !== land) { build(current); return; }
    sizeBook(L); if (flip) flip.update();
  }
  let rt = null;
  const onResize = () => {
    if (!document.body.classList.contains('reading')) return;
    sizeBook(computeLayout());
    clearTimeout(rt); rt = setTimeout(() => relayout(false), 160);
    if (zoomOpen()) zoomApply();
  };
  addEventListener('resize', () => { onResize(); layoutThumbs(); });
  addEventListener('orientationchange', () => setTimeout(() => relayout(true), 250));

  function visiblePages() {
    if (mode === 'landscape' && current > 0) { const l = current % 2 === 1 ? current : current - 1; return [l, l + 1].filter((x) => x < N); }
    return [current];
  }
  function ensureLoaded(i) {
    const myEpoch = epoch;
    const jobs = [];
    for (let k = i - 2; k <= i + 4; k++) {
      if (k < 0 || k >= N || !imgs[k] || imgs[k].getAttribute('src') || imgs[k].dataset.loading) continue;
      imgs[k].dataset.loading = '1';
      const index = k;
      jobs.push(SESSION.getPageUrl(index).then((url) => {
        if (myEpoch !== epoch || !imgs[index]) return;
        if (url) imgs[index].src = url;
      }).catch(() => {}));
    }
    return Promise.all(jobs);
  }
  function onPage(i) {
    if (!SESSION) return;
    current = i; ensureLoaded(i);
    const input = $('#pageInput');
    if (input) input.value = i + 1;
    $$('.bb-num').forEach((el) => { el.textContent = i + 1; });
    $$('.thumb.current').forEach((t) => t.classList.remove('current'));
    const th = $(`.thumb[data-i="${i}"]`);
    if (th) { th.classList.add('current'); if (!$('#sidebar').classList.contains('hidden')) th.scrollIntoView({ block: 'nearest' }); }
    state.page = i;
    saveState();
    updateBmToggle();
  }
  let turningBack = false;
  function curls() {
    try { return localStorage.getItem('flipbook.animate') !== '0'; } catch (e) { return true; }
  }
  function setPageTurn(on, announce) {
    try { localStorage.setItem('flipbook.animate', on ? '1' : '0'); } catch (e) {}
    turningBack = false;
    renderMenu();
    if (SESSION && N) build(current);
    if (announce) toast(on ? 'Page turn animation on' : 'Pages turn instantly');
  }
  function go(i, doAnim = true) {
    i = Math.max(0, Math.min(N - 1, i | 0));
    ensureLoaded(i);
    if (!flip || turningBack) return;
    const from = flip.getCurrentPageIndex();
    const distance = Math.abs(i - from);
    const portrait = onePage(flip);
    const curl = doAnim && curls();
    if (curl && portrait && i < from) {
      if (from - i === 1) curlPortraitBack(flip);
      else flip.turnToPage(i);
      return;
    }
    if (curl && distance > 0 && distance <= 2) viaLib(() => flip.flip(i));
    else flip.turnToPage(i);
  }
  function viaLib(fn) { if (!flip) return; const st = flip.getSettings(); st.disableFlipByClick = false; try { fn(); } finally { st.disableFlipByClick = true; } }
  function instantStep(dir) {
    const cur = flip.getCurrentPageIndex();
    let dest;
    if (onePage(flip)) dest = cur + dir;
    else if (dir > 0) dest = cur === 0 ? 1 : cur + 2;
    else dest = cur <= 1 ? 0 : cur - 2;
    if (dest >= 0 && dest < N && dest !== cur) flip.turnToPage(dest);
  }
  const next = () => {
    if (!flip || turningBack) return;
    ensureLoaded(current + (onePage(flip) ? 1 : 2));
    if (curls()) viaLib(() => flip.flipNext()); else instantStep(1);
  };
  const prev = () => {
    if (!flip || turningBack) return;
    ensureLoaded(current - 1);
    if (curls()) viaLib(() => flip.flipPrev()); else instantStep(-1);
  };
  function onePage(book) {
    return mode === 'portrait' || !!(book && book.getOrientation && book.getOrientation() === 'portrait');
  }
  // In one-page mode the library curls backward on a page that sits off screen,
  // so nothing moves until the snap. Run the same forward curl, mirrored, with
  // the previous page underneath. Wide spreads already curl the left page.
  function installBackwardTurn(book) {
    const orig = book.flipPrev.bind(book);
    book.flipPrev = (corner) => {
      if (onePage(book)) curlPortraitBack(book);
      else orig(corner);
    };
  }
  function curlPortraitBack(book) {
    if (turningBack || !book) return;
    const from = book.getCurrentPageIndex();
    if (from <= 0) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      book.turnToPage(from - 1);
      return;
    }
    const pages = book.getPageCollection();
    const host = document.getElementById('book');
    const prevImg = imgs[from - 1];
    if (!prevImg || !prevImg.getAttribute('src')) {
      turningBack = true;
      ensureLoaded(from - 1).then(() => {
        turningBack = false;
        if (flip !== book || book.getCurrentPageIndex() !== from) return;
        curlPortraitBack(book);
      });
      return;
    }
    const stamp = epoch;
    turningBack = true;
    host.classList.add('curl-back');
    const origBottom = pages.getBottomPage.bind(pages);
    const origShowNext = pages.showNext.bind(pages);
    const savedIndex = pages.currentPageIndex;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      pages.getBottomPage = origBottom;
      pages.showNext = origShowNext;
      if (pages.currentPageIndex === 0 && savedIndex !== 0) pages.currentPageIndex = savedIndex;
      host.classList.remove('curl-back');
      turningBack = false;
    };
    pages.getBottomPage = function(direction) {
      if (direction === 0) {
        const prev = this.pages[from - 1];
        if (prev) return prev;
      }
      return origBottom(direction);
    };
    pages.showNext = function() {
      pages.getBottomPage = origBottom;
      pages.showNext = origShowNext;
      host.classList.remove('curl-back');
      turningBack = false;
      restored = true;
      if (stamp === epoch && flip === book) this.show(from - 1);
    };
    // A forward curl is refused on the last page. The check only reads the index.
    if (savedIndex >= book.getPageCount() - 1) pages.currentPageIndex = Math.max(0, savedIndex - 1);
    viaLib(() => book.flipNext('top'));
    const ms = (book.getSettings && book.getSettings().flippingTime) || 700;
    setTimeout(() => {
      if (!turningBack || stamp !== epoch) return;
      restore();
      if (flip === book && book.getCurrentPageIndex() === from) book.turnToPage(from - 1);
    }, ms + 400);
  }

  (function gestures() {
    const stage = $('#stage');
    let down = null, lastTap = null, tapTimer = null, pinchActive = false;
    const pts = new Map();
    stage.addEventListener('pointerdown', (e) => {
      if (!SESSION || annoMode !== 'read') return;
      pts.set(e.pointerId, e);
      down = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
    });
    const end = (e) => {
      const had = pts.has(e.pointerId); pts.delete(e.pointerId);
      if (!had || !down) { if (!pts.size) down = null; return; }
      const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t; down = null;
      if (!SESSION || !flip || annoMode !== 'read') return;
      if (Math.hypot(dx, dy) > 12) {
        if (!coarse() || pinchActive) return;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 900) { if (dx < 0) next(); else prev(); }
        return;
      }
      if (dt > 450) return;
      if (e.target.closest('button')) return;
      const x = e.clientX, y = e.clientY;
      if (lastTap && Date.now() - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
        clearTimeout(tapTimer); lastTap = null; zoomOpenAt(pageAtPoint(x), x, y); return;
      }
      lastTap = { x, y, t: Date.now() };
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        lastTap = null;
        const book = $('#book'); if (!book) return;
        const r = book.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
        const f = (x - r.left) / r.width;
        if (phone || mode === 'portrait') { if (f < 0.35) prev(); else if (f > 0.65) next(); }
        else { if (f < 0.5) prev(); else next(); }
      }, 300);
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); down = null; });

    addEventListener('touchstart', (e) => {
      if (!SESSION || zoomOpen() || annoMode !== 'read' || e.touches.length < 2 || !e.target.closest('#stage')) return;
      e.preventDefault(); e.stopPropagation();
      try { if (flip && flip.ui) flip.ui.touchPoint = null; } catch (er) {}
      const [a, b] = e.touches; const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      pinchActive = true; setTimeout(() => { pinchActive = false; }, 600);
      zoomOpenAt(pageAtPoint(cx, cy), cx, cy, 1);
      startPinch(e.touches);
    }, { capture: true, passive: false });
  })();
  function pageAtPoint(x) {
    const vis = visiblePages(); if (vis.length < 2) return vis[0];
    const r = $('#book').getBoundingClientRect(); return x < r.left + r.width / 2 ? vis[0] : vis[1];
  }

  let zScale = 1, zPage = 0, pinchS = null;
  const zoomOpen = () => !$('#zoom').classList.contains('hidden');
  function zoomOpenAt(i, cx, cy, scale) {
    zPage = i == null ? current : i;
    $('#zoom').classList.remove('hidden');
    zScale = scale || (state.zoom > 1 ? state.zoom : 1);
    zoomShow(); zoomApply();
    if (cx != null) {
      const s = $('#zScroll');
      requestAnimationFrame(() => {
        s.scrollLeft = (s.scrollWidth - s.clientWidth) * (cx / innerWidth);
        s.scrollTop = (s.scrollHeight - s.clientHeight) * (cy / innerHeight);
      });
    }
  }
  function zoomShow() {
    const i = zPage;
    const myEpoch = epoch;
    SESSION.getPageUrl(i).then((url) => {
      if (myEpoch !== epoch || i !== zPage) return;
      $('#zImg').src = url || '';
    }).catch(() => {});
    $('#zLabel').textContent = `Page ${i + 1}`;
    paintZoomMarks();
  }
  function fitWidth() { const s = $('#zScroll'); return Math.min(s.clientWidth - (phone ? 8 : 40), (s.clientHeight - (phone ? 8 : 40)) / RATIO); }
  function zoomApply() {
    $('#zImg').style.width = Math.round(fitWidth() * zScale) + 'px';
    $('#zImg').style.margin = phone ? '4px auto' : '';
    $('#zPct').textContent = Math.round(zScale * 100) + '%';
  }
  function zoomTo(scale, cx, cy) {
    const s = $('#zScroll'), r = s.getBoundingClientRect();
    cx = cx == null ? s.clientWidth / 2 : cx - r.left; cy = cy == null ? s.clientHeight / 2 : cy - r.top;
    const old = zScale; zScale = Math.max(0.5, Math.min(6, scale));
    const rx = (s.scrollLeft + cx) / Math.max(1, s.scrollWidth), ry = (s.scrollTop + cy) / Math.max(1, s.scrollHeight);
    zoomApply();
    if (old !== zScale) { s.scrollLeft = rx * s.scrollWidth - cx; s.scrollTop = ry * s.scrollHeight - cy; }
    state.zoom = zScale; saveState();
  }
  const zoomBy = (f, cx, cy) => zoomTo(zScale * f, cx, cy);
  const zoomClose = () => { $('#zoom').classList.add('hidden'); if (zPage !== current) go(zPage, false); };
  function zStep(d) { const n = zPage + d; if (n < 0 || n >= N) return; zPage = n; zoomShow(); $('#zScroll').scrollTop = 0; }
  function startPinch(touches) {
    const [a, b] = touches;
    pinchS = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: zScale };
  }
  (function zoomGestures() {
    const s = $('#zScroll'); let d = null;
    s.addEventListener('mousedown', (e) => { d = { x: e.clientX, y: e.clientY, l: s.scrollLeft, t: s.scrollTop }; s.classList.add('drag'); e.preventDefault(); });
    addEventListener('mousemove', (e) => { if (!d) return; s.scrollLeft = d.l - (e.clientX - d.x); s.scrollTop = d.t - (e.clientY - d.y); });
    addEventListener('mouseup', () => { d = null; s.classList.remove('drag'); });
    s.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); } }, { passive: false });
    $('#zImg').addEventListener('dblclick', (e) => zoomTo(zScale < 1.9 ? 2.5 : 1, e.clientX, e.clientY));
    let sw = null, lastTap = 0;
    addEventListener('touchstart', (e) => {
      if (!zoomOpen() || !e.target.closest('#zScroll')) return;
      if (e.touches.length === 2) { e.preventDefault(); startPinch(e.touches); sw = null; }
      else if (e.touches.length === 1) { const t = e.touches[0]; sw = { x: t.clientX, y: t.clientY, t: Date.now() }; }
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      if (!zoomOpen() || !pinchS) return;
      if (e.touches.length >= 2) {
        e.preventDefault(); e.stopPropagation();
        const [a, b] = e.touches;
        zoomTo(pinchS.s * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinchS.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      }
    }, { capture: true, passive: false });
    addEventListener('touchend', (e) => {
      if (pinchS && e.touches.length < 2) { pinchS = null; e.stopPropagation(); if (zScale < 1) zoomTo(1); return; }
      if (!zoomOpen() || !sw || e.touches.length) return;
      const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
      if (Math.hypot(dx, dy) < 10 && dt < 300) {
        if (Date.now() - lastTap < 320) { lastTap = 0; zoomTo(zScale < 1.9 ? 2.5 : 1, t.clientX, t.clientY); } else lastTap = Date.now();
      } else if (zScale <= 1.05 && Math.abs(dx) > 60 && Math.abs(dy) < 80 && dt < 600) zStep(dx < 0 ? 1 : -1);
    }, { capture: true });
  })();
  addEventListener('gesturestart', (e) => e.preventDefault());

  function buildThumbs() {
    const box = $('#thumbs'); const frag = document.createDocumentFragment();
    const myEpoch = epoch;
    for (let i = 0; i < N; i++) {
      const t = document.createElement('div'); t.className = 'thumb'; t.dataset.i = i;
      const im = document.createElement('img'); im.alt = ''; im.decoding = 'async';
      const aspect = RATIO > 0.2 ? 1 / RATIO : 0.772;
      im.width = 200; im.height = Math.max(1, Math.round(200 / aspect));
      const label = document.createElement('span'); label.textContent = String(i + 1);
      t.appendChild(im); t.appendChild(label);
      const index = i;
      SESSION.getThumbUrl(index).then((url) => { if (myEpoch === epoch && url) im.src = url; }).catch(() => {});
      t.onclick = () => { go(index); if (phone) closeSheet('sidebar'); };
      frag.appendChild(t);
    }
    box.appendChild(frag);
    layoutThumbs();
  }
  function layoutThumbs() {
    const grid = $('#thumbs');
    if (!grid) return;
    const card = grid.querySelector('.thumb');
    const width = card ? card.clientWidth : 0;
    if (width < 16) return;
    const ratio = RATIO > 0.2 ? RATIO : 1.3;
    const height = Math.max(48, Math.round(width * ratio));
    const px = height + 'px';
    grid.style.setProperty('--thumb-h', px);
    grid.style.gridAutoRows = px;
    grid.querySelectorAll('.thumb').forEach((el) => { el.style.height = px; el.style.minHeight = px; });
  }
  function setSidebar(open) {
    $('#sidebar').classList.toggle('hidden', !open);
    document.body.classList.toggle('sb', open && !phone);
    if (!phone) { state.sidebar = open; saveState(); relayout(true); }
    const th = $('.thumb.current'); if (open && th) th.scrollIntoView({ block: 'center' });
    if (open) requestAnimationFrame(layoutThumbs);
  }

  const SHEETS = { search: '#searchSheet', bookmarks: '#bookmarksSheet', contents: '#contentsSheet', notes: '#notesSheet', menu: '#menuSheet', sidebar: '#sidebar' };
  const PANEL_SHEETS = ['bookmarks', 'contents', 'notes', 'menu', 'search'];
  function blockersOpen() {
    const importer = $('#importer'), offer = $('#ocrOffer');
    return (importer && !importer.classList.contains('hidden')) || (offer && !offer.classList.contains('hidden'));
  }
  function openSheet(name) {
    if (!SESSION || blockersOpen()) return;
    if (name === 'sidebar') { setSidebar($('#sidebar').classList.contains('hidden')); return; }
    if (name === 'search' && !phone) { $('#searchInput').focus(); $('#searchResults').classList.remove('hidden'); renderSearch($('#searchInput').value); return; }
    for (const k of PANEL_SHEETS) if (k !== name) $(SHEETS[k]).classList.add('hidden');
    const el = $(SHEETS[name]);
    el.classList.remove('hidden');
    if (name === 'bookmarks') renderBookmarks();
    if (name === 'contents') renderContents();
    if (name === 'notes') renderNotes();
    if (name === 'menu') { renderMenu(); document.dispatchEvent(new CustomEvent('flipbook-menu')); }
    if (name === 'search') { $('#searchResults').classList.remove('hidden'); renderSearch($('#searchInput').value); setTimeout(() => $('#searchInput').focus(), 50); }
  }
  function closeSheet(name) {
    if (name === 'sidebar') { if (!$('#sidebar').classList.contains('hidden')) setSidebar(false); return; }
    const el = $(SHEETS[name]); if (el) el.classList.add('hidden');
    if (name === 'search') { const input = $('#searchInput'); if (input) input.blur(); }
  }
  const anySheetOpen = () => ['#searchSheet', '#bookmarksSheet', '#contentsSheet', '#notesSheet', '#menuSheet'].some((s) => !$(s).classList.contains('hidden')) || (phone && !$('#sidebar').classList.contains('hidden'));
  function closeAll() { PANEL_SHEETS.forEach(closeSheet); if (phone) closeSheet('sidebar'); }
  function placeSearch() {
    const s = $('#search'); if (!s) return;
    if (phone && s.parentElement.id !== 'searchSheet') $('#searchSheet').appendChild(s);
    if (!phone && s.parentElement.id === 'searchSheet') { $('.topbar .tools').before(s); $('#searchSheet').classList.add('hidden'); }
  }

  const isBm = (p) => bookmarks.some((b) => b.page === p);
  function updateBmToggle() {
    const on = visiblePages().some(isBm);
    $$('.bm-toggle').forEach((b) => {
      b.classList.toggle('on', on);
      const label = b.querySelector('span') || b;
      label.textContent = on ? '★' : '☆';
      b.title = on ? 'Remove bookmark (B)' : 'Bookmark this page (B)';
    });
    $$('.thumb.bm').forEach((t) => t.classList.remove('bm'));
    bookmarks.forEach((b) => { const t = $(`.thumb[data-i="${b.page}"]`); if (t) t.classList.add('bm'); });
    const count = $('#bmCount');
    if (count) count.textContent = bookmarks.length ? `${bookmarks.length}` : '';
  }
  function renderRibbons() {
    $$('.page .ribbon').forEach((r) => r.remove());
    bookmarks.forEach((b) => {
      const pg = imgs[b.page] && imgs[b.page].parentElement;
      if (pg) { const r = document.createElement('div'); r.className = 'ribbon'; pg.appendChild(r); }
    });
  }
  function upsertBookmark(page, label) {
    page = Math.max(0, Math.min(N - 1, page));
    const ex = bookmarks.find((b) => b.page === page);
    if (ex) ex.label = label; else bookmarks.push({ page, label, ts: Date.now() });
    bookmarks.sort((a, b) => a.page - b.page);
    saveBookmarks(); renderRibbons(); updateBmToggle(); renderBookmarks();
  }
  function removeBookmark(page, undo = true) {
    const ex = bookmarks.find((b) => b.page === page); if (!ex) return;
    bookmarks = bookmarks.filter((b) => b.page !== page);
    saveBookmarks(); renderRibbons(); updateBmToggle(); renderBookmarks();
    if (undo) toast(`Removed bookmark on page ${page + 1}`, 'Undo', () => upsertBookmark(ex.page, ex.label), 4000);
  }
  function toggleBookmark() {
    const vis = visiblePages(); const marked = vis.find(isBm);
    if (marked != null) removeBookmark(marked); else openBmDialog(vis[0]);
  }
  function openBmDialog(page) {
    const ex = bookmarks.find((b) => b.page === page);
    $('#dlgTitle').textContent = ex ? 'Edit bookmark' : 'Add bookmark';
    $('#dlgPage').value = page + 1; $('#dlgPage').max = N; $('#dlgLabel').value = ex ? ex.label : '';
    $('#dlgRemove').classList.toggle('hidden', !ex);
    $('#dialog').classList.remove('hidden');
    $('#dlgLabel').focus();
  }
  const closeDialog = () => { $('#dialog').classList.add('hidden'); if (document.activeElement && document.activeElement.closest('#dialog')) document.activeElement.blur(); };
  function renderBookmarks() {
    const list = $('#bmList'); if (!list) return;
    if (!bookmarks.length) { list.replaceChildren(); list.innerHTML = '<div class="bm-empty">No bookmarks yet.<br>Tap the star or press B on any page.</div>'; return; }
    list.innerHTML = bookmarks.map((b) => `<div class="bmitem" data-p="${b.page}">
      <img alt="">
      <div class="t"><b>Page ${b.page + 1}</b><div>${esc(b.label || pageTitle(b.page))}</div></div>
      <div class="acts"><button class="edit" type="button" aria-label="Edit label">✎</button><button class="del" type="button" aria-label="Delete">🗑</button></div></div>`).join('');
    const myEpoch = epoch;
    $$('.bmitem', list).forEach((el) => {
      const p = +el.dataset.p;
      SESSION.getThumbUrl(p).then((url) => { if (myEpoch === epoch && url) el.querySelector('img').src = url; }).catch(() => {});
      el.onclick = (e) => {
        if (e.target.closest('.edit')) { openBmDialog(p); return; }
        if (e.target.closest('.del')) { removeBookmark(p); return; }
        go(p); if (phone) closeSheet('bookmarks');
      };
    });
  }
  function pageTitle(i) {
    const text = DATA.pages[i] ? DATA.pages[i].text : '';
    const lines = (text || '').split('\n').map((s) => s.trim()).filter((s) => s.length > 3 && /[a-z]{3}/i.test(s));
    return lines[0] ? lines[0].slice(0, 50) : 'No text on this page';
  }

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let NORM = [];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function snippet(text, ntext, terms) {
    let pos = -1, len = 0;
    for (const t of terms) { const p = ntext.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) { pos = p; len = t.length; } }
    if (pos < 0) return esc((text || '').slice(0, 140));
    const a = Math.max(0, pos - 60), b = Math.min(text.length, pos + len + 90);
    let s = esc(text.slice(a, b).replace(/\s+/g, ' '));
    for (const t of terms) s = s.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    return (a > 0 ? '… ' : '') + s + (b < text.length ? ' …' : '');
  }
  const count = (nt, t) => { let c = 0, p = 0; while ((p = nt.indexOf(t, p)) >= 0) { c++; p += t.length; } return c; };
  let lastHits = [], activeIdx = -1;
  function addRecent(q) {
    q = q.trim(); if (q.length < 2) return;
    recent = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    saveRecent();
  }
  function renderSearch(q) {
    const box = $('#searchResults');
    $$('.thumb.hit').forEach((t) => t.classList.remove('hit'));
    q = (q || '').trim();
    if (q.length < 2) {
      lastHits = [];
      if (recent.length) {
        box.innerHTML = `<div class="meta"><span>Recent searches</span><button class="clr" type="button">Clear</button></div>` + recent.map((r) => `<div class="recent" data-q="${esc(r)}">${esc(r)}</div>`).join('');
        $('.clr', box).onclick = (e) => { e.stopPropagation(); recent = []; saveRecent(); renderSearch(''); };
        $$('.recent', box).forEach((el) => el.onclick = (e) => { e.stopPropagation(); $('#searchInput').value = el.dataset.q; renderSearch(el.dataset.q); addRecent(el.dataset.q); });
        box.classList.remove('hidden');
      } else { box.innerHTML = phone ? `<div class="meta">Type to search all ${N} pages</div>` : ''; box.classList.toggle('hidden', !phone); }
      return;
    }
    const phrase = /^".*"$/.test(q);
    const terms = phrase ? [norm(q.slice(1, -1))] : norm(q).split(/\s+/).filter(Boolean);
    const hits = [];
    for (let i = 0; i < N; i++) { const nt = NORM[i] || ''; if (terms.every((t) => nt.includes(t))) hits.push({ i, score: terms.reduce((s, t) => s + count(nt, t), 0) }); }
    lastHits = hits; activeIdx = -1;
    hits.forEach((h) => { const th = $(`.thumb[data-i="${h.i}"]`); if (th) th.classList.add('hit'); });
    const total = hits.reduce((s, h) => s + h.score, 0);
    const myEpoch = epoch;
    box.innerHTML = `<div class="meta"><span>${hits.length ? `${total} match${total === 1 ? '' : 'es'} on ${hits.length} page${hits.length === 1 ? '' : 's'}` : 'No matches'}</span><span>${phone ? '' : 'Enter = next'}</span></div>` +
      hits.slice(0, 200).map((h, k) => `<div class="result" data-k="${k}" data-i="${h.i}"><img alt=""><div><div class="pg">Page ${h.i + 1} · ${h.score}×${isBm(h.i) ? ' · ★' : ''}</div><div class="snip">${snippet(DATA.pages[h.i].text || '', NORM[h.i] || '', terms)}</div></div></div>`).join('');
    box.classList.remove('hidden');
    $$('.result', box).forEach((r) => {
      const i = +r.dataset.i;
      SESSION.getThumbUrl(i).then((url) => { if (myEpoch === epoch && url) r.querySelector('img').src = url; }).catch(() => {});
      r.onclick = (e) => { e.stopPropagation(); addRecent(q); setActive(+r.dataset.k); go(+r.dataset.i); if (phone) closeSheet('search'); };
    });
  }
  function setActive(k) {
    activeIdx = k; $$('.result').forEach((r) => r.classList.toggle('active', +r.dataset.k === k));
    const el = $(`.result[data-k="${k}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function renderMenu() {
    $$('#layoutSeg button').forEach((b) => b.classList.toggle('on', b.dataset.layout === state.layout));
    const curlOn = curls();
    $$('#animSeg button').forEach((b) => {
      const on = (b.dataset.anim === 'on') === curlOn;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const version = $('#versionInfo');
    if (version) version.textContent = `Version ${V.version}`;
    const menuPage = $('#menuPage');
    if (menuPage) menuPage.max = N;
    if (window.Theme) {
      $$('#themeSeg button').forEach((b) => {
        const on = b.dataset.theme === Theme.choice;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    if (window.Fairy) {
      $$('#fairySeg button').forEach((b) => b.classList.toggle('on', b.dataset.cursor === Fairy.cursor));
      $('#fairySound').checked = Fairy.sound;
      $('.fairy-note').classList.toggle('hidden', Fairy.supported);
      renderSoundNote();
    }
    const download = $('#btnDownloadPdf');
    const ocr = $('#btnOcr');
    if (download) download.classList.toggle('hidden', !(SESSION && SESSION.hasPdf));
    if (ocr) ocr.classList.toggle('hidden', !(SESSION && SESSION.showOcr));
  }
  function renderSoundNote() {
    const note = $('#customSoundNote');
    const reset = $('#btnSoundReset');
    if (!note || !window.Fairy) return;
    const apply = () => {
      if (Fairy.customName) {
        note.textContent = Fairy.customName + ' is saved on this device only. It is never uploaded.';
        if (reset) reset.classList.remove('hidden');
      } else {
        note.textContent = 'Built-in sound. A custom file stays on this device and is never uploaded.';
        if (reset) reset.classList.add('hidden');
      }
    };
    if (Fairy.refreshCustom) Fairy.refreshCustom().then(apply).catch(apply);
    else apply();
  }
  function soundFileOk(file) {
    const name = (file && file.name) || '';
    const type = (file && file.type) || '';
    return /\.(mp3|wav|m4a|ogg)$/i.test(name) || /audio\/(mpeg|wav|wave|x-wav|mp4|aac|x-m4a|m4a|ogg)/i.test(type);
  }
  function setTitle(title) {
    const text = title || 'Flipbook';
    const desk = $('#bookTitle'), mob = $('#bookTitlePhone');
    if (desk) desk.textContent = text;
    if (mob) mob.textContent = text;
    document.title = text === 'Flipbook' ? 'Flipbook' : `${text} — Flipbook`;
  }
  function applyTexts(texts) {
    DATA = { pages: texts.map((text) => ({ text: text || '' })) };
    N = DATA.pages.length;
    NORM = DATA.pages.map((p) => norm(p.text));
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('#btnPrev').onclick = prev; $('#btnNext').onclick = next; $('#navPrev').onclick = prev; $('#navNext').onclick = next;
    $('.bb-prev').onclick = prev; $('.bb-next').onclick = next;
    $('.bb-page').onclick = () => openSheet('menu');
    $('#btnFirst').onclick = () => go(0, false); $('#btnLast').onclick = () => go(N - 1, false);
    $('#btnSidebar').onclick = () => setSidebar($('#sidebar').classList.contains('hidden'));
    $('#btnZoom').onclick = () => zoomOpenAt(visiblePages()[0]);
    $('#btnFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); };
    $('#btnLibrary').onclick = () => SESSION && SESSION.onLibrary && SESSION.onLibrary();
    $('#btnLibraryPhone').onclick = () => SESSION && SESSION.onLibrary && SESSION.onLibrary();
    $('#btnLibraryMenu').onclick = () => SESSION && SESSION.onLibrary && SESSION.onLibrary();
    $('#btnDownloadPdf').onclick = () => SESSION && SESSION.onDownload && SESSION.onDownload();
    $('#btnOcr').onclick = () => SESSION && SESSION.onOcr && SESSION.onOcr();
    $$('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openSheet(b.dataset.open); }));
    $$('[data-close]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); closeSheet(b.dataset.close); }));
    $$('.bm-toggle').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (SESSION) toggleBookmark(); }));
    $('.bm-add').onclick = () => openBmDialog(visiblePages()[0]);
    $('#pageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { go((+e.target.value || 1) - 1, false); e.target.blur(); } });
    $('#pageInput').addEventListener('change', (e) => go((+e.target.value || 1) - 1, false));
    $('#menuGo').onclick = () => { const v = +$('#menuPage').value; if (v) { go(v - 1, false); closeSheet('menu'); } };
    $('#menuPage').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#menuGo').click(); });
    $$('#layoutSeg button').forEach((b) => b.onclick = () => { state.layout = b.dataset.layout; saveState(); renderMenu(); relayout(true); });
    $$('#animSeg button').forEach((b) => b.onclick = () => setPageTurn(b.dataset.anim === 'on', true));
    $$('#themeSeg button').forEach((b) => b.onclick = () => { if (window.Theme) { Theme.set(b.dataset.theme); renderMenu(); } });
    $$('#markSeg button').forEach((b) => b.onclick = () => setAnnoMode(b.dataset.mode));
    const chapterForm = $('#chapterForm');
    if (chapterForm) chapterForm.onsubmit = (e) => { e.preventDefault(); saveChapter(); };
    const chapterCancel = $('#chapterCancel');
    if (chapterCancel) chapterCancel.onclick = () => { chapterEdit = ''; renderContents(); };
    const noteForm = $('#noteForm');
    if (noteForm) noteForm.onsubmit = (e) => { e.preventDefault(); saveNoteDialog(); };
    $('#noteCancel').onclick = closeNoteDialog;
    $('#noteDelete').onclick = () => { if (noteEdit && noteEdit.id) removeAnnotation(noteEdit.id); closeNoteDialog(); };
    $('#noteDialog').addEventListener('click', (e) => { if (e.target.id === 'noteDialog') closeNoteDialog(); });
    $('#annoDone').onclick = () => setAnnoMode('read');
    $$('#fairySeg button').forEach((b) => b.onclick = () => { if (window.Fairy) { Fairy.setCursor(b.dataset.cursor); renderMenu(); } });
    $('#fairySound').onchange = (e) => { if (window.Fairy) Fairy.setSound(e.target.checked); };
    const playSound = $('#btnPlaySound');
    if (playSound) playSound.onclick = () => { if (window.Fairy) Fairy.preview(); };
    const pickSound = $('#btnCustomSound');
    const soundInput = $('#customSoundFile');
    if (pickSound && soundInput) pickSound.onclick = () => soundInput.click();
    if (soundInput) soundInput.onchange = async () => {
      const file = soundInput.files && soundInput.files[0];
      soundInput.value = '';
      if (!file || !window.Fairy) return;
      if (!soundFileOk(file)) { toast('Choose an mp3, wav, m4a, or ogg file.'); return; }
      if (file.size > 1048576) { toast('That sound is over 1 MB.'); return; }
      // Unlock in this gesture. The file is read afterward, then Play can use it.
      Fairy.unlock();
      try {
        const bytes = await file.arrayBuffer();
        const kept = bytes.slice(0);
        await BookDB.putClickSound({ name: file.name, type: file.type, bytes });
        Fairy.setCustom(kept, file.name, file.type);
        toast('Saved on this device. It is never uploaded.');
        renderSoundNote();
        if (Fairy.sound) Fairy.preview();
      } catch (err) {
        toast((err && err.message) || 'Could not save that sound.');
      }
    };
    const resetSound = $('#btnSoundReset');
    if (resetSound) resetSound.onclick = async () => {
      try { await BookDB.clearClickSound(); } catch (e) {}
      if (window.Fairy) Fairy.clearCustom();
      toast('Using the built-in sound.');
      renderSoundNote();
    };
    $('#btnResetData').onclick = () => {
      if (!confirm('Clear bookmarks and recent searches for this book?')) return;
      bookmarks = []; recent = []; saveBookmarks(); saveRecent();
      renderRibbons(); updateBmToggle(); renderBookmarks(); toast('Bookmarks and searches cleared');
    };
    $('#dlgForm').onsubmit = (e) => { e.preventDefault(); const p = (+$('#dlgPage').value || current + 1) - 1; upsertBookmark(p, $('#dlgLabel').value.trim()); closeDialog(); toast(`Bookmarked page ${p + 1}`); };
    $('#dlgCancel').onclick = closeDialog;
    $('#dlgRemove').onclick = () => { removeBookmark((+$('#dlgPage').value) - 1); closeDialog(); };
    $('#dialog').addEventListener('click', (e) => { if (e.target.id === 'dialog') closeDialog(); });
    $('#zClose').onclick = zoomClose; $('#zIn').onclick = () => zoomBy(1.25); $('#zOut').onclick = () => zoomBy(1 / 1.25);
    $('#zFit').onclick = () => zoomTo(zScale === 1 ? (($('#zScroll').clientWidth - 40) / fitWidth()) : 1);
    $('#zPrev').onclick = () => zStep(-1); $('#zNext').onclick = () => zStep(1);
    const si = $('#searchInput'); let st = null, rt2 = null;
    si.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => renderSearch(si.value), 120); clearTimeout(rt2); rt2 = setTimeout(() => { if (lastHits.length) addRecent(si.value); }, 2000); });
    si.addEventListener('focus', () => { if (SESSION) renderSearch(si.value); });
    si.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!lastHits.length) return; e.preventDefault(); addRecent(si.value);
        const k = e.key === 'ArrowUp' ? (activeIdx - 1 + lastHits.length) % lastHits.length : (activeIdx + 1) % lastHits.length;
        setActive(k); go(lastHits[k].i, false);
        if (phone && e.key === 'Enter') { si.blur(); closeSheet('search'); }
      } else if (e.key === 'Escape') { if (phone) closeSheet('search'); else { si.value = ''; renderSearch(''); $('#searchResults').classList.add('hidden'); si.blur(); } }
    });
    document.addEventListener('click', (e) => { if (!phone && !e.target.closest('.search')) { const box = $('#searchResults'); if (box) box.classList.add('hidden'); } });
    document.addEventListener('keydown', (e) => {
      if (!SESSION || blockersOpen()) return;
      if (!$('#dialog').classList.contains('hidden')) { if (e.key === 'Escape') closeDialog(); return; }
      if (!$('#noteDialog').classList.contains('hidden')) { if (e.key === 'Escape') closeNoteDialog(); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (zoomOpen()) {
        if (e.key === 'Escape') zoomClose(); else if (e.key === '+' || e.key === '=') zoomBy(1.25); else if (e.key === '-') zoomBy(1 / 1.25);
        else if (e.key === 'ArrowRight') zStep(1); else if (e.key === 'ArrowLeft') zStep(-1);
        return;
      }
      if (e.key === 'Escape' && anySheetOpen()) { closeAll(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ': e.preventDefault(); next(); break;
        case 'ArrowLeft': case 'PageUp': e.preventDefault(); prev(); break;
        case 'Home': go(0, false); break;
        case 'End': go(N - 1, false); break;
        case '/': e.preventDefault(); openSheet('search'); break;
        case 'z': case 'Z': zoomOpenAt(visiblePages()[0]); break;
        case 't': case 'T': setSidebar($('#sidebar').classList.contains('hidden')); break;
        case 'f': case 'F': $('#btnFull').click(); break;
        case 'g': case 'G': e.preventDefault(); if (phone) openSheet('menu'); else { $('#pageInput').focus(); $('#pageInput').select(); } break;
        case 'b': case 'B': e.preventDefault(); toggleBookmark(); break;
        case 'm': case 'M': openSheet('bookmarks'); break;
        case 'c': case 'C': openSheet('contents'); break;
        case 'h': case 'H': openSheet('notes'); break;
        case 'a': case 'A': e.preventDefault(); setPageTurn(!curls(), true); break;
        case 'n': case 'N':
          if (window.Fairy) {
            if (!Fairy.supported) toast('A custom cursor needs a mouse or trackpad');
            else {
              Fairy.cycle();
              toast(Fairy.cursor === 'off' ? 'Normal cursor (N to change)' : Fairy.label + ' cursor (N to change)');
            }
            renderMenu();
          }
          break;
        default: break;
      }
    });
    document.addEventListener('fairychange', () => { if (SESSION) renderMenu(); });
  }

  function clamp01(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
  }
  function pageOfLayer(layer) {
    if (!layer) return -1;
    if (layer.id === 'zMarks') return zPage;
    const page = layer.closest('.page');
    return page ? +page.dataset.i : -1;
  }
  function normFromEvent(layer, event) {
    const rect = layer.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height))
    };
  }
  function markButton(mark) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.mark = mark.id;
    btn.className = mark.kind === 'note' ? 'mark-note' : 'mark-area';
    btn.style.left = (mark.x * 100) + '%';
    btn.style.top = (mark.y * 100) + '%';
    if (mark.kind === 'area') {
      btn.style.width = (mark.w * 100) + '%';
      btn.style.height = (mark.h * 100) + '%';
      btn.setAttribute('aria-label', `Highlight on page ${mark.page + 1}`);
    } else {
      btn.textContent = '✎';
      btn.setAttribute('aria-label', mark.text ? `Note: ${mark.text}` : 'Sticky note');
    }
    return btn;
  }
  function fillLayer(layer, page) {
    if (!layer) return;
    layer.replaceChildren();
    annotations.filter((mark) => mark.page === page).forEach((mark) => layer.appendChild(markButton(mark)));
  }
  function paintMarks() {
    $$('#book .page').forEach((page) => {
      let layer = page.querySelector('.marks');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'marks';
        page.appendChild(layer);
      }
      fillLayer(layer, +page.dataset.i);
    });
    paintZoomMarks();
  }
  function paintZoomMarks() {
    fillLayer($('#zMarks'), zPage);
  }
  function renderMarkMode() {
    $$('#markSeg button').forEach((b) => {
      const on = b.dataset.mode === annoMode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const hints = {
      read: 'Read mode turns pages as usual. Highlight drags a rectangle. Note places a sticky note. Both work on a scanned page.',
      area: 'Drag a rectangle on the page. Page turns are paused until you tap Done.',
      note: 'Tap the page where the note should sit. Page turns are paused until you tap Done.'
    };
    const hint = $('#markHint');
    if (hint) hint.textContent = hints[annoMode] || hints.read;
    const banner = $('#annoBanner');
    const text = $('#annoBannerText');
    if (banner) banner.classList.toggle('hidden', annoMode === 'read');
    if (text) text.textContent = annoMode === 'area' ? 'Drag to highlight. Tap a highlight to remove it.' : 'Tap the page to add a note. Tap a note to edit it.';
    document.body.classList.toggle('annotating', annoMode !== 'read');
  }
  function setAnnoMode(mode) {
    annoMode = mode === 'area' || mode === 'note' ? mode : 'read';
    if (flip) {
      const settings = flip.getSettings();
      settings.useMouseEvents = curls() && annoMode === 'read' && !coarse();
      settings.showPageCorners = curls() && annoMode === 'read' && !phone && !coarse();
      settings.drawShadow = curls();
    }
    renderMarkMode();
    if (annoMode !== 'read') closeSheet('notes');
  }
  function renderToc(nodes) {
    const ul = document.createElement('ul');
    ul.className = 'toc';
    nodes.forEach((node) => {
      const li = document.createElement('li');
      if (node.page == null) {
        const heading = document.createElement('div');
        heading.className = 'toc-heading';
        heading.textContent = node.title;
        li.appendChild(heading);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item';
        btn.innerHTML = `<span class="toc-label"></span><small></small>`;
        btn.querySelector('.toc-label').textContent = node.title;
        btn.querySelector('small').textContent = String(node.page + 1);
        btn.onclick = () => { go(node.page, false); if (phone) closeSheet('contents'); };
        li.appendChild(btn);
      }
      if (node.items && node.items.length) li.appendChild(renderToc(node.items));
      ul.appendChild(li);
    });
    return ul;
  }
  function renderContents() {
    const list = $('#outlineList');
    const empty = $('#outlineEmpty');
    if (!list) return;
    list.replaceChildren();
    const hasOutline = outline && outline.length;
    if (empty) empty.classList.toggle('hidden', !!hasOutline);
    if (hasOutline) list.appendChild(renderToc(outline));
    const save = $('#chapterSave');
    const cancel = $('#chapterCancel');
    const title = $('#chapterTitle');
    const page = $('#chapterPage');
    const editing = chapters.find((ch) => ch.id === chapterEdit);
    if (save) save.textContent = editing ? 'Save' : 'Add';
    if (cancel) cancel.classList.toggle('hidden', !editing);
    if (title && document.activeElement !== title) title.value = editing ? editing.title : '';
    if (page) {
      page.max = N || 1;
      if (document.activeElement !== page) page.value = editing ? String(editing.page + 1) : '';
    }
    const box = $('#chapterList');
    if (!box) return;
    box.replaceChildren();
    if (!chapters.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'No chapters added on this device.';
      box.appendChild(p);
      return;
    }
    chapters.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'chapter-row';
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'jump';
      jump.innerHTML = '<span class="toc-label"></span><small></small>';
      jump.querySelector('.toc-label').textContent = ch.title;
      jump.querySelector('small').textContent = 'p. ' + (ch.page + 1);
      jump.onclick = () => { go(ch.page, false); if (phone) closeSheet('contents'); };
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini';
      edit.textContent = 'Edit';
      edit.onclick = () => { chapterEdit = ch.id; renderContents(); $('#chapterTitle').focus(); };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini danger';
      remove.textContent = 'Remove';
      remove.onclick = () => deleteChapter(ch.id);
      row.append(jump, edit, remove);
      box.appendChild(row);
    });
  }
  async function saveChapter() {
    if (!bookId) return;
    const title = ($('#chapterTitle').value || '').replace(/\s+/g, ' ').trim();
    const page = (+$('#chapterPage').value || 0) - 1;
    if (!title) { toast('Give the chapter a title.'); return; }
    if (page < 0 || page >= N) { toast('That page is not in this book.'); return; }
    const existing = chapters.find((ch) => ch.id === chapterEdit);
    try {
      const saved = await BookDB.putChapter({
        id: existing && existing.id, bookId, title, page, created: existing && existing.created
      });
      if (existing) Object.assign(existing, saved);
      else chapters.push(saved);
      chapters.sort((a, b) => a.page - b.page || a.created - b.created);
      chapterEdit = '';
      renderContents();
      toast(existing ? 'Chapter updated.' : 'Chapter added on this device.');
    } catch (err) {
      toast((err && err.message) || 'Could not save that chapter.');
    }
  }
  async function deleteChapter(id) {
    try { await BookDB.deleteChapter(id); } catch (e) {}
    chapters = chapters.filter((ch) => ch.id !== id);
    if (chapterEdit === id) chapterEdit = '';
    renderContents();
    toast('Chapter removed.');
  }
  function renderNotes() {
    renderMarkMode();
    const box = $('#noteList');
    if (!box) return;
    box.replaceChildren();
    if (!annotations.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No highlights or notes yet.';
      box.appendChild(p);
      return;
    }
    annotations.forEach((mark) => {
      const row = document.createElement('div');
      row.className = 'note-row';
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'jump';
      const kind = document.createElement('div');
      kind.className = 'kind';
      kind.textContent = mark.kind === 'note' ? 'Note' : 'Highlight';
      const label = document.createElement('div');
      label.className = 'toc-label';
      label.textContent = mark.kind === 'note' ? (mark.text || 'Empty note') : 'Rectangle on the page';
      const where = document.createElement('small');
      where.textContent = 'p. ' + (mark.page + 1);
      jump.append(kind, label, where);
      jump.onclick = () => { go(mark.page, false); if (phone) closeSheet('notes'); };
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini';
      edit.textContent = 'Edit';
      edit.onclick = () => openMark(mark.id);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini danger';
      remove.textContent = 'Remove';
      remove.onclick = () => removeAnnotation(mark.id);
      row.append(jump, edit, remove);
      box.appendChild(row);
    });
  }
  function showNoteDialog(mark) {
    noteEdit = mark;
    $('#noteDlgTitle').textContent = mark.kind === 'note' ? 'Sticky note' : 'Highlight';
    $('#noteDlgMeta').textContent = `Page ${mark.page + 1}. Saved only in this browser.`;
    $('#noteTextLabel').classList.toggle('hidden', mark.kind !== 'note');
    $('#noteText').value = mark.text || '';
    $('#noteSave').classList.toggle('hidden', mark.kind !== 'note');
    $('#noteDialog').classList.remove('hidden');
    if (mark.kind === 'note') $('#noteText').focus();
  }
  function openMark(id) {
    const mark = annotations.find((item) => item.id === id);
    if (mark) showNoteDialog(mark);
  }
  function closeNoteDialog() {
    noteEdit = null;
    const dialog = $('#noteDialog');
    if (dialog) dialog.classList.add('hidden');
  }
  async function saveNoteDialog() {
    if (!noteEdit || noteEdit.kind !== 'note') { closeNoteDialog(); return; }
    const text = ($('#noteText').value || '').trim();
    if (!text) { toast('Write a note, or remove it.'); return; }
    try {
      const saved = await BookDB.putAnnotation({ ...noteEdit, bookId, kind: 'note', text });
      const index = annotations.findIndex((item) => item.id === saved.id);
      if (index >= 0) annotations[index] = saved;
      else annotations.push(saved);
      annotations.sort((a, b) => a.page - b.page || a.y - b.y || a.created - b.created);
      paintMarks();
      renderNotes();
      closeNoteDialog();
    } catch (err) {
      toast((err && err.message) || 'Could not save that note.');
    }
  }
  async function removeAnnotation(id) {
    try { await BookDB.deleteAnnotation(id); } catch (e) {}
    annotations = annotations.filter((item) => item.id !== id);
    paintMarks();
    renderNotes();
    toast('Removed.');
  }
  async function addAnnotation(partial) {
    const saved = await BookDB.putAnnotation({ ...partial, bookId });
    annotations.push(saved);
    annotations.sort((a, b) => a.page - b.page || a.y - b.y || a.created - b.created);
    paintMarks();
    renderNotes();
    return saved;
  }
  function onMarkPointerDown(event) {
    if (annoMode === 'read' || !SESSION) return;
    const layer = event.target.closest && event.target.closest('.marks');
    if (!layer) return;
    const page = pageOfLayer(layer);
    if (page < 0 || page >= N) return;
    event.preventDefault();
    event.stopPropagation();
    const existing = event.target.closest('[data-mark]');
    if (existing) { openMark(existing.dataset.mark); return; }
    const start = normFromEvent(layer, event);
    markDrag = { layer, page, pointer: event.pointerId, start, x: start.x, y: start.y, moved: false };
    try { layer.setPointerCapture(event.pointerId); } catch (e) {}
  }
  function onMarkPointerMove(event) {
    if (!markDrag || event.pointerId !== markDrag.pointer) return;
    const point = normFromEvent(markDrag.layer, event);
    if (Math.hypot(point.x - markDrag.start.x, point.y - markDrag.start.y) > 0.01) markDrag.moved = true;
    markDrag.x = point.x;
    markDrag.y = point.y;
    if (annoMode !== 'area') return;
    let draft = markDrag.layer.querySelector('.mark-draft');
    if (!draft) {
      draft = document.createElement('div');
      draft.className = 'mark-draft';
      markDrag.layer.appendChild(draft);
    }
    const x = Math.min(markDrag.start.x, point.x);
    const y = Math.min(markDrag.start.y, point.y);
    draft.style.left = (x * 100) + '%';
    draft.style.top = (y * 100) + '%';
    draft.style.width = (Math.abs(point.x - markDrag.start.x) * 100) + '%';
    draft.style.height = (Math.abs(point.y - markDrag.start.y) * 100) + '%';
  }
  async function onMarkPointerUp(event) {
    if (!markDrag || event.pointerId !== markDrag.pointer) return;
    const drag = markDrag;
    markDrag = null;
    const draft = drag.layer.querySelector('.mark-draft');
    if (draft) draft.remove();
    const point = normFromEvent(drag.layer, event);
    try {
      if (annoMode === 'area' && drag.moved) {
        const x = Math.min(drag.start.x, point.x);
        const y = Math.min(drag.start.y, point.y);
        const w = Math.abs(point.x - drag.start.x);
        const h = Math.abs(point.y - drag.start.y);
        if (w >= 0.02 && h >= 0.02) await addAnnotation({ page: drag.page, kind: 'area', x, y, w, h, text: '' });
      } else if (annoMode === 'note' && !drag.moved) {
        showNoteDialog({ page: drag.page, kind: 'note', x: point.x, y: point.y, text: '' });
      }
    } catch (err) {
      toast((err && err.message) || 'Could not save that mark.');
    }
  }
  document.addEventListener('pointerdown', onMarkPointerDown, true);
  document.addEventListener('pointermove', onMarkPointerMove, true);
  document.addEventListener('pointerup', onMarkPointerUp, true);
  document.addEventListener('pointercancel', (event) => {
    if (!markDrag || event.pointerId !== markDrag.pointer) return;
    const draft = markDrag.layer.querySelector('.mark-draft');
    if (draft) draft.remove();
    markDrag = null;
  }, true);

  function publishDebug() {
    window.__flipbook = {
      get current() { return current; },
      get mode() { return mode; },
      get phone() { return phone; },
      get bookmarks() { return bookmarks.map((b) => ({ ...b })); },
      get pageCount() { return N; },
      get visible() { return visiblePages(); },
      get annoMode() { return annoMode; },
      get title() { return SESSION ? SESSION.title : ''; },
      get animate() { return curls(); },
      go, next, prev, setPageTurn
    };
  }

  async function open(session) {
    close();
    SESSION = session;
    epoch++;
    RATIO = session.ratio > 0.2 && session.ratio < 5 ? session.ratio : 1.35;
    document.documentElement.style.setProperty('--page-aspect', String(1 / RATIO));
    applyTexts(session.texts || []);
    Object.assign(state, {
      page: session.state && session.state.page || 0,
      layout: (session.state && session.state.layout) || 'auto',
      zoom: (session.state && session.state.zoom) || 1,
      sidebar: !!(session.state && session.state.sidebar)
    });
    bookmarks = (session.bookmarks || []).map((b) => ({ ...b }));
    recent = (session.recent || []).slice();
    bookId = session.bookId || '';
    outline = Array.isArray(session.outline) ? session.outline : [];
    chapters = Array.isArray(session.chapters) ? session.chapters.map((ch) => ({ ...ch })) : [];
    chapterEdit = '';
    annoMode = 'read';
    try { annotations = bookId ? await BookDB.listAnnotations(bookId) : []; }
    catch (e) { annotations = []; }
    zScale = state.zoom || 1;
    setTitle(session.title);
    $$('.pageCount').forEach((el) => { el.textContent = N; });
    const input = $('#pageInput');
    if (input) { input.max = N; input.value = 1; }
    detectDevice();
    wire();
    $('#thumbs').innerHTML = '';
    $('#searchInput').value = '';
    $('#searchResults').classList.add('hidden');
    $('#searchResults').innerHTML = '';
    buildThumbs();
    let start = Math.max(0, Math.min(N - 1, state.page || 0));
    let resumed = false;
    if (session.explicitPage != null && !Number.isNaN(session.explicitPage)) start = Math.max(0, Math.min(N - 1, session.explicitPage));
    else if (start > 0) resumed = true;
    if (state.sidebar && !phone) { $('#sidebar').classList.remove('hidden'); document.body.classList.add('sb'); }
    else { $('#sidebar').classList.add('hidden'); document.body.classList.remove('sb'); }
    build(start);
    renderMarkMode();
    await ensureLoaded(start);
    updateBmToggle();
    renderMenu();
    publishDebug();
    if (resumed) toast(`Resumed at page ${start + 1}`, 'Start over', () => go(0, false), 5000);
  }

  function close() {
    epoch++;
    if (flip) { try { flip.destroy(); } catch (e) {} flip = null; }
    const wrap = $('#bookWrap');
    if (wrap) wrap.innerHTML = '<div id="book"></div>';
    const thumbs = $('#thumbs');
    if (thumbs) thumbs.innerHTML = '';
    imgs = [];
    SESSION = null;
    current = 0;
    N = 0;
    DATA = { pages: [] };
    const zoom = $('#zoom');
    if (zoom) zoom.classList.add('hidden');
    const dialog = $('#dialog');
    if (dialog) dialog.classList.add('hidden');
    PANEL_SHEETS.forEach((name) => { const el = $(SHEETS[name]); if (el) el.classList.add('hidden'); });
    bookId = '';
    outline = [];
    chapters = [];
    annotations = [];
    annoMode = 'read';
    chapterEdit = '';
    const banner = $('#annoBanner');
    if (banner) banner.classList.add('hidden');
    document.body.classList.remove('annotating');
    const noteBox = $('#noteDialog');
    if (noteBox) noteBox.classList.add('hidden');
  }

  function setTexts(texts) {
    if (!SESSION) return;
    const page = current;
    applyTexts(texts);
    if ($('#searchInput').value.trim().length >= 2) renderSearch($('#searchInput').value);
    publishDebug();
    current = page;
  }

  function setFlags(flags) {
    if (!SESSION) return;
    Object.assign(SESSION, flags);
    renderMenu();
  }

  window.Reader = { open, close, setTexts, setFlags, toast, isOpen: () => !!SESSION };
})();
