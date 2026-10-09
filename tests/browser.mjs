import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { build } from '../scripts/build.mjs';
import { createServer } from '../scripts/serve.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(projectRoot, '.qa'), { recursive: true });
const root = await mkdtemp(path.join(projectRoot, '.qa', 'browser-'));
await cp(path.join(projectRoot, 'assets'), path.join(root, 'assets'), { recursive: true });
await cp(path.join(projectRoot, 'index.html'), path.join(root, 'index.html'));
await cp(path.join(projectRoot, 'site.config.json'), path.join(root, 'site.config.json'));
await mkdir(path.join(root, 'presentations', 'Week 02'), { recursive: true });

async function makePdf(title, { rotated = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 3; i++) {
    const slide = pdf.addPage([960, 540]);
    slide.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(.96, .97, .99) });
    slide.drawRectangle({ x: 0, y: 0, width: 14, height: 540, color: rgb(.2, .4, .86) });
    slide.drawText('PROF. ASGARI / COURSE MATERIAL', { x: 70, y: 450, size: 14, font: bold, color: rgb(.2, .4, .86) });
    slide.drawText(i === 0 ? title : i === 1 ? 'Questions worth asking' : 'A different perspective', { x: 70, y: 340, size: 42, font: bold, color: rgb(.09, .14, .23) });
    slide.drawText(i === 0 ? 'An introduction to the ideas behind the subject.' : 'Read, annotate, and revisit the important ideas.', { x: 70, y: 270, size: 19, font, color: rgb(.38, .44, .53) });
    slide.drawText(`LECTURE NOTES                                  ${String(i + 1).padStart(2, '0')} / 03`, { x: 70, y: 65, size: 12, font, color: rgb(.38, .44, .53) });
    if (rotated && i === 2) { slide.setCropBox(30, 20, 880, 480); slide.setRotation(degrees(90)); }
  }
  return pdf.save();
}

