import { emptyNotebook, storageKey, parseNotebook, drawAnnotations, findStrokeAt } from './annotations.js';

const $ = id => document.getElementById(id);
const baseUrl = new URL('../', import.meta.url);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="${new URL(`assets/icons.svg#${name}`, baseUrl).href}"></use></svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pdfUrl = file => new URL(file.url, baseUrl).href;
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
let manifest;
let activeFolder = '';
let state = null;
let pdfjsPromise;
let routeGeneration = 0;
let toastTimer;
let resizeTimer;
let notesVisible = !matchMedia('(max-width: 760px)').matches;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function readPreference(key) { try { return localStorage.getItem(key); } catch { return null; } }
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('.theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  document.querySelector('.theme-toggle use').setAttribute('href', `./assets/icons.svg#${theme === 'dark' ? 'sun' : 'moon'}`);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101724' : '#f6f8fc';
  try { localStorage.setItem('presentation-shelf:theme', theme); } catch { /* Theme still works without browser storage. */ }
}
setTheme(readPreference('presentation-shelf:theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.querySelector('.theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdfjs/pdf.mjs').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.mjs', baseUrl).href;
      return pdfjs;
    }).catch(error => { pdfjsPromise = null; throw error; });
  }
  return pdfjsPromise;
}

function documentOptions(file) {
  return {
    url: pdfUrl(file),
    cMapUrl: new URL('assets/vendor/pdfjs/cmaps/', baseUrl).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', baseUrl).href,
    wasmUrl: new URL('assets/vendor/pdfjs/wasm/', baseUrl).href,
    isEvalSupported: false
  };
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadLibrary() {
  $('library-error').hidden = true;
  $('empty-state').hidden = true;
  $('result-count').textContent = 'Loading your library…';
  try {
    const response = await fetch(new URL('presentations.json', baseUrl), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Index request failed (${response.status}).`);
    const data = await response.json();
    if (data.version !== 1 || !Array.isArray(data.presentations)) throw new Error('The presentation index is invalid.');
    manifest = data;
    document.title = manifest.title;
    document.querySelector('[data-site-title]').textContent = manifest.title;
    $('site-description').textContent = manifest.description;
    $('total-count').textContent = manifest.presentations.length;
    $('empty-path').textContent = `${manifest.pdfDirectory}/`;
    renderFolderFilters();
    renderLibrary();
    await handleRoute();
  } catch (error) {
    $('result-count').textContent = 'Library unavailable';
    $('library-error').hidden = false;
    $('library-error-message').textContent = 'Refresh to try again. For a local preview, run npm run dev. On GitHub Pages, make sure the deployment workflow has finished.';
    console.error('Could not load presentation library:', error);
  }
}

function renderFolderFilters() {
  const folders = [...new Set(manifest.presentations.map(file => file.folder.split('/')[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const allButton = `<button class="folder-filter ${activeFolder === '' ? 'active' : ''}" data-folder="" aria-pressed="${activeFolder === ''}">${icon('grid')}All presentations<span class="filter-count">${manifest.presentations.length}</span></button>`;
  $('folder-filters').innerHTML = allButton + folders.map(folder => {
    const count = manifest.presentations.filter(file => file.folder.split('/')[0] === folder).length;
    return `<button class="folder-filter ${activeFolder === folder ? 'active' : ''}" data-folder="${escapeHtml(folder)}" aria-pressed="${activeFolder === folder}">${icon('folder')}${escapeHtml(folder)}<span class="filter-count">${count}</span></button>`;
  }).join('');
}

const thumbnailCache = new Map();
let thumbnailQueue = [];
let runningThumbnails = 0;
const thumbnailObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      thumbnailObserver.unobserve(entry.target);
      const file = manifest.presentations.find(item => item.id === entry.target.dataset.id);
      if (file) { thumbnailQueue.push({ element: entry.target, file }); pumpThumbnails(); }
    }
  }
}, { rootMargin: '180px' });

function applyThumbnail(element, thumbnail) {
  if (!element.isConnected) return;
  const image = document.createElement('img');
  image.src = thumbnail.url;
  image.alt = '';
  image.width = thumbnail.width;
  image.height = thumbnail.height;
  element.querySelector('.preview-placeholder')?.replaceWith(image);
  element.closest('.presentation-card').querySelector('[data-page-label]').textContent = `${thumbnail.pages} slide${thumbnail.pages === 1 ? '' : 's'}`;
}

function pumpThumbnails() {
  while (runningThumbnails < 2 && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    if (!job.element.isConnected) continue;
    runningThumbnails++;
    createThumbnail(job).finally(() => { runningThumbnails--; pumpThumbnails(); });
  }
}

async function createThumbnail({ element, file }) {
  let task;
  try {
    const cached = thumbnailCache.get(file.id);
    if (cached) { applyThumbnail(element, cached); return; }
    const pdfjs = await loadPdfJs();
    task = pdfjs.getDocument(documentOptions(file));
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scaled = page.getViewport({ scale: 560 / viewport.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .8));
    if (!blob) return;
    const thumbnail = { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, pages: pdf.numPages };
    thumbnailCache.set(file.id, thumbnail);
    applyThumbnail(element, thumbnail);
  } catch (error) { console.warn(`Preview unavailable for ${file.filename}: ${error.message}`); }
  finally { if (task) await task.destroy().catch(() => {}); }
}

function renderLibrary() {
  if (!manifest) return;
  thumbnailObserver.disconnect();
  thumbnailQueue = [];
  const query = $('search').value.trim().toLocaleLowerCase();
  const files = manifest.presentations.filter(file => (!activeFolder || file.folder.split('/')[0] === activeFolder) && `${file.title} ${file.filename} ${file.folder}`.toLocaleLowerCase().includes(query));
  const sort = $('sort').value;
  files.sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  $('result-count').textContent = `${files.length} presentation${files.length === 1 ? '' : 's'}`;
  $('presentation-grid').innerHTML = files.map(file => `<article class="presentation-card"><a class="card-link" href="#presentation=${encodeURIComponent(file.path)}&page=1"><div class="card-preview" data-id="${file.id}"><div class="preview-placeholder">${icon('file')}<span>PDF PRESENTATION</span></div><span class="pdf-badge">PDF</span></div><div class="card-body"><p class="card-folder">${escapeHtml(file.folder || 'Collection')}</p><h2 dir="auto">${escapeHtml(file.title)}</h2><div class="card-metadata"><span data-page-label>PDF</span><span class="metadata-dot"></span><span>${formatSize(file.bytes)}</span><span class="metadata-dot"></span><time datetime="${escapeHtml(file.updatedAt)}">${dateFormatter.format(new Date(file.updatedAt))}</time>${icon('book')}</div></div></a></article>`).join('');
  $('empty-state').hidden = files.length !== 0;
  const emptyLibrary = manifest.presentations.length === 0;
  $('empty-title').textContent = emptyLibrary ? 'Your shelf is ready.' : 'No presentations found.';
  $('empty-message').textContent = emptyLibrary ? `Add PDF files to ${manifest.pdfDirectory}/ in your repository. They’ll appear here after the next deployment.` : 'Try a different search or look in another folder.';
  $('empty-path').hidden = !emptyLibrary;
  $('clear-search').hidden = emptyLibrary;
  for (const element of document.querySelectorAll('.card-preview')) {
    const cached = thumbnailCache.get(element.dataset.id);
    if (cached) applyThumbnail(element, cached); else thumbnailObserver.observe(element);
  }
}

$('search').addEventListener('input', renderLibrary);
$('sort').addEventListener('change', renderLibrary);
$('folder-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-folder]');
  if (!button) return;
  activeFolder = button.dataset.folder;
  renderFolderFilters();
  renderLibrary();
});
$('clear-search').addEventListener('click', () => { $('search').value = ''; activeFolder = ''; renderFolderFilters(); renderLibrary(); $('search').focus(); });
$('retry-library').addEventListener('click', loadLibrary);

function pageData() {
  const page = String(state.page);
  return state.notebook.pages[page] ||= { notes: '', strokes: [] };
}

function saveNotebook() {
  if (!state?.pdf) return;
  try {
    localStorage.setItem(storageKey(state.file), JSON.stringify(state.notebook));
    $('save-status-text').textContent = 'Saved in this browser';
    $('save-status').classList.remove('error');
  } catch {
    $('save-status-text').textContent = 'Not saved — download your work';
    $('save-status').classList.add('error');
    if (!state.storageWarning) { state.storageWarning = true; toast('Browser storage is unavailable or full. Download your marked PDF and notes to keep them.'); }
  }
}

function setNotesVisible(visible) {
  notesVisible = visible;
  $('notes-panel').hidden = !visible;
  $('toggle-notes').setAttribute('aria-expanded', String(visible));
  $('toggle-notes').classList.toggle('active', visible);
  if (state?.pdf && state.zoom === 'fit') scheduleRender();
}
setNotesVisible(notesVisible);
$('toggle-notes').addEventListener('click', () => setNotesVisible(!notesVisible));
$('close-notes').addEventListener('click', () => { setNotesVisible(false); $('toggle-notes').focus(); });
$('slide-notes').addEventListener('input', () => {
  if (!state?.pdf) return;
  pageData().notes = $('slide-notes').value.slice(0, 50000);
  saveNotebook();
});

async function closeReader() {
  routeGeneration++;
  const previous = state;
  state = null;
  previous?.renderTask?.cancel();
  previous?.textLayer?.cancel();
  if (previous?.loadingTask) previous.loadingTask.destroy().catch(() => {});
  $('reader').hidden = true;
  $('library').hidden = false;
  document.body.style.overflow = '';
  document.title = manifest?.title || 'Presentations';
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  const card = [...document.querySelectorAll('.card-preview')].find(element => element.dataset.id === previous?.file.id)?.closest('a');
  (card || $('search')).focus({ preventScroll: true });
}

$('back-library').addEventListener('click', () => { location.hash = ''; });
window.addEventListener('hashchange', handleRoute);

async function handleRoute() {
  if (!manifest) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const requestedPath = params.get('presentation');
  if (!requestedPath) { if (state) await closeReader(); return; }
  const file = manifest.presentations.find(item => item.path === requestedPath);
  if (!file) { toast('This presentation is no longer in the library.'); history.replaceState(null, '', location.pathname + location.search); if (state) await closeReader(); return; }
  const requestedPage = Math.max(1, Math.trunc(Number(params.get('page')) || 1));
  if (state?.file.id === file.id) {
    if (state.pdf && requestedPage !== state.page) setPage(requestedPage);
  } else await openPresentation(file, requestedPage);
}

async function openPresentation(file, page) {
  const generation = ++routeGeneration;
  const previous = state;
  previous?.renderTask?.cancel();
  previous?.textLayer?.cancel();
  if (previous?.loadingTask) previous.loadingTask.destroy().catch(() => {});
  const current = { file, page, pdf: null, notebook: emptyNotebook(), zoom: 'fit', tool: 'read', history: new Map(), renderVersion: 0, renderedPage: 0, pendingStroke: null };
  state = current;
  $('library').hidden = true;
  $('reader').hidden = false;
  document.body.style.overflow = 'hidden';
  $('reader-title').textContent = file.title;
  $('reader-folder').textContent = file.folder || 'PDF presentation';
  document.title = `${file.title} · ${manifest.title}`;
  $('download-original').href = pdfUrl(file);
  $('download-original').download = file.filename;
  $('open-original').href = pdfUrl(file);
  $('page-frame').hidden = true;
  $('reader-error').hidden = true;
  $('reader-loading').hidden = false;
  $('reader-loading').querySelector('p').textContent = 'Opening presentation…';
  $('slide-notes').value = '';
  $('slide-notes').disabled = true;
  $('page-count').textContent = '—';
  $('page-number').value = 1;
  $('export-pdf').innerHTML = `${icon('download')}Save marked PDF`;
  for (const id of ['previous-page', 'next-page', 'page-number', 'export-pdf', 'export-notes', 'undo', 'redo']) $(id).disabled = true;
  setTool('read');
  $('back-library').focus({ preventScroll: true });
  try {
    const pdfjs = await loadPdfJs();
    if (generation !== routeGeneration) return;
    current.loadingTask = pdfjs.getDocument(documentOptions(file));
    current.pdf = await current.loadingTask.promise;
    if (generation !== routeGeneration) return;
    try { current.notebook = parseNotebook(localStorage.getItem(storageKey(file)), current.pdf.numPages); }
    catch { toast('Saved annotations could not be loaded. You can still read and download this presentation.'); }
    current.page = Math.min(page, current.pdf.numPages);
    $('page-count').textContent = current.pdf.numPages;
    $('page-number').max = current.pdf.numPages;
    $('page-number').disabled = false;
    $('export-pdf').disabled = false;
    $('export-notes').disabled = false;
    updatePageControls();
    await renderPage();
  } catch (error) {
    if (generation !== routeGeneration) return;
    $('reader-loading').hidden = true;
    $('page-frame').hidden = true;
    $('reader-error').hidden = false;
    $('reader-error-message').textContent = error.name === 'PasswordException' ? 'This PDF requires a password. Open the original PDF in your browser to unlock it.' : error.status === 204 ? 'A browser extension or download manager may have intercepted this PDF. Turn off automatic PDF capture for this site, then reopen the presentation.' : 'The PDF may be damaged or unavailable. You can try opening the original file.';
    console.error('Could not open PDF:', error);
  }
}

function updateHash() {
  const params = new URLSearchParams({ presentation: state.file.path, page: String(state.page) });
  history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
}

function updatePageControls() {
  $('page-number').value = state.page;
  $('previous-page').disabled = state.page <= 1;
  $('next-page').disabled = state.page >= state.pdf.numPages;
  $('note-slide-label').textContent = `SLIDE ${String(state.page).padStart(2, '0')}`;
  $('slide-notes').value = pageData().notes;
  $('slide-notes').disabled = false;
  state.notebook.lastPage = state.page;
  updateHistoryControls();
  updateHash();
}

function setPage(number) {
  if (!state?.pdf || !Number.isFinite(number)) return;
  finishStroke();
  const page = Math.max(1, Math.min(state.pdf.numPages, Math.trunc(number)));
  if (page === state.page) { $('page-number').value = page; return; }
  state.page = page;
  updatePageControls();
  saveNotebook();
  $('page-area').scrollTo(0, 0);
  renderPage();
}

$('previous-page').addEventListener('click', () => setPage(state.page - 1));
$('next-page').addEventListener('click', () => setPage(state.page + 1));
$('page-number').addEventListener('change', () => setPage(Number($('page-number').value)));

async function renderPage() {
  const current = state;
  if (!current?.pdf) return;
  finishStroke();
  const version = ++current.renderVersion;
  const pageNumber = current.page;
  current.renderTask?.cancel();
  current.textLayer?.cancel();
  current.renderedPage = 0;
  $('page-frame').hidden = true;
  $('reader-error').hidden = true;
  $('reader-loading').hidden = false;
  $('reader-loading').querySelector('p').textContent = 'Loading slide…';
  try {
    if (current.renderTask) await current.renderTask.promise.catch(() => {});
    if (state !== current || version !== current.renderVersion) return;
    const page = await current.pdf.getPage(pageNumber);
    if (state !== current || version !== current.renderVersion) return;
    const natural = page.getViewport({ scale: 1 });
    const area = $('page-area');
    const styles = getComputedStyle(area);
    const availableWidth = Math.max(120, area.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight));
    const availableHeight = Math.max(120, area.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom));
    const fitScale = Math.min(availableWidth / natural.width, availableHeight / natural.height, 2);
    const scale = current.zoom === 'fit' ? fitScale : current.zoom;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
    current.viewport = viewport;
    const canvas = $('pdf-canvas');
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const frame = $('page-frame');
    frame.style.width = `${viewport.width}px`;
    frame.style.height = `${viewport.height}px`;
    frame.style.setProperty('--scale-factor', scale);
    frame.style.setProperty('--user-unit', page.userUnit);
    const annotationCanvas = $('annotation-canvas');
    annotationCanvas.width = canvas.width;
    annotationCanvas.height = canvas.height;
    current.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    await current.renderTask.promise;
    if (state !== current || version !== current.renderVersion) return;
    const textContainer = $('text-layer');
    textContainer.replaceChildren();
    const pdfjs = await loadPdfJs();
    current.textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textContainer, viewport });
    await current.textLayer.render();
    if (state !== current || version !== current.renderVersion) return;
    current.renderedPage = pageNumber;
    redrawAnnotations();
    $('zoom-label').textContent = current.zoom === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`;
    $('zoom-out').disabled = current.zoom !== 'fit' && current.zoom <= .25;
    $('zoom-in').disabled = current.zoom !== 'fit' && current.zoom >= 4;
    $('reader-loading').hidden = true;
    frame.hidden = false;
  } catch (error) {
    if (state !== current || version !== current.renderVersion || error.name === 'RenderingCancelledException' || error.name === 'AbortException') return;
    $('reader-loading').hidden = true;
    $('reader-error').hidden = false;
    $('reader-error-message').textContent = 'This slide could not be rendered. Try another slide or open the original PDF.';
    console.error('Could not render slide:', error);
  }
}

function scheduleRender() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state?.pdf) renderPage(); }, 160);
}
new ResizeObserver(() => { if (state?.pdf && state.zoom === 'fit') scheduleRender(); }).observe($('page-area'));
function adjustZoom(multiplier) {
  if (!state?.viewport) return;
  state.zoom = Math.max(.25, Math.min(4, (state.zoom === 'fit' ? state.viewport.scale : state.zoom) * multiplier));
  renderPage();
}
$('zoom-in').addEventListener('click', () => adjustZoom(1.2));
$('zoom-out').addEventListener('click', () => adjustZoom(1 / 1.2));
$('fit-page').addEventListener('click', () => { if (state) { state.zoom = 'fit'; renderPage(); } });
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('reader').requestFullscreen(); }
  catch { toast('Full screen is unavailable in this browser.'); }
});

