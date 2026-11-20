/**
 * Headless checks: import, search, bookmarks across reload, offline reload, mobile layout.
 * Uses the system Chrome. Serves docs/ itself so paths match GitHub Pages.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const shots = process.env.SHOTS || '/opt/cursor/artifacts';
fs.mkdirSync(shots, { recursive: true });

const samples = spawnSync('python3', [path.join(root, 'tools', 'make_samples.py')], { encoding: 'utf8' });
if (samples.status !== 0) {
  console.error(samples.stdout, samples.stderr);
  process.exit(1);
}
const [textPdf, imagePdf] = samples.stdout.trim().split('\n').filter(Boolean);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(docs, rel));
  if (!file.startsWith(docs)) {
    res.writeHead(403); res.end('no'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('missing ' + rel); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}/`;
console.log('serving', origin);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text());
});
page.on('requestfailed', (req) => console.log('REQUESTFAIL', req.url(), req.failure() && req.failure().errorText));

const fail = async (message) => {
  const dest = path.join(shots, 'failure.png');
  try { await page.screenshot({ path: dest, fullPage: true }); } catch (e) {}
  console.error('FAIL', message);
  console.error('screenshot', dest);
  await browser.close();
  server.close();
  process.exit(1);
};

const shot = async (name) => {
  const dest = path.join(shots, name);
  await page.screenshot({ path: dest });
  console.log('shot', dest);
};

try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dropzone');
  await page.waitForFunction(() => window.__storagePersistResult, null, { timeout: 10000 });
  const persist = await page.evaluate(() => window.__storagePersistResult);
  console.log('persist', persist);
  if (!persist || persist === 'error' || persist === 'unsupported') await fail('persist() was not called: ' + persist);
  await shot('library_empty.png');
  const progressHidden = await page.evaluate(() => document.querySelector('#progress').classList.contains('hidden'));
  if (!progressHidden) await fail('progress bar showed before a book was open');

  const dropped = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'harbor-notes.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    const saw = !!(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length);
    document.dispatchEvent(event);
    return { saw, files: event.dataTransfer ? event.dataTransfer.files.length : -1 };
  }, fs.readFileSync(textPdf).toString('base64'));
  console.log('drop event', dropped);
  if (!dropped.saw) await fail('synthetic drop did not carry the file');

  await page.waitForSelector('body.reading', { timeout: 60000 });
  await page.waitForFunction(() => window.__flipbook && window.__flipbook.pageCount === 6, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('#book .page img');
    return img && img.naturalWidth > 0;
  }, null, { timeout: 20000 });
  const mode = await page.evaluate(() => window.__flipbook.mode);
  console.log('mode', mode);
  if (mode !== 'landscape') await fail('expected a two-page spread on desktop, got ' + mode);
  await page.evaluate(() => window.__flipbook.go(1, false));
  await page.waitForFunction(() => window.__flipbook.current === 1);
  await page.waitForTimeout(400);
  await shot('reader_spread.png');

  await page.hover('#btnSidebar');
  await page.waitForFunction(() => {
    const toast = document.querySelector('#toast');
    const msg = document.querySelector('#toast .msg');
    return toast && !toast.classList.contains('hidden') && msg && msg.textContent === 'Press T';
  }, null, { timeout: 4000 });
  await page.mouse.move(8, 8);
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('hidden'), null, { timeout: 4000 });
  await page.evaluate(() => window.FlipbookToast('Pages turn instantly'));
  await page.hover('#btnNext');
  await page.waitForTimeout(700);
  const keptToast = await page.locator('#toast .msg').innerText();
  if (keptToast !== 'Pages turn instantly') await fail('shortcut note replaced a status message: ' + keptToast);
  await page.mouse.move(8, 8);
  await page.evaluate(() => document.querySelector('#toast').classList.add('hidden'));

  await page.click('[data-open="menu"]');
  await page.hover('#animSeg');
  await page.waitForFunction(() => {
    const msg = document.querySelector('#toast .msg');
    return msg && msg.textContent === 'Press A';
  }, null, { timeout: 4000 });
  await page.click('#animSeg [data-anim="off"]');
  const jumped = await page.evaluate(() => {
    const from = window.__flipbook.current;
    window.__flipbook.next();
    return { from, to: window.__flipbook.current, saved: localStorage.getItem('flipbook.animate') };
  });
  if (!(jumped.to > jumped.from)) await fail('turning animation off did not jump to the next page');
  if (jumped.saved !== '0') await fail('instant page turns were not saved');
  await page.click('#animSeg [data-anim="on"]');
  await page.click('[data-close="menu"]');
  await page.evaluate(() => window.__flipbook.go(1, false));
  await page.waitForFunction(() => window.__flipbook.current === 1);

  const progressAt = await page.evaluate(() => {
    const bar = document.querySelector('#progress');
    const fill = document.querySelector('.progress-fill');
    return {
      hidden: bar.classList.contains('hidden'),
      now: bar.getAttribute('aria-valuenow'),
      max: bar.getAttribute('aria-valuemax'),
      width: fill.style.width
    };
  });
  if (progressAt.hidden || progressAt.now !== '2' || progressAt.max !== '6' || progressAt.width !== '20%') {
    await fail('progress bar did not match page 2 of 6: ' + JSON.stringify(progressAt));
  }
  await page.click('[data-open="contents"]');
  await page.fill('#chapterTitle', 'The lamp');
  await page.fill('#chapterPage', '4');
  await page.click('#chapterSave');
  await page.waitForFunction(() => {
    const tick = document.querySelector('.progress-tick');
    return tick && tick.dataset.title === 'The lamp' && tick.dataset.page === '3';
  }, null, { timeout: 10000 });
  const tickBox = await page.locator('.progress-tick').boundingBox();
  const progressBox = await page.locator('#progress').boundingBox();
  await page.mouse.move(tickBox.x + tickBox.width / 2, progressBox.y + progressBox.height / 2);
  await page.waitForFunction(() => {
    const tip = document.querySelector('#progressTip');
    return tip && !tip.classList.contains('hidden') && tip.textContent === 'The lamp · 4';
  }, null, { timeout: 4000 });
  await page.click('#chapterList .done-toggle');
  await page.waitForFunction(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    const book = await BookDB.getBook(id);
    const row = document.querySelector('#chapterList .chapter-row');
    const tick = document.querySelector('.progress-tick');
    const box = document.querySelector('#chapterList .done-toggle');
    return book && Array.isArray(book.doneChapters) && book.doneChapters.length === 1
      && row && row.classList.contains('done')
      && tick && tick.classList.contains('done')
      && box && box.getAttribute('aria-pressed') === 'true'
      && window.__flipbook.current === 1;
  }, null, { timeout: 10000 });
  await page.evaluate(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    await BookDB.putOutline(id, [
      { title: 'Part', page: null, items: [{ title: 'Forest', page: 1, items: [] }] }
    ]);
  });
  await page.click('[data-close="contents"]');
  const track = await page.locator('#progressTrack').boundingBox();
  await page.mouse.click(track.x + track.width - 1, track.y + track.height / 2);
  await page.waitForFunction(() => window.__flipbook.current === 5);
  await page.evaluate(() => window.__flipbook.go(1, false));
  await page.waitForFunction(() => window.__flipbook.current === 1);

  await page.fill('#searchInput', 'marigold');
  await page.waitForSelector('.result', { timeout: 10000 });
  const searchText = await page.locator('#searchResults').innerText();
  console.log('search', searchText.replace(/\s+/g, ' ').slice(0, 240));
  if (!/marigold/i.test(searchText)) await fail('search did not find marigold');
  if (!/Page 2/.test(searchText)) await fail('search snippet missed page 2');
  await page.waitForFunction(() => document.querySelectorAll('#book .search-glow').length >= 2, null, { timeout: 10000 });
  const glows = await page.evaluate(() => [...document.querySelectorAll('#book .search-glow')].map((node) => {
    const page = node.closest('.page');
    return {
      page: page ? +page.dataset.i : -1,
      x: parseFloat(node.style.left),
      y: parseFloat(node.style.top),
      w: parseFloat(node.style.width),
      h: parseFloat(node.style.height)
    };
  }));
  console.log('search glows', JSON.stringify(glows));
  const onPage = glows.find((glow) => glow.page === 1);
  if (!onPage) await fail('marigold did not glow on page 2');
  if (!(onPage.y > 5 && onPage.y < 45 && onPage.w > 2 && onPage.w < 40)) {
    await fail('marigold glow is not on the word: ' + JSON.stringify(onPage));
  }
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => {
    const glows = [...document.querySelectorAll('#book .page[data-i="1"] .search-glow')];
    return glows.length === 2 && glows[0].classList.contains('current') && !glows[1].classList.contains('current') && window.__flipbook.current === 1;
  });
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => {
    const glows = [...document.querySelectorAll('#book .page[data-i="1"] .search-glow')];
    return glows[1] && glows[1].classList.contains('current') && !glows[0].classList.contains('current') && window.__flipbook.current === 1;
  });
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => {
    const glow = document.querySelector('#book .search-glow.current');
    return glow && +glow.closest('.page').dataset.i === 5 && window.__flipbook.current === 5;
  });
  await shot('search_results.png');
  await page.locator('.result').first().click();
  await page.waitForFunction(() => window.__flipbook.current === 1);

  await page.fill('#pageInput', '4');
  await page.press('#pageInput', 'Enter');
  await page.waitForFunction(() => window.__flipbook.current === 3);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('b');
  await page.waitForSelector('#dialog:not(.hidden)');
  await page.fill('#dlgLabel', 'Copper bell');
  await page.click('#dlgForm button[type="submit"]');
  await page.waitForFunction(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    const book = await BookDB.getBook(id);
    return book && book.lastPage === 3 && (book.bookmarks || []).some((mark) => mark.label === 'Copper bell');
  }, null, { timeout: 10000 });
  await page.click('[data-open="bookmarks"]');
  await page.waitForSelector('.bmitem');
  const marks = await page.locator('#bmList').innerText();
  if (!marks.includes('Copper bell')) await fail('bookmark label missing before reload');
  await shot('bookmarks.png');

  await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' });
    await BookDB.putPage({ bookId: 'orphan-left-behind', index: 0, image: blob, thumb: blob });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.reading', { timeout: 20000 });
  await page.waitForFunction(() => {
    const msg = document.querySelector('#toast .msg');
    return msg && /Resumed at page 4/.test(msg.textContent || '');
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => window.__flipbook && window.__flipbook.current === 3);
  const marksAfter = await page.evaluate(() => window.__flipbook.bookmarks.map((mark) => mark.label));
  console.log('bookmarks after reload', marksAfter);
  if (!marksAfter.includes('Copper bell')) await fail('bookmark did not survive reload');
  await page.click('[data-open="contents"]');
  await page.waitForFunction(() => {
    const row = document.querySelector('#chapterList .chapter-row.done');
    const box = document.querySelector('#chapterList .done-toggle');
    const tick = document.querySelector('.progress-tick.done');
    const heading = document.querySelector('#outlineList .toc-heading');
    const toggles = document.querySelectorAll('#outlineList .done-toggle');
    return row && box && box.getAttribute('aria-pressed') === 'true' && tick
      && heading && heading.textContent === 'Part'
      && toggles.length === 1 && toggles[0].getAttribute('aria-pressed') === 'false';
  }, null, { timeout: 10000 });
  await page.click('#outlineList .done-toggle');
  await page.waitForFunction(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    const book = await BookDB.getBook(id);
    const keys = book && book.doneChapters || [];
    const forestRow = document.querySelector('#outlineList .toc-row');
    const forestTick = [...document.querySelectorAll('.progress-tick')].find((tick) => tick.dataset.title === 'Forest');
    return keys.length === 2 && keys.indexOf('o:1:Forest') !== -1
      && forestRow && forestRow.classList.contains('done')
      && forestTick && forestTick.classList.contains('done') && forestTick.dataset.page === '1'
      && window.__flipbook.current === 3;
  }, null, { timeout: 10000 });
  await page.click('#outlineList .done-toggle');
  await page.click('#chapterList .done-toggle');
  await page.waitForFunction(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    const book = await BookDB.getBook(id);
    return book && (!book.doneChapters || book.doneChapters.length === 0)
      && !document.querySelector('#chapterList .chapter-row.done')
      && !document.querySelector('#outlineList .toc-row.done');
  }, null, { timeout: 10000 });
  await page.click('#chapterList .mini.danger');
  await page.waitForFunction(() => !document.querySelector('.progress-tick[data-title="The lamp"]'));
  await page.click('[data-close="contents"]');
  await page.evaluate(() => BookDB.vacuum());
  await page.waitForFunction(async () => {
    const row = await BookDB.getPage('orphan-left-behind', 0);
    return !row;
  }, null, { timeout: 10000 });
  await page.evaluate(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    const blob = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' });
    await BookDB.putPage({ bookId: id, index: 99, image: blob, thumb: blob });
    await BookDB.putPage({ bookId: 'other-book', index: 0, image: blob, thumb: blob });
    await BookDB.deleteBook('other-book');
    const kept = await BookDB.getPage(id, 99);
    const gone = await BookDB.getPage('other-book', 0);
    if (!kept || !kept.image || gone) throw new Error('deleteBook removed the wrong pages');
  });
  await shot('resumed.png');

  await page.click('#btnLibrary');
  await page.waitForSelector('.bookcard h3');
  await page.click('.bookcard button:nth-of-type(2)');
  await page.fill('.nameedit', 'Port Notes');
  await page.press('.nameedit', 'Enter');
  await page.waitForFunction(() => document.querySelector('.bookcard h3') && document.querySelector('.bookcard h3').textContent === 'Port Notes');
  await shot('library_with_book.png');

  await page.setInputFiles('#fileInput', imagePdf);
  await page.waitForSelector('#ocrOffer:not(.hidden)', { timeout: 60000 });
  await shot('ocr_offer.png');
  await page.click('#ocrRun');
  await page.waitForSelector('body.reading', { timeout: 180000 });
  await page.waitForFunction(() => window.__flipbook && window.__flipbook.pageCount === 3, null, { timeout: 20000 });
  const ocrText = await page.evaluate(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('b');
    return (await BookDB.getTexts(id)).join('\n');
  });
  console.log('ocr text', ocrText.replace(/\s+/g, ' ').slice(0, 400));
  if (!/cobalt|lantern/i.test(ocrText)) await fail('OCR did not read the scanned page');
  await page.fill('#searchInput', 'lantern');
  await page.waitForSelector('.result', { timeout: 10000 });
  const ocrSearch = await page.locator('#searchResults').innerText();
  if (!/lantern/i.test(ocrSearch)) await fail('search missed OCR text');
  await shot('ocr_search.png');

  await page.click('#btnLibrary');
  await page.waitForSelector('.bookcard');
  page.once('dialog', (dialog) => dialog.accept());
  const cards = page.locator('.bookcard');
  const count = await cards.count();
  let deleted = false;
  for (let i = 0; i < count; i++) {
    const title = await cards.nth(i).locator('h3').innerText();
    if (/lantern|cobalt|scan/i.test(title) || title === '' || /untitled/i.test(title) || title.toLowerCase().includes('lantern-scan') || title === 'lantern-scan') {
      await cards.nth(i).locator('button', { hasText: 'Delete' }).click();
      deleted = true;
      break;
    }
  }
  if (!deleted) {
    const titles = await page.locator('.bookcard h3').allInnerTexts();
    console.log('titles', titles);
    // The image PDF has an empty title, so the card uses the file name.
    const scan = page.locator('.bookcard', { hasText: 'lantern-scan' });
    if (await scan.count()) {
      page.once('dialog', (dialog) => dialog.accept());
      await scan.locator('button', { hasText: 'Delete' }).click();
      deleted = true;
    } else await fail('could not find the scanned book to delete: ' + titles.join(' | '));
  }
  await page.waitForFunction(() => document.querySelectorAll('.bookcard').length === 1);

  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 90000 });
  console.log('service worker is controlling the page');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dropzone', { timeout: 15000 });
  const offlineTitle = await page.locator('.bookcard h3').innerText();
  console.log('offline library', offlineTitle);
  if (offlineTitle !== 'Port Notes') await fail('offline library lost the book: ' + offlineTitle);
  await page.click('.bookcard');
  await page.waitForSelector('body.reading', { timeout: 15000 });
  await page.waitForFunction(() => window.__flipbook && window.__flipbook.pageCount === 6 && window.__flipbook.current === 3);
  await page.fill('#searchInput', 'compass');
  await page.waitForSelector('.result', { timeout: 10000 });
  await shot('offline_reload.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.body.classList.contains('phone'));
  const bars = await page.evaluate(() => ({
    top: getComputedStyle(document.querySelector('.topbar')).display,
    bottom: getComputedStyle(document.querySelector('.bottombar')).display,
    phonebar: getComputedStyle(document.querySelector('.phonebar')).display,
    mode: window.__flipbook.mode
  }));
  console.log('mobile', bars);
  if (bars.top !== 'none' || bars.bottom === 'none' || bars.phonebar === 'none') await fail('mobile chrome is wrong ' + JSON.stringify(bars));
  if (bars.mode !== 'portrait') await fail('phone should be one page, got ' + bars.mode);
  await page.waitForTimeout(300);
  await shot('mobile_reader.png');

  await page.click('#btnLibraryPhone');
  await page.waitForSelector('#library .bookcard');
  await shot('mobile_library.png');

  console.log('ALL CHECKS PASSED');
} catch (err) {
  console.error(err);
  await fail(err.message || String(err));
}

await browser.close();
server.close();
