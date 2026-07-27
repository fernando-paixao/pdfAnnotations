/* ============================================================
   auto-annotate.js — AI-driven automatic annotation creation.
   Sends page text to Ollama, parses JSON of important passages,
   fuzzy-matches them to the page, and creates highlight annotations.
   Exposes global: AutoAnnotate
   ============================================================ */
const AutoAnnotate = (() => {
  const callbacks = {
    getSettings: null,      // () => { host, model, maxTokens, numCtx, reasoning }
    getContext: null,       // (opts) => { text, pages:[{page,start,end}] }  page-level ranges
    createAnnotation: null, // async (data) -> ann
    onAnnotationCreated: null, // (ann)
    onProgress: null,       // (msg)
    onError: null,          // (msg)
    onComplete: null,       // ({ created, skipped, total })
    onDebug: null,          // (category, message, data?)
  };

  // Default prompt template with placeholders:
  //   $howMany    — instruction for number of passages
  //   $formatLine — JSON element format instruction
  //   $pageText   — the extracted page text
  // Uses i18n so the default prompt matches the UI language.
  const DEFAULT_AUTO_PROMPT = I18N.t('ai.defaultAutoPrompt');

  let abortController = null;

  // --- Retry configuration ---
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  function debug(category, message, data) {
    if (callbacks.onDebug) callbacks.onDebug(category, message, data);
  }

  /**
   * Abort-aware delay: resolves after ms, but rejects immediately
   * with AbortError if the user aborts during the wait.
   */
  function abortAwareDelay(ms) {
    return new Promise((resolve, reject) => {
      if (abortController && abortController.signal.aborted) {
        reject({ name: 'AbortError' });
        return;
      }
      var onAbort = () => { clearTimeout(timer); reject({ name: 'AbortError' }); };
      var timer = setTimeout(() => {
        if (abortController) abortController.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (abortController) abortController.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Call Ollama.chat with automatic retry on failure.
   * Retries up to MAX_RETRIES times with RETRY_DELAY_MS between attempts.
   * Abort errors propagate immediately (no retry).
   * @param {Object} chatOpts  - options for Ollama.chat()
   * @param {string} pageLabel - human-readable label for debug/progress messages
   * @returns {Promise<string>} response text
   */
  async function chatWithRetry(chatOpts, pageLabel) {
    var lastErr;
    for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (abortController && abortController.signal.aborted) throw { name: 'AbortError' };
      try {
        if (attempt > 1) {
          debug('AUTO', pageLabel + ': retry attempt ' + attempt + '/' + MAX_RETRIES);
          if (callbacks.onProgress) {
            callbacks.onProgress(pageLabel + ': retrying (' + attempt + '/' + MAX_RETRIES + ')…');
          }
        }
        return await Ollama.chat(chatOpts);
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        lastErr = err;
        debug('ERR', pageLabel + ': attempt ' + attempt + '/' + MAX_RETRIES +
          ' failed — ' + (err.message || err));
        if (attempt < MAX_RETRIES) {
          if (callbacks.onProgress) {
            callbacks.onProgress(pageLabel + ': error, retrying in ' +
              (RETRY_DELAY_MS / 1000) + 's… (' + (err.message || err) + ')');
          }
          await abortAwareDelay(RETRY_DELAY_MS);
        }
      }
    }
    throw lastErr;
  }

  function init() {}

  /**
   * Yield to the event loop so the browser can paint debug messages
   * and respond to user input (prevents "page unresponsive" freezes
   * during long synchronous fuzzy-matching operations).
   */
  function yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Run auto-annotation.
   * @param {Object} opts
   * @param {number|null} opts.howMany   - desired number of annotations (null = AI decides)
   * @param {boolean} opts.includeNotes  - whether AI should return notes
   * @param {Array} opts.pages           - [{page, text}] pages to annotate
   */
  async function run(opts) {
    if (abortController) { abortController.abort(); }
    abortController = new AbortController();
    const settings = callbacks.getSettings ? callbacks.getSettings() : {};
    if (!settings.model) {
      if (callbacks.onError) callbacks.onError(I18N.t('auto.noModel'));
      return;
    }

    const pages = opts.pages || [];
    if (pages.length === 0) {
      if (callbacks.onError) callbacks.onError(I18N.t('auto.noPageText'));
      return;
    }

    let created = 0, skipped = 0, total = 0;

    debug('AUTO', 'Auto-annotate started', {
      pages: pages.map((p) => p.page),
      howMany: opts.howMany,
      includeNotes: opts.includeNotes,
      model: settings.model,
      host: settings.host,
    });

    try {
      for (const pg of pages) {
        if (abortController.signal.aborted) break;
        if (callbacks.onProgress) callbacks.onProgress('Analyzing page ' + pg.page + '…');
        debug('AUTO', 'Page ' + pg.page + ': text length=' + pg.text.length + ' chars');

        const prompt = buildPrompt(pg.text, opts.howMany, opts.includeNotes, opts.promptTemplate, opts.pdfContext);
        debug('AUTO', 'Page ' + pg.page + ': prompt length=' + prompt.length + ' chars');
        const messages = [];
        if (settings.systemPrompt && settings.systemPrompt.trim()) {
          messages.push({ role: 'system', content: settings.systemPrompt.trim() });
        }
        messages.push({ role: 'user', content: prompt });
        let raw;
        try {
          raw = await chatWithRetry({
            host: settings.host,
            model: settings.model,
            messages,
            stream: false,
            maxTokens: settings.maxTokens,
            numCtx: settings.numCtx,
            think: settings.reasoning,
            signal: abortController.signal,
            onStats: (s) => {
              debug('REQ', 'Page ' + pg.page + ': POST ' + s.url + ' | model=' + s.model +
                ' | promptLen=' + s.requestLength);
              debug('BODY', 'Page ' + pg.page + ': request body', s.requestBody);
              debug('TIME', 'Page ' + pg.page + ': first token=' + s.timeToFirstTokenMs +
                'ms | total=' + s.totalTimeMs + 'ms');
            },
          }, 'Page ' + pg.page);
        } catch (err) {
          if (err && err.name === 'AbortError') { debug('AUTO', 'Aborted by user'); break; }
          debug('ERR', 'Page ' + pg.page + ': all ' + MAX_RETRIES + ' attempts failed — ' + (err.message || err));
          if (callbacks.onError) callbacks.onError('Page ' + pg.page + ': failed after ' + MAX_RETRIES + ' retries — ' + (err.message || err));
          continue;
        }

        debug('AUTO', 'Page ' + pg.page + ': raw AI response (' + raw.length + ' chars)', raw);

        const passages = parsePassages(raw);
        debug('AUTO', 'Page ' + pg.page + ': parsed ' + passages.length + ' passage(s) from AI response');
        if (passages.length === 0) {
          if (callbacks.onProgress) callbacks.onProgress('Page ' + pg.page + ': no passages parsed.');
          continue;
        }

        // Build page text index for matching
        const tc = await PDFViewer.getTextContent(pg.page);
        if (!tc) continue;
        const idx = TextGeometry.buildIndex(tc);
        const baseVp = PDFViewer.getBaseViewport(pg.page);
        if (!baseVp) continue;
        const vp = baseVp.clone({ scale: PDFViewer.getScale() });
        const spanMap = PDFViewer.getSpanMap(pg.page);

        for (const p of passages) {
          if (abortController.signal.aborted) break;
          total++;

          // Yield before each passage so the browser can paint accumulated
          // debug messages and stay responsive during long fuzzy matching.
          await yieldToUI();

          try {
            const snippet = (p.text || '').trim();
            if (!snippet) { skipped++; debug('AUTO', 'Page ' + pg.page + ': empty snippet, skipped'); continue; }
            const range = TextGeometry.findSnippetRange(idx, snippet, (info) => {
              if (info.type === 'fuzzy-start') {
                debug('FUZZY', 'Page ' + pg.page + ': strategies 1-3 failed, attempting fuzzy match', {
                  aiOriginal: info.aiOriginal,
                  aiStripped: info.aiStripped,
                  aiWords: info.aiWordCount,
                  pdfWords: info.pdfWordCount,
                });
              } else if (info.type === 'fuzzy-match') {
                debug('FUZZY', 'Page ' + pg.page + ': FUZZY MATCH (score=' + info.score.toFixed(2) +
                  ', ' + info.matchedWords + '/' + info.totalAiWords + ' words, ' + info.skips + ' skips)', {
                  score: info.score,
                  matchedWords: info.matchedWords + '/' + info.totalAiWords,
                  skips: info.skips,
                  skippedAiWords: info.skippedAiWords,
                  pdfMatchedRegion: info.pdfMatchedRegion,
                  pdfMatchedStripped: info.pdfMatchedStripped,
                });
              } else if (info.type === 'fuzzy-no-match') {
                debug('FUZZY', 'Page ' + pg.page + ': fuzzy match failed — ' + info.reason, {
                  aiWordCount: info.aiWordCount,
                  maxSkips: info.maxSkips,
                });
              } else if (info.type === 'fuzzy-reject') {
                debug('FUZZY', 'Page ' + pg.page + ': fuzzy match rejected — ' + info.reason);
              }
            });
            if (!range) {
              skipped++;
              debug('AUTO', 'Page ' + pg.page + ': NO MATCH (score below threshold)',
                '"' + snippet.slice(0, 80) + (snippet.length > 80 ? '…' : '') + '"');
              continue;
            }
            debug('AUTO', 'Page ' + pg.page + ': matched (score=' + range.score.toFixed(2) + ')',
              '"' + snippet.slice(0, 80) + (snippet.length > 80 ? '…' : '') + '"');
            const rects = TextGeometry.rangeToRects(idx, range.start, range.end, vp, spanMap);
            if (!rects.length) { skipped++; debug('AUTO', 'Page ' + pg.page + ': matched but no rects'); continue; }
            const data = {
              namespaceId: HighlighterCurrentNamespaceId(),
              page: pg.page,
              textSelected: snippet.length > 200 ? snippet.slice(0, 200) + '…' : snippet,
              rects,
              annotationText: opts.includeNotes && p.note ? p.note.trim() : null,
              color: '#30a46c', // green tint to distinguish AI annotations
              textStart: range.start,
              textEnd: range.end,
            };
            if (callbacks.createAnnotation) {
              const ann = await callbacks.createAnnotation(data);
              if (ann) {
                created++;
                if (callbacks.onAnnotationCreated) callbacks.onAnnotationCreated(ann);
              }
            }
          } catch (passageErr) {
            // An error on ONE passage must NOT kill the entire run.
            // Log it, count it as skipped, and continue with the next passage.
            skipped++;
            debug('ERR', 'Page ' + pg.page + ': passage processing error — ' +
              (passageErr && passageErr.message ? passageErr.message : passageErr),
              passageErr && passageErr.stack ? passageErr.stack : undefined);
          }
        }
        if (callbacks.onProgress) callbacks.onProgress('Page ' + pg.page + ': done.');
      }
    } catch (runErr) {
      // Top-level safety net: any unexpected error is logged and reported
      // so the UI doesn't stay stuck in "processing…" forever.
      if (runErr && runErr.name === 'AbortError') {
        debug('AUTO', 'Aborted by user');
      } else {
        debug('ERR', 'Auto-annotate unexpected error — ' +
          (runErr && runErr.message ? runErr.message : runErr),
          runErr && runErr.stack ? runErr.stack : undefined);
        if (callbacks.onError) callbacks.onError('Unexpected error — ' +
          (runErr && runErr.message ? runErr.message : runErr));
      }
    } finally {
      debug('AUTO', 'Auto-annotate complete', { created, skipped, total });
      if (callbacks.onComplete) callbacks.onComplete({ created, skipped, total });
    }
  }

  function abort() {
    if (abortController) abortController.abort();
  }

  /* ---------- Prompt building ---------- */
  function buildPrompt(pageText, howMany, includeNotes, template, pdfContext) {
    const countLine = howMany && howMany > 0
      ? 'Return exactly ' + howMany + ' of the most important passages.'
      : 'Return the most important passages (as many as you judge relevant).';

    const formatLine = includeNotes
      ? 'Each element MUST be: {"text": "<exact excerpt copied verbatim from the page>", "note": "<a few words explaining why it matters>"}'
      : 'Each element MUST be: {"text": "<exact excerpt copied verbatim from the page>"}';

    const ctx = pdfContext && pdfContext.trim() ? pdfContext.trim() : '';
    const tmpl = (template && template.trim()) ? template.trim() : I18N.t('ai.defaultAutoPrompt');
    return tmpl
      .replace(/\$howMany/g, countLine)
      .replace(/\$formatLine/g, formatLine)
      .replace(/\$pdfContext/g, ctx)
      .replace(/\$pageText/g, pageText);
  }

  /* ---------- JSON parsing (robust, multi-stage) ---------- */

  /** Curly/smart quote characters to strip from text values. */
  const WRAPPING_QUOTES = "['\"\u201C\u201D\u00AB\u00BB]";

  /**
   * Parse AI response into passages [{text, note}].
   * Uses a 3-stage fallback to handle malformed JSON from LLMs:
   *   Stage 1: Direct JSON.parse (fast path for well-formed output)
   *   Stage 2: JSON repair (fix escaped keys, single quotes) + parse
   *   Stage 3: Regex-based extraction (last resort)
   * All stages post-process values to strip wrapping quotes.
   */
  function parsePassages(raw) {
    if (!raw) return [];
    let text = raw.trim();
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

    // Extract the outermost JSON array
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < 0 || end <= start) {
      // No array brackets — try regex extraction directly
      const result = cleanPassages(parsePassagesRegex(text));
      if (result.length > 0) debug('PARSE', 'Regex fallback (no array brackets): ' + result.length + ' passage(s)');
      return result;
    }
    const jsonStr = text.slice(start, end + 1);

    // Stage 1: Direct JSON.parse
    let passages = tryJsonParse(jsonStr);
    if (passages.length > 0) {
      debug('PARSE', 'Stage 1 (direct parse): ' + passages.length + ' passage(s)');
      return cleanPassages(passages);
    }

    // Stage 2: Repair common JSON errors and retry
    const repaired = repairJson(jsonStr);
    if (repaired !== jsonStr) {
      passages = tryJsonParse(repaired);
      if (passages.length > 0) {
        debug('PARSE', 'Stage 2 (repaired JSON): ' + passages.length + ' passage(s)');
        return cleanPassages(passages);
      }
    }

    // Stage 3: Regex-based extraction (last resort)
    // Use repaired string if available — fixes like \"note\" → "note" help regex too
    var regexInput = repaired !== jsonStr ? repaired : jsonStr;
    passages = cleanPassages(parsePassagesRegex(regexInput));
    debug('PARSE', 'Stage 3 (regex fallback): ' + passages.length + ' passage(s)', jsonStr.length > 300 ? jsonStr.slice(0, 300) + '\u2026' : jsonStr);
    return passages;
  }

  /**
   * Try JSON.parse and map to {text, note} format.
   * Returns [] on any error.
   */
  function tryJsonParse(jsonStr) {
    try {
      const arr = JSON.parse(jsonStr);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((item) => ({
          text: typeof item === 'string' ? item : (item.text || item.excerpt || ''),
          note: typeof item === 'object' ? (item.note || item.reason || item.why || '') : '',
        }))
        .filter((p) => p.text && p.text.trim().length > 3);
    } catch (e) {
      return [];
    }
  }

  /**
   * Attempt to repair common JSON errors produced by LLMs:
   *   - Escaped keys inside string values: \"note\" → "note"
   *   - Single-quote delimiters around known keys: 'text': → "text":
   *   - Trailing commas before } or ]
   *   - Unescaped control characters inside strings
   */
  function repairJson(jsonStr) {
    let s = jsonStr;
    // Fix escaped JSON keys: \"text\" → "text", \"note\" → "note", etc.
    s = s.replace(/\\"(text|note|reason|why|excerpt|title)\\"/g, '"$1"');
    // Replace single-quote delimiters around known keys: 'text': → "text":
    s = s.replace(/'(text|note|reason|why|excerpt|title)'(\s*:)/g, '"$1"$2');
    // Remove trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, '$1');
    return s;
  }

  /**
   * Last-resort regex-based extraction of passages from malformed JSON.
   * Splits into object-like chunks and extracts text/note fields.
   */
  function parsePassagesRegex(str) {
    const passages = [];
    // Split into chunks at object boundaries: }, { or },{ or },\n{
    const chunks = str.split(/\}\s*,\s*\{/);
    for (let chunk of chunks) {
      const textVal = extractFieldValue(chunk, 'text') || extractFieldValue(chunk, 'excerpt');
      if (!textVal || textVal.trim().length < 4) continue;
      const noteVal = extractFieldValue(chunk, 'note')
        || extractFieldValue(chunk, 'reason')
        || extractFieldValue(chunk, 'why')
        || '';
      passages.push({ text: textVal, note: noteVal });
    }
    return passages;
  }

  /** Regex source fragment matching an optional single or double quote. */
  var QQ = "['\"]"; // safe in double-quoted string

  /**
   * Extract a field value from a JSON-like chunk.
   * Handles double quotes, single quotes, and smart quotes.
   * Captures everything between the opening delimiter and the next
   * field key or closing brace.
   */
  function extractFieldValue(chunk, fieldName) {
    // Build regex to find the key: "field": or 'field': or \"field\":
    var keyRe = new RegExp(QQ + '?' + fieldName + QQ + '?\\s*:\\s*(' + QQ + ')', 'i');
    var keyMatch = chunk.match(keyRe);
    if (keyMatch) {
      var quoteChar = keyMatch[1];
      var startIdx = keyMatch.index + keyMatch[0].length;
      // Scan for the matching closing quote (not escaped)
      for (var i = startIdx; i < chunk.length; i++) {
        if (chunk[i] === quoteChar && chunk[i - 1] !== '\\') {
          // Verify this is a real closing quote: next non-space char
          // should be , } ] or another key
          var after = chunk.slice(i + 1);
          if (/^\s*[,}\]]/.test(after) ||
              new RegExp('^\\s*,\\s*' + QQ + '?(?:note|reason|why|text|excerpt|title)' + QQ + '?\\s*:', 'i').test(after)) {
            return unescapeValue(chunk.slice(startIdx, i));
          }
        }
      }
      // No proper closing quote — take until next key or }
      var remainder = chunk.slice(startIdx);
      var stopRe = new RegExp(',?\\s*' + QQ + '?(?:note|reason|why|excerpt|title)' + QQ + '?\\s*:|\\}', 'i');
      var stopIdx = remainder.search(stopRe);
      if (stopIdx >= 0) return unescapeValue(remainder.slice(0, stopIdx).trim());
      return unescapeValue(remainder.replace(/\}.*$/, '').trim());
    }
    // Fallback: capture everything after key: until next known key or }
    var fallbackRe = new RegExp(
      QQ + '?' + fieldName + QQ + '?\\s*:\\s*' +
      '([\\s\\S]*?)(?=,\\s*' + QQ + '?(?:note|reason|why|text|excerpt|title)' + QQ + '?\\s*:|\\})',
      'i'
    );
    var fbMatch = chunk.match(fallbackRe);
    if (fbMatch) {
      var val = fbMatch[1].trim();
      val = val.replace(new RegExp('^' + WRAPPING_QUOTES + '+|' + WRAPPING_QUOTES + '+$', 'g'), '');
      return unescapeValue(val);
    }
    return null;
  }

  /**
   * Unescape JSON string escape sequences in a value.
   */
  function unescapeValue(val) {
    return val
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  /**
   * Post-process passages: strip wrapping quotation marks from text values.
   * LLMs often wrap the excerpt in extra quotes like: "text": "\"passage\""
   */
  function cleanPassages(arr) {
    const stripRe = new RegExp('^' + WRAPPING_QUOTES + '+|' + WRAPPING_QUOTES + '+$', 'g');
    return arr.map((p) => {
      let text = (p.text || '').trim();
      // Iteratively strip wrapping quotes (handles ""text"" double-wrapping)
      let prev;
      do { prev = text; text = text.replace(stripRe, ''); } while (text !== prev);
      return {
        text: text.trim(),
        note: (p.note || '').trim(),
      };
    }).filter((p) => p.text.length > 3);
  }

  // Placeholder — replaced by app.js wiring to avoid circular dep
  let _namespaceId = null;
  function setNamespaceId(id) { _namespaceId = id; }
  function HighlighterCurrentNamespaceId() { return _namespaceId; }

  return { init, run, abort, setNamespaceId, callbacks, DEFAULT_AUTO_PROMPT, parsePassages };
})();