function setTool(tool) {
  if (!state) return;
  finishStroke();
  state.tool = tool;
  $('page-frame').dataset.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(button => { const active = button.dataset.tool === tool; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('reader-hint').textContent = { read: 'Select text or choose a tool to annotate.', pen: 'Draw on the slide. Your marks save automatically.', highlight: 'Drag a rectangle over an area to highlight.', eraser: 'Tap a mark to erase it.' }[tool];
  if (tool === 'highlight' && $('annotation-color').value === '#3267df') $('annotation-color').value = '#f6ce45';
  if (tool === 'pen' && $('annotation-color').value === '#f6ce45') $('annotation-color').value = '#3267df';
}
document.querySelectorAll('button[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));

function pageHistory() {
  if (!state.history.has(state.page)) state.history.set(state.page, { undo: [], redo: [] });
  return state.history.get(state.page);
}
function updateHistoryControls() {
  const history = pageHistory();
  $('undo').disabled = history.undo.length === 0;
  $('redo').disabled = history.redo.length === 0;
}
function recordChange() {
  const history = pageHistory();
  history.undo.push(structuredClone(pageData().strokes));
  if (history.undo.length > 40) history.undo.shift();
  history.redo = [];
}
function undo() {
  if (!state?.pdf) return;
  finishStroke();
  const history = pageHistory();
  if (!history.undo.length) return;
  history.redo.push(structuredClone(pageData().strokes));
  pageData().strokes = history.undo.pop();
  updateHistoryControls(); redrawAnnotations(); saveNotebook();
}
function redo() {
  if (!state?.pdf) return;
  finishStroke();
  const history = pageHistory();
  if (!history.redo.length) return;
  history.undo.push(structuredClone(pageData().strokes));
  pageData().strokes = history.redo.pop();
  updateHistoryControls(); redrawAnnotations(); saveNotebook();
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

function pointFromEvent(event) {
  const bounds = $('annotation-canvas').getBoundingClientRect();
  return [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))];
}
function redrawAnnotations() {
  if (!state?.pdf) return;
  const canvas = $('annotation-canvas');
  drawAnnotations(canvas.getContext('2d'), [...pageData().strokes, ...(state.pendingStroke ? [state.pendingStroke] : [])], canvas.width, canvas.height);
}
function finishStroke() {
  if (!state?.pendingStroke) return;
  const stroke = state.pendingStroke;
  state.pendingStroke = null;
  state.pointerId = null;
  if (stroke.type === 'highlight' && (Math.abs(stroke.points[0][0] - stroke.points.at(-1)[0]) < .002 || Math.abs(stroke.points[0][1] - stroke.points.at(-1)[1]) < .002)) { redrawAnnotations(); return; }
  recordChange();
  pageData().strokes.push(stroke);
  updateHistoryControls(); redrawAnnotations(); saveNotebook();
}
$('annotation-canvas').addEventListener('pointerdown', event => {
  if (!state?.pdf || state.renderedPage !== state.page || state.tool === 'read' || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  const point = pointFromEvent(event);
  if (state.tool === 'eraser') {
    const canvas = $('annotation-canvas');
    const index = findStrokeAt(pageData().strokes, point, canvas.clientWidth, canvas.clientHeight);
    if (index >= 0) { recordChange(); pageData().strokes.splice(index, 1); updateHistoryControls(); redrawAnnotations(); saveNotebook(); }
    return;
  }
  if (pageData().strokes.length >= 500) { toast('This slide has many marks. Download your PDF or erase a mark to add more.'); return; }
  state.pointerId = event.pointerId;
  state.pendingStroke = { type: state.tool, color: $('annotation-color').value, width: Number($('line-width').value) / 1000, points: [point] };
  $('annotation-canvas').setPointerCapture(event.pointerId);
  redrawAnnotations();
});
$('annotation-canvas').addEventListener('pointermove', event => {
  if (!state?.pendingStroke || state.pointerId !== event.pointerId) return;
  event.preventDefault();
  const stroke = state.pendingStroke;
  if (stroke.type === 'highlight') stroke.points[1] = pointFromEvent(event);
  else for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
    const point = pointFromEvent(sample);
    const last = stroke.points.at(-1);
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) > .0005) stroke.points.push(point);
    if (stroke.points.length >= 18000) stroke.points = stroke.points.filter((_, index) => index % 2 === 0);
  }
  redrawAnnotations();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('annotation-canvas').addEventListener(name, event => { if (state?.pointerId === event.pointerId) finishStroke(); });

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('export-notes').addEventListener('click', () => {
  if (!state?.pdf) return;
  finishStroke();
  let output = `${state.file.title}\n${'='.repeat(40)}\n\n`;
  const pages = Object.entries(state.notebook.pages).filter(([, data]) => data.notes.trim()).sort((a, b) => Number(a[0]) - Number(b[0]));
  output += pages.length ? pages.map(([number, data]) => `Slide ${number}\n${'-'.repeat(16)}\n${data.notes.trim()}\n`).join('\n') : 'No written notes yet.\n';
  downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), state.file.filename.replace(/\.pdf$/i, '-notes.txt'));
});

