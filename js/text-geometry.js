/* ============================================================
   text-geometry.js — shared helpers for text indexing and
   text-range -> normalized-rect conversion.
   Used by Search and Auto-Annotate.
   Exposes global: TextGeometry
   ============================================================ */
const TextGeometry = (() => {

  // --- Strategy 4: Punctuation-stripped fuzzy matching thresholds ---
  const FUZZY_WORD_TOLERANCE = 0.2;   // max character-edit ratio per word (20%)
  const MIN_MATCH_SCORE      = 0.5;   // min fraction of AI words that must match (50%)
  const MIN_MATCHED_WORDS    = 3;     // absolute minimum matched word count
  const MAX_SKIP_RATIO       = 0.3;   // skip budget as fraction of AI word count (30%)

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
   * Strip ALL punctuation from text, keeping only Unicode letters (\p{L}),
   * numbers (\p{N}), and combining marks (\p{M}). Collapses whitespace
   * and lowercases. Used by Strategy 4 fuzzy matching.
   */
  function stripPunctuation(text) {
    return (text || '')
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Tokenize text into word tokens with positions in the ORIGINAL text.
   * Strips punctuation (only letters/numbers/marks form words) but
   * preserves the original character offsets for each token.
   * @returns {Array<{word:string, origStart:number, origEnd:number}>}
   */
  function tokenizeWithPositions(text) {
    const tokens = [];
    let currentWord = '';
    let wordStart = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/[\p{L}\p{N}\p{M}]/u.test(ch)) {
        if (wordStart === -1) wordStart = i;
        currentWord += ch.toLowerCase();
      } else {
        if (currentWord) {
          tokens.push({ word: currentWord, origStart: wordStart, origEnd: i });
          currentWord = '';
          wordStart = -1;
        }
      }
    }
    if (currentWord) {
      tokens.push({ word: currentWord, origStart: wordStart, origEnd: text.length });
    }
    return tokens;
  }

  /**
   * Standard Levenshtein edit distance between two short strings.
   * Uses O(n) rolling-array DP.
   */
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    const curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = curr; curr = tmp;
    }
    return prev[n];
  }

  /**
   * Fuzzy word comparison: returns true if the two words are identical or
   * within FUZZY_WORD_TOLERANCE edit-distance ratio.
   * Handles minor spelling differences (e.g. "tibet" vs "tibete").
   *
   * For very short words (≤2 chars) requires exact match to avoid false
   * positives on common articles/prepositions (e.g. "de" vs "da").
   */
  function wordsSimilar(a, b) {
    if (a === b) return true;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen <= 2) return false; // short words: exact match only
    const threshold = Math.ceil(maxLen * FUZZY_WORD_TOLERANCE);
    // Quick reject if length difference alone exceeds threshold
    if (Math.abs(a.length - b.length) > threshold) return false;
    return levenshtein(a, b) <= threshold;
  }

  /**
   * Find the best char range in `idx.full` that matches `snippet`.
   * Strategy:
   *   1. Exact substring match (normalized).
   *   2. Anchor on first few words, then verify.
   *   3. Sliding-window word-overlap score (fallback).
   *   4. Punctuation-stripped fuzzy word matching (final fallback).
   * Returns { start, end, score } in ORIGINAL (non-normalized) char coords,
   * or null if no good match (score below threshold).
   *
   * Because normalization changes offsets, we work on a parallel normalized
   * string and map normalized offsets back to original offsets via a position map.
   *
   * @param {Object}   idx      - result of buildIndex()
   * @param {string}   snippet  - the text to find (e.g. AI-generated passage)
   * @param {function} [onDebug] - optional callback(info) for Strategy 4 debug output
   */
  function findSnippetRange(idx, snippet, onDebug) {
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
    if (best) return best;

    // 4) Punctuation-stripped fuzzy word matching (final fallback)
    return findSnippetRangeStripped(idx, snippet, onDebug);
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

  /**
   * Strategy 4: Punctuation-stripped fuzzy word matching.
   *
   * Strips ALL punctuation from both the PDF full text and the AI snippet,
   * tokenizes them into word arrays, then uses greedy alignment with
   * fuzzy word comparison (Levenshtein) and skip tolerance to find the
   * best matching region.
   *
   * This handles cases where the AI adds extra punctuation, prefixes,
   * suffixes, or minor spelling differences that defeat Strategies 1–3.
   *
   * @param {Object}   idx      - result of buildIndex()
   * @param {string}   snippet  - the text to find
   * @param {function} [onDebug] - optional callback(info) for debug output
   * @returns {{start,end,score}|null} in ORIGINAL char coords
   */
  function findSnippetRangeStripped(idx, snippet, onDebug) {
    const pdfTokens = tokenizeWithPositions(idx.full);
    const aiTokens = tokenizeWithPositions(snippet);

    if (onDebug) {
      onDebug({
        type: 'fuzzy-start',
        aiOriginal: snippet.length > 200 ? snippet.slice(0, 200) + '…' : snippet,
        aiStripped: aiTokens.map((t) => t.word).join(' '),
        aiWordCount: aiTokens.length,
        pdfWordCount: pdfTokens.length,
      });
    }

    if (aiTokens.length < MIN_MATCHED_WORDS) {
      if (onDebug) {
        onDebug({
          type: 'fuzzy-reject',
          reason: 'AI snippet too short (' + aiTokens.length + ' words, need ≥' + MIN_MATCHED_WORDS + ')',
        });
      }
      return null;
    }

    const maxSkips = Math.max(2, Math.ceil(aiTokens.length * MAX_SKIP_RATIO));
    let best = null;
    let bestDetail = null;

    for (let pi = 0; pi < pdfTokens.length; pi++) {
      // Optimization: only start at PDF positions whose word is similar
      // to one of the first few AI words (handles AI prefix noise).
      let aiStartOffset = -1;
      for (let off = 0; off < Math.min(3, aiTokens.length); off++) {
        if (wordsSimilar(pdfTokens[pi].word, aiTokens[off].word)) {
          aiStartOffset = off;
          break;
        }
      }
      if (aiStartOffset < 0) continue;

      // Greedy alignment from (pi, aiStartOffset)
      let pdfPtr = pi;
      let aiPtr = aiStartOffset;
      let matched = 0;
      let skips = 0;
      let firstMatchToken = null;
      let lastMatchToken = null;
      const skippedAiWords = [];

      while (pdfPtr < pdfTokens.length && aiPtr < aiTokens.length) {
        if (wordsSimilar(pdfTokens[pdfPtr].word, aiTokens[aiPtr].word)) {
          if (!firstMatchToken) firstMatchToken = pdfTokens[pdfPtr];
          lastMatchToken = pdfTokens[pdfPtr];
          matched++;
          pdfPtr++;
          aiPtr++;
        } else {
          // Try looking ahead 1-2 PDF words (gap in PDF text)
          let foundAhead = false;
          for (let lookahead = 1; lookahead <= 2 && pdfPtr + lookahead < pdfTokens.length; lookahead++) {
            if (wordsSimilar(pdfTokens[pdfPtr + lookahead].word, aiTokens[aiPtr].word)) {
              skips += lookahead;
              pdfPtr += lookahead;
              foundAhead = true;
              break;
            }
          }
          if (!foundAhead) {
            // Skip this AI word (likely noise/prefix from AI)
            skippedAiWords.push(aiTokens[aiPtr].word);
            aiPtr++;
            skips++;
          }
          if (skips > maxSkips) break;
        }
      }

      if (matched >= MIN_MATCHED_WORDS && firstMatchToken && lastMatchToken) {
        const score = matched / aiTokens.length;
        if (score >= MIN_MATCH_SCORE) {
          if (!best || score > best.score) {
            best = {
              start: firstMatchToken.origStart,
              end: lastMatchToken.origEnd,
              score,
            };
            bestDetail = {
              matchedWords: matched,
              totalAiWords: aiTokens.length,
              skips: skips,
              skippedAiWords: skippedAiWords,
              pdfRegion: idx.full.slice(firstMatchToken.origStart, lastMatchToken.origEnd),
            };
          }
        }
      }
    }

    if (best && onDebug) {
      const regionStripped = tokenizeWithPositions(bestDetail.pdfRegion).map((t) => t.word).join(' ');
      onDebug({
        type: 'fuzzy-match',
        score: best.score,
        matchedWords: bestDetail.matchedWords,
        totalAiWords: bestDetail.totalAiWords,
        skips: bestDetail.skips,
        skippedAiWords: bestDetail.skippedAiWords,
        pdfMatchedRegion: bestDetail.pdfRegion.length > 200 ? bestDetail.pdfRegion.slice(0, 200) + '…' : bestDetail.pdfRegion,
        pdfMatchedStripped: regionStripped,
      });
    } else if (!best && onDebug) {
      onDebug({
        type: 'fuzzy-no-match',
        reason: 'No alignment scored ≥' + MIN_MATCH_SCORE + ' with ≥' + MIN_MATCHED_WORDS + ' matched words',
        aiWordCount: aiTokens.length,
        maxSkips: maxSkips,
      });
    }

    return best; // may be null
  }

  return { buildIndex, rangeToRects, findSnippetRange, normalize, stripPunctuation };
})();
