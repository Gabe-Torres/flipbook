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

  await page.click('[data-open="menu"]');
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

  await page.fill('#searchInput', 'marigold');
  await page.waitForSelector('.result', { timeout: 10000 });
  const searchText = await page.locator('#searchResults').innerText();
  console.log('search', searchText.replace(/\s+/g, ' ').slice(0, 240));
  if (!/marigold/i.test(searchText)) await fail('search did not find marigold');
  if (!/Page 2/.test(searchText)) await fail('search snippet missed page 2');
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
  await page.waitForFunction(async () => {
    const row = await BookDB.getPage('orphan-left-behind', 0);
    return !row;
  }, null, { timeout: 10000 });
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
