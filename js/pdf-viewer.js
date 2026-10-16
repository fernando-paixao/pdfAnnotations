/* ============================================================
   pdf-viewer.js — renders PDF pages (canvas + text layer),
   lazy rendering, zoom, navigation.
   Exposes global: PDFViewer
   ============================================================ */
const PDFViewer = (() => {
  let pdfDoc = null;
  let numPages = 0;
  let scale = 1.2;
  let pagesContainer = null;
  let viewerEl = null;
  let pageWrappers = [];      // 1-indexed: pageWrappers[pageNumber]
  let pageViewports = [];     // base viewports (scale 1)
  let renderedGen = [];       // render generation per page (to cancel stale)
  let currentGen = 0;
  let activeRenderTasks = new Map(); // pageNumber -> in-flight PDF.js render task
  let postScrollCheckTimer = null;   // debounced self-healing re-render after scroll
  let observer = null;
  let dpr = window.devicePixelRatio || 1;
  let textContentCache = []; // 1-indexed: cached getTextContent results
  let spanMaps = [];         // 1-indexed: Map<itemIdx, HTMLSpanElement> for DOM-based geometry

  // External callbacks
  const callbacks = {
    onPageRendered: null,     // (pageNumber, wrapper, viewport, scale)
    onVisiblePageChange: null,// (pageNumber)
    onScaleChange: null,      // (scale)
    onLoaded: null,           // (numPages)
  };

  function init(viewer, container) {
    viewerEl = viewer;
    pagesContainer = container;
    // Track which page is visible for the indicator
    viewer.addEventListener('scroll', () => {
      const n = computeVisiblePage();
      if (n && callbacks.onVisiblePageChange) callbacks.onVisiblePageChange(n);
      schedulePostScrollCheck(); // self-healing pass (reset on every scroll)
    });
  }

  function setWorker() {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    }
  }

  async function loadArrayBuffer(buffer) {
    setWorker();
    // Destroy previous document if any
    if (pdfDoc) {
      activeRenderTasks.forEach((t) => { try { t.cancel(); } catch (e) {} });
      activeRenderTasks.clear();
      try { pdfDoc.destroy(); } catch (e) {}
    }
    pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
    numPages = pdfDoc.numPages;
    currentGen++;
    activeRenderTasks = new Map();
    pageWrappers = new Array(numPages + 1);
    pageViewports = new Array(numPages + 1);
    renderedGen = new Array(numPages + 1).fill(0);
    textContentCache = new Array(numPages + 1);
    spanMaps = new Array(numPages + 1);

    // Fetch base viewports (cheap; no rendering) for correct placeholder sizes
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      pageViewports[i] = page.getViewport({ scale: 1 });
    }

    buildPages();
    setupObserver();
    if (callbacks.onLoaded) callbacks.onLoaded(numPages);
    return numPages;
  }

  function buildPages() {
    pagesContainer.innerHTML = '';
    for (let i = 1; i <= numPages; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.pageNumber = i;
      const vp = pageViewports[i];
      wrapper.style.width = Math.floor(vp.width * scale) + 'px';
      wrapper.style.height = Math.floor(vp.height * scale) + 'px';

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      wrapper.appendChild(canvas);

      const hl = document.createElement('div');
      hl.className = 'highlight-layer';
      hl.dataset.pageNumber = i;
      wrapper.appendChild(hl);

      const tl = document.createElement('div');
      tl.className = 'textLayer';
      wrapper.appendChild(tl);

      pagesContainer.appendChild(wrapper);
      pageWrappers[i] = wrapper;
    }
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const n = Number(entry.target.dataset.pageNumber);
          renderPage(n);
        }
      });
    }, { root: viewerEl, rootMargin: '400px 0px' });

    for (let i = 1; i <= numPages; i++) observer.observe(pageWrappers[i]);
  }

  async function renderPage(pageNumber, isRetry) {
    if (!pdfDoc) return;
    const myGen = currentGen;
    if (renderedGen[pageNumber] === myGen) return; // already rendered at this gen
    renderedGen[pageNumber] = myGen;

    const wrapper = pageWrappers[pageNumber];
    const canvas = wrapper.querySelector('canvas');
    const textLayerDiv = wrapper.querySelector('.textLayer');
    const viewport = pageViewports[pageNumber].clone({ scale });

    // Resize wrapper to exact viewport (in case of rounding)
    wrapper.style.width = Math.floor(viewport.width) + 'px';
    wrapper.style.height = Math.floor(viewport.height) + 'px';

    // Canvas (crisp on hi-dpi)
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';

    try {
      const page = await pdfDoc.getPage(pageNumber);
      // Stale check (zoom may have bumped currentGen)
      if (myGen !== currentGen) return;

      // Cancel any still-active render on this canvas before starting a new
      // one — a second render() on the same canvas while the first is active
      // fails with a canvas-in-use error and leaves the page white.
      const prevTask = activeRenderTasks.get(pageNumber);
      if (prevTask) {
        try { prevTask.cancel(); } catch (e) { /* already settled */ }
        try { await prevTask.promise; } catch (e) { /* RenderingCancelledException expected */ }
        if (activeRenderTasks.get(pageNumber) === prevTask) activeRenderTasks.delete(pageNumber);
        // Re-check state: zoom/other renders may have happened while waiting
        if (myGen !== currentGen) return;
        if (renderedGen[pageNumber] !== myGen) return; // a newer render superseded us
      }

      const ctx = canvas.getContext('2d');
      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      });
      activeRenderTasks.set(pageNumber, renderTask);
      try {
        await renderTask.promise;
      } finally {
        if (activeRenderTasks.get(pageNumber) === renderTask) activeRenderTasks.delete(pageNumber);
      }
      if (myGen !== currentGen) return;

      // Text layer (transparent, selectable)
      const textContent = await page.getTextContent();
      textContentCache[pageNumber] = textContent; // cache for search
      if (myGen !== currentGen) return;
      // Clear previous text layer content (on re-render)
      textLayerDiv.innerHTML = '';
      const textLayer = pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
      });
      await textLayer.promise;

      // Build span map: Map<itemIdx, HTMLSpanElement> for DOM-based geometry.
      // PDF.js creates spans in the same order as non-empty textContent.items.
      const spans = Array.from(textLayerDiv.querySelectorAll('span'));
      const spanMap = new Map();
      let spanPtr = 0;
      for (let i = 0; i < textContent.items.length; i++) {
        const item = textContent.items[i];
        if (!item || !item.str || !item.str.length) continue;
        if (spanPtr < spans.length) {
          spanMap.set(i, spans[spanPtr]);
          spanPtr++;
        }
      }
      spanMaps[pageNumber] = spanMap;

      // Notify highlighter to (re)draw saved highlights for this page
      if (callbacks.onPageRendered) {
        callbacks.onPageRendered(pageNumber, wrapper, viewport, scale);
      }
    } catch (err) {
      if (err && err.name !== 'RenderingCancelledException') {
        const msg = String((err && err.message) || err);
        // Canvas-in-use / render conflict: one deferred retry usually heals it
        if (/same canvas|multiple render|canvas-in-use|render conflict/i.test(msg)) {
          if (renderedGen[pageNumber] === myGen) renderedGen[pageNumber] = 0;
          if (!isRetry) setTimeout(() => renderPage(pageNumber, true), 0);
          else console.error('Render error page', pageNumber, err);
        } else {
          console.error('Render error page', pageNumber, err);
        }
      }
    }
  }

  // Debounced post-scroll self-healing: once scrolling settles, re-render any
  // page intersecting the viewport that is not rendered at the current
  // generation (heals pages missed by the observer after zoom + scroll).
  function schedulePostScrollCheck() {
    if (!pdfDoc) return;
    if (postScrollCheckTimer) clearTimeout(postScrollCheckTimer);
    postScrollCheckTimer = setTimeout(() => {
      postScrollCheckTimer = null;
      if (!pdfDoc) return;
      const vr = viewerEl.getBoundingClientRect();
      for (let i = 1; i <= numPages; i++) {
        if (renderedGen[i] === currentGen) continue;
        if (!pageWrappers[i]) continue;
        const r = pageWrappers[i].getBoundingClientRect();
        if (r.bottom > vr.top && r.top < vr.bottom) renderPage(i);
      }
    }, 250);
  }

  function computeVisiblePage() {
    if (!pageWrappers[1]) return 0;
    const viewerRect = viewerEl.getBoundingClientRect();
    const mid = viewerRect.top + viewerRect.height / 2;
    let best = 1, bestDist = Infinity;
    for (let i = 1; i <= numPages; i++) {
      const r = pageWrappers[i].getBoundingClientRect();
      if (r.bottom < viewerRect.top || r.top > viewerRect.bottom) continue;
      const dist = Math.abs((r.top + r.bottom) / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  function setScale(newScale) {
    newScale = Math.max(0.4, Math.min(4, newScale));
    if (Math.abs(newScale - scale) < 0.01) return;
    const visiblePage = computeVisiblePage();
    scale = newScale;
    currentGen++;
    renderedGen.fill(0);
    // Resize placeholders immediately; actual re-render happens via observer.
    // Keep the old canvas bitmap as a CSS-scaled preview (no blank flash);
    // text/highlight layers are cleared inside renderPage/onPageRendered.
    for (let i = 1; i <= numPages; i++) {
      const vp = pageViewports[i];
      const wrapper = pageWrappers[i];
      wrapper.style.width = Math.floor(vp.width * scale) + 'px';
      wrapper.style.height = Math.floor(vp.height * scale) + 'px';
      const canvas = wrapper.querySelector('canvas');
      canvas.style.width = Math.floor(vp.width * scale) + 'px';
      canvas.style.height = Math.floor(vp.height * scale) + 'px';
    }
    spanMaps = new Array(numPages + 1);
    if (callbacks.onScaleChange) callbacks.onScaleChange(scale);
    // Re-render visible pages right away
    requestAnimationFrame(() => {
      for (let i = 1; i <= numPages; i++) {
        const r = pageWrappers[i].getBoundingClientRect();
        const vr = viewerEl.getBoundingClientRect();
        if (r.bottom > vr.top - 400 && r.top < vr.bottom + 400) renderPage(i);
      }
      if (visiblePage) goToPage(visiblePage);
    });
    // Self-healing pass: after the scroll induced by goToPage settles,
    // re-render anything visible still missing at the current generation.
    schedulePostScrollCheck();
  }

  function zoomIn() { setScale(scale * 1.2); }
  function zoomOut() { setScale(scale / 1.2); }
  function getScale() { return scale; }

  function goToPage(n) {
    if (n < 1 || n > numPages || !pageWrappers[n]) return;
    pageWrappers[n].scrollIntoView({ block: 'start' });
  }

  function getPageWrapper(n) { return pageWrappers[n] || null; }
  function getNumPages() { return numPages; }

  // Cached text content for a page (fetches if not rendered yet) — used by search
  async function getTextContent(pageNumber) {
    if (textContentCache[pageNumber]) return textContentCache[pageNumber];
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(pageNumber);
    const tc = await page.getTextContent();
    textContentCache[pageNumber] = tc;
    return tc;
  }

  // Base viewport (scale 1) for coordinate conversion
  function getBaseViewport(pageNumber) { return pageViewports[pageNumber] || null; }

  // Span map for DOM-based geometry (pixel-perfect rects)
  function getSpanMap(pageNumber) { return spanMaps[pageNumber] || null; }

  return {
    init,
    loadArrayBuffer,
    setScale, zoomIn, zoomOut, getScale,
    goToPage, getNumPages, getPageWrapper,
    getTextContent, getBaseViewport, getSpanMap,
    renderPage,
    callbacks,
  };
})();
