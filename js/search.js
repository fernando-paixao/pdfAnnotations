/* ============================================================
   search.js — full-PDF text search ("Find in PDF").
   Builds a per-page text index, finds matches across the whole
   document, and draws match overlays + active-match navigation.
   Exposes global: Search
   ============================================================ */
const Search = (() => {
  let inputEl = null;
  let countEl = null;

  let ready = false;            // text index built for current PDF
  const pageIndices = new Map(); // pageNumber -> { full, charMap, items }
  let matches = [];             // [{ page, start, end }] (full-string coords)
  let currentIndex = -1;
  let activePage = null;
  let query = '';
  let debounceTimer = null;

  /* ---------- Per-page index (delegates to TextGeometry) ---------- */
  async function ensureReady() {
    if (ready) return;
    const n = PDFViewer.getNumPages();
    for (let p = 1; p <= n; p++) {
      try {
        const tc = await PDFViewer.getTextContent(p);
        if (tc) pageIndices.set(p, TextGeometry.buildIndex(tc));
      } catch (e) { /* skip page */ }
    }
    ready = true;
  }

  /* ---------- Matching ---------- */
  function findMatches(q) {
    matches = [];
    const needle = q.toLowerCase();
    const n = PDFViewer.getNumPages();
    for (let p = 1; p <= n; p++) {
      const idx = pageIndices.get(p);
      if (!idx) continue;
      const hay = idx.full.toLowerCase();
      let from = 0;
      for (;;) {
        const pos = hay.indexOf(needle, from);
        if (pos < 0) break;
        matches.push({ page: p, start: pos, end: pos + needle.length });
        from = pos + needle.length;
      }
    }
  }

  /* ---------- Geometry: map a match to normalized rects (delegates to TextGeometry) ---------- */
  function matchRects(page, start, end, vp) {
    const idx = pageIndices.get(page);
    if (!idx) return [];
    const spanMap = PDFViewer.getSpanMap(page);
    return TextGeometry.rangeToRects(idx, start, end, vp, spanMap);
  }

  /* ---------- Drawing ---------- */
  function drawPage(page) {
    const wrapper = PDFViewer.getPageWrapper(page);
    if (!wrapper) return;
    const layer = wrapper.querySelector('.highlight-layer');
    if (!layer) return;
    layer.querySelectorAll('.search-match').forEach((el) => el.remove());
    const baseVp = PDFViewer.getBaseViewport(page);
    if (!baseVp) return;
    const vp = baseVp.clone({ scale: PDFViewer.getScale() });
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m.page !== page) continue;
      const active = (i === currentIndex);
      matchRects(page, m.start, m.end, vp).forEach((r) => {
        const div = document.createElement('div');
        div.className = 'search-match' + (active ? ' search-match-active' : '');
        div.style.left = (r.x * 100) + '%';
        div.style.top = (r.y * 100) + '%';
        div.style.width = (r.width * 100) + '%';
        div.style.height = (r.height * 100) + '%';
        layer.appendChild(div);
      });
    }
  }

  function drawAllMatches() {
    const pages = new Set();
    matches.forEach((m) => pages.add(m.page));
    pages.forEach((p) => drawPage(p));
  }

  function clearDraw() {
    const n = PDFViewer.getNumPages();
    for (let p = 1; p <= n; p++) {
      const w = PDFViewer.getPageWrapper(p);
      if (w) w.querySelectorAll('.search-match').forEach((el) => el.remove());
    }
  }

  /* ---------- Navigation ---------- */
  function goToMatch(i) {
    if (!matches.length) return;
    currentIndex = ((i % matches.length) + matches.length) % matches.length;
    const m = matches[currentIndex];
    const prevActive = activePage;
    activePage = m.page;
    PDFViewer.goToPage(m.page);
    drawPage(m.page);
    if (prevActive && prevActive !== m.page) drawPage(prevActive);
    updateCount();
  }

  function next() { if (matches.length) goToMatch(currentIndex + 1); }
  function prev() { if (matches.length) goToMatch(currentIndex - 1); }

  function updateCount() {
    if (!countEl) return;
    if (matches.length === 0) countEl.textContent = query ? '0/0' : '';
    else countEl.textContent = (currentIndex + 1) + '/' + matches.length;
  }

  /* ---------- Run search (debounced) ---------- */
  function runSearch(q) {
    query = (q || '').trim();
    clearTimeout(debounceTimer);
    if (!query) { clear(); return; }
    countEl.textContent = '…';
    const myQuery = query; // capture for supersession check
    debounceTimer = setTimeout(async () => {
      await ensureReady();
      if (myQuery !== query) return; // superseded by newer keystrokes
      findMatches(myQuery);
      currentIndex = matches.length ? 0 : -1;
      activePage = null;
      updateCount();
      if (matches.length) {
        drawAllMatches();
        goToMatch(0);
      } else {
        clearDraw();
      }
    }, 250);
  }

  function clear() {
    matches = [];
    currentIndex = -1;
    activePage = null;
    clearDraw();
    updateCount();
  }

  function reset() {
    ready = false;
    pageIndices.clear();
    matches = [];
    currentIndex = -1;
    activePage = null;
    query = '';
    if (inputEl) inputEl.value = '';
    clearDraw();
    updateCount();
  }

  // Called by app when a page finishes rendering (so matches re-draw after zoom/scroll)
  function redrawPage(page) {
    if (matches.length && pageIndices.has(page)) drawPage(page);
  }

  function init(input, count, prevBtn, nextBtn, clearBtn) {
    inputEl = input;
    countEl = count;
    inputEl.addEventListener('input', () => runSearch(inputEl.value));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) prev(); else next();
      } else if (e.key === 'Escape') {
        inputEl.value = '';
        runSearch('');
        inputEl.blur();
      }
    });
    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
    clearBtn.addEventListener('click', () => {
      inputEl.value = '';
      runSearch('');
      inputEl.focus();
    });
  }

  return { init, runSearch, reset, redrawPage, next, prev, clear };
})();