$('export-pdf').addEventListener('click', async () => {
  const current = state;
  if (!current?.pdf || current.exporting) return;
  finishStroke();
  const snapshot = structuredClone(current.notebook);
  current.exporting = true;
  const button = $('export-pdf');
  button.disabled = true;
  button.textContent = 'Preparing PDF…';
  try {
    const { PDFDocument, rgb, LineCapStyle } = await import('./vendor/pdf-lib/pdf-lib.mjs');
    const bytes = await current.pdf.getData();
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    for (const [pageNumber, data] of Object.entries(snapshot.pages)) {
      if (!data.strokes.length) continue;
      const originalPage = await current.pdf.getPage(Number(pageNumber));
      const viewport = originalPage.getViewport({ scale: 1 });
      const target = pages[Number(pageNumber) - 1];
      const convert = ([x, y]) => { const [pdfX, pdfY] = viewport.convertToPdfPoint(x * viewport.width, y * viewport.height); return { x: pdfX, y: pdfY }; };
      for (const stroke of data.strokes) {
        const color = rgb(parseInt(stroke.color.slice(1, 3), 16) / 255, parseInt(stroke.color.slice(3, 5), 16) / 255, parseInt(stroke.color.slice(5, 7), 16) / 255);
        const zero = viewport.convertToPdfPoint(0, 0);
        const widthPoint = viewport.convertToPdfPoint(stroke.width * viewport.width, 0);
        const thickness = Math.hypot(widthPoint[0] - zero[0], widthPoint[1] - zero[1]);
        const points = stroke.points.map(convert);
        if (stroke.type === 'highlight') {
          const first = points[0], last = points.at(-1);
          target.drawRectangle({ x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), width: Math.abs(last.x - first.x), height: Math.abs(last.y - first.y), color, opacity: .3 });
        } else if (points.length === 1) target.drawCircle({ x: points[0].x, y: points[0].y, size: thickness / 2, color });
        else {
          for (let i = 1; i < points.length; i++) target.drawLine({ start: points[i - 1], end: points[i], thickness, color, lineCap: LineCapStyle.Round });
        }
      }
    }
    downloadBlob(new Blob([await pdf.save()], { type: 'application/pdf' }), current.file.filename.replace(/\.pdf$/i, '-annotated.pdf'));
    toast('Your marked PDF is ready. Download written notes separately.');
  } catch (error) {
    toast('This PDF could not be exported. Your marks are still in this browser; you can download your written notes.');
    console.error('Could not export marked PDF:', error);
  } finally {
    current.exporting = false;
    if (state === current) { button.disabled = false; button.innerHTML = `${icon('download')}Save marked PDF`; }
  }
});

document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (!state) { if (event.key === '/' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); $('search').focus(); } return; }
  if (event.key === 'Escape' && !document.fullscreenElement) { location.hash = ''; return; }
  if (!state.pdf) return;
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); setPage(state.page - 1); }
  if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); setPage(state.page + 1); }
  const tool = { v: 'read', p: 'pen', h: 'highlight', e: 'eraser' }[event.key.toLowerCase()];
  if (tool) setTool(tool);
});

loadLibrary();