await writeFile(path.join(root, 'presentations', 'Learning from data.pdf'), await makePdf('Learning from data', { rotated: true }));
await writeFile(path.join(root, 'presentations', 'Week 02', 'Linear algebra #1.PDF'), await makePdf('Linear algebra essentials'));
await writeFile(path.join(root, 'presentations', 'Week 02', 'نظریه یادگیری.pdf'), await makePdf('Learning theory'));
await build({ root });
const server = createServer(path.join(root, 'dist'), { prefix: '/course-library' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/course-library/`;
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
if (process.env.PDF_TEST_NODE_FETCH === '1') {
  // Some local download-manager integrations replace browser PDF responses with
  // HTTP 204. Fetch the actual local server response through Node for UI testing.
  await context.route(/\/presentations\/.+\.pdf(?:\?.*)?$/i, async route => {
    const headers = {};
    const range = route.request().headers().range;
    if (range) headers.Range = range;
    const response = await fetch(route.request().url(), { headers });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  console.log('PDF requests use real local-server responses fetched through Node.');
}
const page = await context.newPage();
const errors = [];
const diagnostics = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { diagnostics.push(message.text()); if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
page.on('response', response => { if (/\.pdf/i.test(response.url())) diagnostics.push(`Browser PDF response ${response.status()}: ${response.url()} ${JSON.stringify(response.headers())}`); });

async function waitForSlide(number) {
  await page.locator('#page-number').waitFor();
  await page.waitForFunction(number => !document.getElementById('page-frame').hidden && document.getElementById('page-number').value === String(number), number);
}
async function draw(tool, from = [.15, .4], to = [.7, .5]) {
  await page.locator(`button[data-tool="${tool}"]`).click();
  const bounds = await page.locator('#annotation-canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * from[0], bounds.y + bounds.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * to[0], bounds.y + bounds.height * to[1], { steps: 12 });
  await page.mouse.up();
}
async function notebook() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('presentation-shelf:v1:'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
}

try {
  await page.goto(url);
  const pdfCheck = await fetch(`${url}presentations/Learning%20from%20data.pdf`);
  assert.equal(pdfCheck.status, 200);
  assert.ok((await pdfCheck.arrayBuffer()).byteLength > 1000);
  await page.locator('.presentation-card').first().waitFor();
  assert.equal(await page.locator('.presentation-card').count(), 3);
  await page.locator('.card-preview img').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(root, 'library-desktop.png'), fullPage: true });
  await page.locator('#search').fill('linear');
  assert.equal(await page.locator('.presentation-card').count(), 1);
  await page.locator('#search').fill('nothing matches');
  assert.equal(await page.locator('#empty-title').textContent(), 'No presentations found.');
  await page.locator('#clear-search').click();
  await page.locator('[data-folder="Week 02"]').click();
  assert.equal(await page.locator('.presentation-card').count(), 2);
  await page.locator('.card-link').filter({ hasText: 'Linear algebra #1' }).click();
  await waitForSlide(1);
  assert.match(page.url(), /course-library\/#presentation=/);
  await page.locator('#back-library').click();
  await page.locator('[data-folder=""]').click();
  await page.locator('.card-link').filter({ hasText: 'Learning from data' }).click();
  await waitForSlide(1);
  await page.locator('#slide-notes').fill('Remember this idea. فارسی');
  await draw('pen');
  await draw('highlight', [.18, .6], [.65, .7]);
  assert.equal((await notebook()).pages[1].strokes.length, 2);
  await page.locator('#undo').click();
  assert.equal((await notebook()).pages[1].strokes.length, 1);
  await page.locator('#redo').click();
  assert.equal((await notebook()).pages[1].strokes.length, 2);
  await page.screenshot({ path: path.join(root, 'reader-desktop.png'), fullPage: true });
  await page.reload();
  await waitForSlide(1);
  assert.equal(await page.locator('#slide-notes').inputValue(), 'Remember this idea. فارسی');
  assert.equal((await notebook()).pages[1].strokes.length, 2);
  await page.locator('#next-page').click();
  await waitForSlide(2);
  assert.equal(await page.locator('#slide-notes').inputValue(), '');
  await page.locator('#slide-notes').fill('Slide two is separate.');
  await page.locator('#next-page').click();
  await waitForSlide(3);
  await draw('pen', [.2, .2], [.6, .4]);
  await draw('highlight', [.2, .6], [.6, .7]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-pdf').click()]);
  const exportedPath = path.join(root, 'exported-annotations.pdf');
  await download.saveAs(exportedPath);
  const exported = await PDFDocument.load(await readFile(exportedPath));
  assert.equal(exported.getPageCount(), 3);
  assert.equal(exported.getPage(2).getRotation().angle, 90);
  await cp(exportedPath, path.join(root, 'dist', 'presentations', 'export-validation.pdf'));
  const exportChecks = await page.evaluate(async () => {
    const pdfjs = await import('./assets/vendor/pdfjs/pdf.mjs');
    const task = pdfjs.getDocument({ url: new URL('presentations/export-validation.pdf', location.href).href });
    const pdf = await task.promise;
    const results = [];
    for (const pageNumber of [1, 3]) {
      const slide = await pdf.getPage(pageNumber);
      const viewport = slide.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      await slide.render({ canvasContext: context, viewport }).promise;
      const point = pageNumber === 1 ? [.5, .65] : [.4, .65];
      const highlighted = [...context.getImageData(Math.round(viewport.width * point[0]), Math.round(viewport.height * point[1]), 1, 1).data];
      const background = [...context.getImageData(Math.round(viewport.width * point[0]), Math.round(viewport.height * .8), 1, 1).data];
      results.push({ highlighted, background });
    }
    await task.destroy();
    return results;
  });
  for (const result of exportChecks) assert.ok(result.background[2] - result.highlighted[2] > 30, 'Exported highlight must remain at the same slide position, including cropped/rotated pages');
  const [notesDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#export-notes').click()]);
  await notesDownload.saveAs(path.join(root, 'notes.txt'));
  const notes = await readFile(path.join(root, 'notes.txt'), 'utf8');
  assert.match(notes, /Remember this idea. فارسی/);
  assert.match(notes, /Slide two is separate/);
  await page.locator('#previous-page').click();
  await page.locator('#previous-page').click();
  await waitForSlide(1);
  await page.locator('#zoom-in').click();
  await waitForSlide(1);
  assert.match(await page.locator('#zoom-label').textContent(), /%/);
  await page.locator('#fit-page').click();
  await waitForSlide(1);
  await page.locator('#toggle-notes').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.getElementById('pdf-canvas').clientWidth <= document.getElementById('page-area').clientWidth - 30 && !document.getElementById('page-frame').hidden);
  await waitForSlide(1);
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.screenshot({ path: path.join(root, 'reader-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.getElementById('reader').scrollWidth <= innerWidth), true);
  await page.locator('#back-library').click();
  await page.screenshot({ path: path.join(root, 'library-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('.card-link').filter({ hasText: 'نظریه یادگیری' }).click();
  await waitForSlide(1);
  assert.match(await page.locator('#reader-title').textContent(), /نظریه/);
  await page.locator('#back-library').click();
  const index = JSON.parse(await readFile(path.join(root, 'dist', 'presentations.json'), 'utf8'));
  index.presentations = [];
  await writeFile(path.join(root, 'dist', 'presentations.json'), JSON.stringify(index));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.reload();
  await page.locator('#empty-state').waitFor();
  assert.equal(await page.locator('#empty-title').textContent(), 'Your shelf is ready.');
  await page.screenshot({ path: path.join(root, 'library-empty.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed: discovery, nested and Unicode paths, drawing, highlights, undo/redo, persistence, per-slide notes, rotated PDF export, downloads, zoom, and mobile layout.\nScreenshots and sample output: ${root}`);
} catch (error) {
  console.error('Browser diagnostics:', JSON.stringify({ errors, diagnostics }));
  await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true });
  console.error(`Failure screenshot: ${path.join(root, 'failure.png')}`);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
