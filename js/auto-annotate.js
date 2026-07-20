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

  let abortController = null;

  function debug(category, message, data) {
    if (callbacks.onDebug) callbacks.onDebug(category, message, data);
  }

  function init() {}

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
      if (callbacks.onError) callbacks.onError('No AI model configured. Open the AI panel and set a model.');
      return;
    }

    const pages = opts.pages || [];
    if (pages.length === 0) {
      if (callbacks.onError) callbacks.onError('No page text to annotate.');
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

    for (const pg of pages) {
      if (abortController.signal.aborted) break;
      if (callbacks.onProgress) callbacks.onProgress('Analyzing page ' + pg.page + '…');
      debug('AUTO', 'Page ' + pg.page + ': text length=' + pg.text.length + ' chars');

      const prompt = buildPrompt(pg.text, opts.howMany, opts.includeNotes);
      debug('AUTO', 'Page ' + pg.page + ': prompt length=' + prompt.length + ' chars');
      let raw;
      try {
        raw = await Ollama.chat({
          host: settings.host,
          model: settings.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          maxTokens: settings.maxTokens,
          numCtx: settings.numCtx,
          think: settings.reasoning,
          signal: abortController.signal,
          onStats: (s) => {
            debug('REQ', 'Page ' + pg.page + ': POST ' + s.url + ' | model=' + s.model +
              ' | promptLen=' + s.requestLength);
            debug('TIME', 'Page ' + pg.page + ': first token=' + s.timeToFirstTokenMs +
              'ms | total=' + s.totalTimeMs + 'ms');
          },
        });
      } catch (err) {
        if (err.name === 'AbortError') { debug('AUTO', 'Aborted by user'); break; }
        debug('ERR', 'Page ' + pg.page + ': ' + err.message);
        if (callbacks.onError) callbacks.onError('Ollama error on page ' + pg.page + ': ' + err.message);
        continue;
      }

      debug('AUTO', 'Page ' + pg.page + ': raw AI response (' + raw.length + ' chars)',
        raw.length > 500 ? raw.slice(0, 500) + '\n…[truncated]' : raw);

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

      for (const p of passages) {
        if (abortController.signal.aborted) break;
        total++;
        const snippet = (p.text || '').trim();
        if (!snippet) { skipped++; debug('AUTO', 'Page ' + pg.page + ': empty snippet, skipped'); continue; }
        const range = TextGeometry.findSnippetRange(idx, snippet);
        if (!range) {
          skipped++;
          debug('AUTO', 'Page ' + pg.page + ': NO MATCH (score below threshold)',
            '"' + snippet.slice(0, 80) + (snippet.length > 80 ? '…' : '') + '"');
          continue;
        }
        debug('AUTO', 'Page ' + pg.page + ': matched (score=' + range.score.toFixed(2) + ')',
          '"' + snippet.slice(0, 80) + (snippet.length > 80 ? '…' : '') + '"');
        const rects = TextGeometry.rangeToRects(idx, range.start, range.end, vp);
        if (!rects.length) { skipped++; debug('AUTO', 'Page ' + pg.page + ': matched but no rects'); continue; }
        const data = {
          pdfId: HighlighterCurrentPdfId(),
          page: pg.page,
          textSelected: snippet.length > 200 ? snippet.slice(0, 200) + '…' : snippet,
          rects,
          annotationText: opts.includeNotes && p.note ? p.note.trim() : null,
          color: '#30a46c', // green tint to distinguish AI annotations
        };
        if (callbacks.createAnnotation) {
          const ann = await callbacks.createAnnotation(data);
          if (ann) {
            created++;
            if (callbacks.onAnnotationCreated) callbacks.onAnnotationCreated(ann);
          }
        }
      }
      if (callbacks.onProgress) callbacks.onProgress('Page ' + pg.page + ': done.');
    }

    debug('AUTO', 'Auto-annotate complete', { created, skipped, total });
    if (callbacks.onComplete) callbacks.onComplete({ created, skipped, total });
  }

  function abort() {
    if (abortController) abortController.abort();
  }

  /* ---------- Prompt building ---------- */
  function buildPrompt(pageText, howMany, includeNotes) {
    const countLine = howMany && howMany > 0
      ? 'Return exactly ' + howMany + ' of the most important passages.'
      : 'Return the most important passages (as many as you judge relevant).';

    const formatLine = includeNotes
      ? 'Each element MUST be: {"text": "<exact excerpt copied verbatim from the page>", "note": "<a few words explaining why it matters>"}'
      : 'Each element MUST be: {"text": "<exact excerpt copied verbatim from the page>"}';

    return [
      'You are analyzing the text content of a PDF page.',
      'Identify the most important passages worth highlighting.',
      countLine,
      '',
      'CRITICAL RULES:',
      '1. The "text" value MUST be copied VERBATIM from the page text below (do not paraphrase, do not summarize).',
      '2. Return ONLY a JSON array. No markdown fences, no commentary, no prose.',
      '3. ' + formatLine,
      '',
      'Page text:',
      pageText,
    ].join('\n');
  }

  /* ---------- JSON parsing (robust) ---------- */
  function parsePassages(raw) {
    if (!raw) return [];
    let text = raw.trim();
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    // Extract the outermost JSON array
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < 0 || end <= start) return [];
    const jsonStr = text.slice(start, end + 1);
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

  // Placeholder — replaced by app.js wiring to avoid circular dep
  let _pdfId = null;
  function setPdfId(id) { _pdfId = id; }
  function HighlighterCurrentPdfId() { return _pdfId; }

  return { init, run, abort, setPdfId, callbacks };
})();
