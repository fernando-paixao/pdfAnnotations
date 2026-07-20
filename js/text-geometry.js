/* ============================================================
   text-geometry.js — shared helpers for text indexing and
   text-range -> normalized-rect conversion.
   Used by Search and Auto-Annotate.
   Exposes global: TextGeometry
   ============================================================ */
const TextGeometry = (() => {

  /**
   * Build a per-page text index from a PDF.js textContent object.
   * Concatenates text items with smart line-break / gap detection so
   * phrases match across fragments.
   * @returns {{ full:string, charMap:Array, items:Array }}
   */
  function buildIndex(textContent) {
    const items = (textContent && textContent.items) || [];
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

  /**
   * Convert a [start, end) char range (in the index's `full` string) on a page
   * into normalized rects (fractions of page size).
   * @param {Object} idx   - result of buildIndex()
   * @param {number} start - start char offset
   * @param {number} end   - end char offset (exclusive)
   * @param {Object} vp    - PDF.js viewport at the current scale
   * @returns {Array<{x,y,width,height}>} normalized rects
   */
  function rangeToRects(idx, start, end, vp) {
    const groups = {}; // itemIdx -> [minLocal, maxLocal]
    for (let i = start; i < end && i < idx.charMap.length; i++) {
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

  /**
   * Normalize text for matching: lowercase + collapse whitespace.
   */
  function normalize(text) {
    return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Find the best char range in `idx.full` that matches `snippet`.
   * Strategy:
   *   1. Exact substring match (normalized).
   *   2. Anchor on first few words, then verify.
   *   3. Sliding-window word-overlap score (fallback).
   * Returns { start, end, score } in ORIGINAL (non-normalized) char coords,
   * or null if no good match (score below threshold).
   *
   * Because normalization changes offsets, we work on a parallel normalized
   * string and map normalized offsets back to original offsets via a position map.
   */
  function findSnippetRange(idx, snippet) {
    const origFull = idx.full;
    const needle = normalize(snippet);
    if (!needle) return null;

    // Build normalized full string + position map (normOffset -> origOffset)
    const normChars = [];
    const posMap = []; // normChars index -> orig offset
    for (let i = 0; i < origFull.length; i++) {
      const ch = origFull[i];
      if (ch === '\n' || ch === '\t') {
        normChars.push(' '); posMap.push(i);
      } else if (/\s/.test(ch)) {
        // collapse consecutive whitespace into single space
        if (normChars.length === 0 || normChars[normChars.length - 1] !== ' ') {
          normChars.push(' '); posMap.push(i);
        }
      } else {
        normChars.push(ch.toLowerCase()); posMap.push(i);
      }
    }
    const normFull = normChars.join('');

    // 1) Exact substring
    let pos = normFull.indexOf(needle);
    if (pos >= 0) {
      const origStart = posMap[pos];
      const origEnd = posMap[Math.min(pos + needle.length - 1, posMap.length - 1)] + 1;
      return { start: origStart, end: origEnd, score: 1 };
    }

    // 2) Anchor on first 3 words
    const words = needle.split(' ').filter(Boolean);
    if (words.length >= 2) {
      const anchor = words.slice(0, Math.min(3, words.length)).join(' ');
      let from = 0;
      let best = null;
      while ((pos = normFull.indexOf(anchor, from)) >= 0) {
        const winLen = Math.min(needle.length + 20, normFull.length - pos);
        const window = normFull.slice(pos, pos + winLen);
        const score = overlapScore(window, needle);
        if (score >= 0.5) {
          const origStart = posMap[pos];
          const origEnd = posMap[Math.min(pos + needle.length - 1, posMap.length - 1)] + 1;
          if (!best || score > best.score) best = { start: origStart, end: origEnd, score };
        }
        from = pos + anchor.length;
      }
      if (best) return best;
    }

    // 3) Sliding window fallback
    const winSize = needle.length;
    best = null;
    for (let i = 0; i + winSize <= normFull.length; i += Math.max(1, Math.floor(winSize / 4))) {
      const window = normFull.slice(i, i + winSize);
      const score = overlapScore(window, needle);
      if (score >= 0.6) {
        const origStart = posMap[i];
        const origEnd = posMap[Math.min(i + needle.length - 1, posMap.length - 1)] + 1;
        if (!best || score > best.score) best = { start: origStart, end: origEnd, score };
      }
    }
    return best; // may be null
  }

  /** Word-level Jaccard overlap score between two normalized strings. */
  function overlapScore(a, b) {
    const wa = new Set(a.split(' ').filter(Boolean));
    const wb = new Set(b.split(' ').filter(Boolean));
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    wa.forEach((w) => { if (wb.has(w)) inter++; });
    return inter / Math.min(wa.size, wb.size);
  }

  return { buildIndex, rangeToRects, findSnippetRange, normalize };
})();
