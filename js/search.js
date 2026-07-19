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

  /* ---------- Per-page index ---------- */
  function buildIndex(tc) {
    const items = tc.items || [];
    const fullChars = [];
    const charMap = []; // parallel to fullChars: { itemIdx, local } | { itemIdx:-1 }
    let prevY = null;
    let prevEndX = null;
    items.forEach((item, idx) => {
      const str = item.str || '';
      if (!str) return;
      const t = item.transform || [1, 0, 0, 1, 0, 0];
      const x = t[4];
      const y = t[5];
      const lh = item.height || Math.hypot(t[0], t[1]) || 10;
      const w = item.width || 0;
      if (prevY !== null && Math.abs(y - prevY) > lh * 0.5) {
        fullChars.push('\n'); charMap.push({ itemIdx: -1 });
      } else if (prevEndX !== null && x - prevEndX > w * 0.3 + 1) {
        fullChars.push(' '); charMap.push({ itemIdx: -1 });
      }
      for (let k = 0; k < str.length; k++) {
        fullChars.push(str[k]);
        charMap.push({ itemIdx: idx, local: k });
      }
      prevY = y;
      prevEndX = x + w;
    });
    return { full: fullChars.join(''), charMap, items };
  }

  async function ensureReady() {
    if (ready) return;
    const n = PDFViewer.getNumPages();
    for (let p = 1; p <= n; p++) {
      try {
        const tc = await PDFViewer.getTextContent(p);
        if (tc) pageIndices.set(p, buildIndex(tc));
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

  /* ---------- Geometry: map a match to normalized rects ---------- */
  function matchRects(page, start, end, vp) {
    const idx = pageIndices.get(page);
    if (!idx) return [];
    const groups = {}; // itemIdx -> [minLocal, maxLocal]
    for (let i = start; i < end; i++) {
      const cm = idx.charMap[i];
      if (!cm || cm.itemIdx < 0) continue;
      if (!groups[cm.itemIdx]) groups[cm.itemIdx] = [cm.local, cm.local];
      else {
        if (cm.local < groups[cm.itemIdx][0]) groups[cm.itemIdx][0] = cm.local;
        if (cm.local > groups[cm.itemIdx][1]) groups[cm.itemIdx][1] = cm.local;
      }
    }
    const rects = [];
    Object.keys(groups).forEach((k) => {
      const item = idx.items[Number(k)];
      if (!item) return;
      const [lo, hi] = groups[k];
      const t = item.transform || [1, 0, 0, 1, 0, 0];
      const len = item.str ? item.str.length : 1;
      const charW = item.width ? item.width / len : 0;
      const baseX = t[4];
      const baseY = t[5];
      const h = item.height || Math.hypot(t[0], t[1]) || 10;
      const x0 = baseX + lo * charW;
      const x1 = baseX + (hi + 1) * charW;
      // PDF rect (y up): from slightly below baseline to ascent
      const vr = vp.convertToViewportRectangle([x0, baseY - h * 0.2, x1, baseY + h * 0.85]);
      const left = Math.min(vr[0], vr[2]);
      const right = Math.max(vr[0], vr[2]);
      const top = Math.min(vr[1], vr[3]);
      const bottom = Math.max(vr[1], vr[3]);
      rects.push({
        x: left / vp.width,
        y: top / vp.height,
        width: (right - left) / vp.width,
        height: (bottom - top) / vp.height,
      });
    });
    return rects;
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
