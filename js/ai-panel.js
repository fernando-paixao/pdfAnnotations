/* ============================================================
   ai-panel.js — AI panel UI: Ollama settings, prompt template
   with $text placeholder, context scope, response display,
   and auto-annotate controls.
   Exposes global: AIPanel
   ============================================================ */
const AIPanel = (() => {
  const SETTINGS_KEY = 'pdf-ann-ai-settings';

  const DEFAULT_SETTINGS = {
    host: 'http://localhost:11434',
    model: '',
    maxTokens: 2048,
    numCtx: 8192,
    reasoning: false,
    streaming: true,
    soundEnabled: true,
    systemPrompt: '',
    pdfContext: '',
    contextScope: 'entirePage',
    pageCount: 1,
    promptTemplate: I18N.t('ai.defaultPrompt'),
    includeNotes: true,
    howManyAnnotations: '',
    autoAnnotateTemplate: '',
    mindmapMaxLevels: '',
    mindmapMode: 'all',
    mindmapTemplate: '',
  };

  let settings = { ...DEFAULT_SETTINGS };
  let els = {};
  let abortController = null;
  let viewMode = 'text'; // 'text' | 'markdown'

  // --- Retry configuration ---
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  // Queue state
  let queue = [];             // [{id, messages, label}]
  let isProcessing = false;
  let queueIdCounter = 0;
  let audioCtx = null;

  const callbacks = {
    getCurrentPage: null,   // () => number
    getSelectedText: null,  // () => string
    getPageText: null,      // async (page) => string
    onAutoAnnotate: null,   // (opts) => void
  };

  /* ---------- Settings persistence ---------- */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function getSettings() { return { ...settings }; }

  /* ---------- Init ---------- */
  function init(panelEl, toggleBtn) {
    loadSettings();
    els.panel = panelEl;
    els.toggleBtn = toggleBtn;
    cacheEls();
    applySettingsToUI();
    bindEvents();
  }

  function cacheEls() {
    const $ = (id) => els.panel.querySelector('#' + id);
    els.host = $('aiHost');
    els.model = $('aiModel');
    els.modelSelect = $('aiModelSelect');
    els.fetchModels = $('aiFetchModels');
    els.maxTokens = $('aiMaxTokens');
    els.numCtx = $('aiNumCtx');
    els.reasoning = $('aiReasoning');
    els.streaming = $('aiStreaming');
    els.soundEnabled = $('aiSoundEnabled');
    els.systemPrompt = $('aiSystemPrompt');
    els.pdfContext = $('aiPdfContext');
    els.promptTemplate = $('aiPromptTemplate');
    els.contextScope = $('aiContextScope');
    els.pageCount = $('aiPageCount');
    els.pageCountWrap = $('aiPageCountWrap');
    els.send = $('aiSend');
    els.stop = $('aiStop');
    els.queueBadge = $('aiQueueBadge');
    els.clearQueue = $('aiClearQueue');
    els.response = $('aiResponse');
    els.responseMd = $('aiResponseMd');
    els.viewText = $('aiViewText');
    els.viewMarkdown = $('aiViewMarkdown');
    els.copyTop = $('aiCopyTop');
    els.copyBottom = $('aiCopyBottom');
    els.thinking = $('aiThinking');
    els.status = $('aiStatus');
    els.autoHowMany = $('aiAutoHowMany');
    els.autoNotes = $('aiAutoNotes');
    els.autoTemplate = $('aiAutoTemplate');
    els.autoResetTpl = $('aiAutoResetTpl');
    els.autoRun = $('aiAutoRun');
    els.autoStop = $('aiAutoStop');
    els.autoStatus = $('aiAutoStatus');
    els.mindmapLevels = $('aiMindmapLevels');
    els.mindmapMode = $('aiMindmapMode');
    els.mindmapRun = $('aiMindmapRun');
    els.mindmapStop = $('aiMindmapStop');
    els.mindmapClear = $('aiMindmapClear');
    els.mindmapStatus = $('aiMindmapStatus');
    els.mindmapOutput = $('aiMindmapOutput');
    els.mindmapTemplate = $('aiMindmapTemplate');
    els.mindmapResetTpl = $('aiMindmapResetTpl');
    els.debugLog = $('aiDebugLog');
    els.debugClear = $('aiDebugClear');
    els.debugBadge = $('aiDebugBadge');
    els.debugAutoScroll = $('aiDebugAutoScroll');
    els.testPdfText = $('aiTestPdfText');
    els.testAiJson = $('aiTestAiJson');
    els.testMatch = $('aiTestMatch');
  }

  function applySettingsToUI() {
    els.host.value = settings.host;
    els.model.value = settings.model;
    els.maxTokens.value = settings.maxTokens;
    els.numCtx.value = settings.numCtx;
    els.reasoning.checked = settings.reasoning;
    els.streaming.checked = settings.streaming;
    els.soundEnabled.checked = settings.soundEnabled;
    els.systemPrompt.value = settings.systemPrompt;
    els.pdfContext.value = settings.pdfContext;
    els.promptTemplate.value = settings.promptTemplate;
    els.contextScope.value = settings.contextScope;
    els.pageCount.value = settings.pageCount;
    els.autoHowMany.value = settings.howManyAnnotations;
    els.autoNotes.checked = settings.includeNotes;
    els.autoTemplate.value = settings.autoAnnotateTemplate || I18N.t('ai.defaultAutoPrompt');
    els.mindmapLevels.value = settings.mindmapMaxLevels;
    els.mindmapMode.value = settings.mindmapMode || 'all';
    els.mindmapTemplate.value = settings.mindmapTemplate || I18N.t('ai.defaultMindmapPrompt');
    updatePageCountVisibility();
  }

  function collectSettings() {
    settings.host = els.host.value.trim() || DEFAULT_SETTINGS.host;
    settings.model = els.model.value.trim();
    settings.maxTokens = parseInt(els.maxTokens.value, 10) || 2048;
    settings.numCtx = parseInt(els.numCtx.value, 10) || 8192;
    settings.reasoning = els.reasoning.checked;
    settings.streaming = els.streaming.checked;
    settings.soundEnabled = els.soundEnabled.checked;
    settings.systemPrompt = els.systemPrompt.value;
    settings.pdfContext = els.pdfContext.value;
    settings.promptTemplate = els.promptTemplate.value;
    settings.contextScope = els.contextScope.value;
    settings.pageCount = parseInt(els.pageCount.value, 10) || 1;
    settings.howManyAnnotations = els.autoHowMany.value.trim();
    settings.includeNotes = els.autoNotes.checked;
    settings.autoAnnotateTemplate = els.autoTemplate.value;
    settings.mindmapMaxLevels = els.mindmapLevels.value.trim();
    settings.mindmapMode = els.mindmapMode.value;
    settings.mindmapTemplate = els.mindmapTemplate.value;
    saveSettings();
  }

  function updatePageCountVisibility() {
    els.pageCountWrap.hidden = els.contextScope.value !== 'entirePages';
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    els.toggleBtn.addEventListener('click', () => {
      const open = els.panel.classList.toggle('open');
      els.toggleBtn.classList.toggle('active', open);
    });
    // Persist on change
    [els.host, els.model, els.maxTokens, els.numCtx, els.promptTemplate,
     els.systemPrompt, els.pdfContext, els.contextScope, els.pageCount, els.autoHowMany,
     els.autoTemplate, els.mindmapLevels, els.mindmapMode, els.mindmapTemplate].forEach((el) => {
      el.addEventListener('change', collectSettings);
    });
    [els.reasoning, els.streaming, els.soundEnabled, els.autoNotes].forEach((el) => {
      el.addEventListener('change', collectSettings);
    });
    els.contextScope.addEventListener('change', updatePageCountVisibility);

    els.fetchModels.addEventListener('click', onFetchModels);
    els.modelSelect.addEventListener('change', () => {
      els.model.value = els.modelSelect.value;
      collectSettings();
    });
    els.send.addEventListener('click', onSend);
    els.stop.addEventListener('click', onStop);
    els.clearQueue.addEventListener('click', clearQueue);
    els.viewText.addEventListener('click', () => setViewMode('text'));
    els.viewMarkdown.addEventListener('click', () => setViewMode('markdown'));
    els.copyTop.addEventListener('click', () => copyResponse(els.copyTop));
    els.copyBottom.addEventListener('click', () => copyResponse(els.copyBottom));
    els.autoRun.addEventListener('click', onAutoRun);
    els.autoStop.addEventListener('click', onAutoStop);
    els.mindmapRun.addEventListener('click', onMindmapRun);
    els.mindmapStop.addEventListener('click', onMindmapStop);
    els.mindmapClear.addEventListener('click', onMindmapClear);
    els.mindmapResetTpl.addEventListener('click', () => {
      els.mindmapTemplate.value = I18N.t('ai.defaultMindmapPrompt');
      collectSettings();
    });
    els.autoResetTpl.addEventListener('click', () => {
      els.autoTemplate.value = I18N.t('ai.defaultAutoPrompt');
      collectSettings();
    });
    els.debugClear.addEventListener('click', clearDebug);
    els.testMatch.addEventListener('click', onTestMatch);
  }

  /* ---------- Fetch models ---------- */
  async function onFetchModels() {
    collectSettings();
    els.fetchModels.disabled = true;
    els.fetchModels.textContent = I18N.t('ai.fetching');
    els.status.textContent = '';
    try {
      const models = await Ollama.listModels(settings.host);
      els.modelSelect.innerHTML = '';
      if (models.length === 0) {
        els.modelSelect.innerHTML = '<option value="">' + I18N.t('ai.status.noModels') + '</option>';
      } else {
        const cur = settings.model;
        models.forEach((id) => {
          const opt = document.createElement('option');
          opt.value = id; opt.textContent = id;
          if (id === cur) opt.selected = true;
          els.modelSelect.appendChild(opt);
        });
      }
      els.modelSelect.hidden = false;
      els.status.textContent = I18N.t('ai.status.foundModels') + ' ' + models.length + ' ' + I18N.t('ai.status.models');
    } catch (err) {
      els.status.innerHTML = '⚠️ ' + escapeHtml(err.message) +
        '<br><span class="hint">' + I18N.t('ai.status.corsHintSettings') + ' ' +
        '<code>OLLAMA_ORIGINS=*</code> ' + I18N.t('ai.status.corsAllow') + '</span>';
    } finally {
      els.fetchModels.disabled = false;
      els.fetchModels.textContent = I18N.t('ai.fetchModels');
    }
  }

  /* ---------- Gather context ---------- */
  async function gatherContext() {
    const scope = els.contextScope.value;
    if (scope === 'selectedText') {
      const sel = callbacks.getSelectedText ? callbacks.getSelectedText() : '';
      if (sel && sel.trim()) return { text: sel.trim(), pages: [] };
      // fall back to current page if nothing selected
    }
    var scopeHint;
    if (scope === 'untilNextHighlight') {
      const anchor = callbacks.getLastClickedAnnotation ? callbacks.getLastClickedAnnotation() : null;
      if (anchor && callbacks.getHighlightSpan) {
        const span = await callbacks.getHighlightSpan(anchor);
        if (span && span.text && span.text.trim()) {
          return { text: span.text, pages: span.pages || [], label: span.label };
        }
      }
      // No anchor highlight (or unresolvable) — hint and fall back to pages
      scopeHint = I18N.t('ai.status.noAnchorHighlight');
      els.status.textContent = scopeHint;
    }
    const currentPage = callbacks.getCurrentPage ? callbacks.getCurrentPage() : 1;
    const total = PDFViewer.getNumPages();
    let count = 1;
    if (scope === 'entirePages') count = Math.max(1, parseInt(els.pageCount.value, 10) || 1);
    const pages = [];
    const parts = [];
    for (let i = 0; i < count; i++) {
      const p = currentPage + i;
      if (p > total) break;
      const text = callbacks.getPageText ? await callbacks.getPageText(p) : '';
      pages.push({ page: p, text });
      parts.push('--- Page ' + p + ' ---\n' + text);
    }
    return { text: parts.join('\n\n'), pages, hint: scopeHint };
  }

  /* ---------- View mode toggle ---------- */
  function setViewMode(mode) {
    if (mode === viewMode) return;
    viewMode = mode;
    els.viewText.classList.toggle('active', mode === 'text');
    els.viewMarkdown.classList.toggle('active', mode === 'markdown');
    if (mode === 'markdown') {
      // Render current response text into markdown
      els.responseMd.innerHTML = Markdown.render(els.response.textContent);
      els.response.hidden = true;
      els.responseMd.hidden = false;
    } else {
      els.response.hidden = false;
      els.responseMd.hidden = true;
    }
  }

  /* ---------- Clipboard helper (shared) ---------- */
  // Copies text; flips `btn` to a ✓ state for ~1.5s on success.
  // Falls back to execCommand('copy') for non-secure contexts (file://).
  function copyTextToClipboard(text, btn) {
    function showCopied() {
      if (!btn) return;
      var label = btn.querySelector('span');
      var original = label ? label.textContent : btn.textContent;
      btn.classList.add('copied');
      if (label) label.textContent = '✓';
      else btn.textContent = '✓';
      setTimeout(function () {
        btn.classList.remove('copied');
        if (label) label.textContent = original;
        else btn.textContent = original;
      }, 1500);
    }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showCopied(); } catch (e) {}
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  /* ---------- Copy response to clipboard ---------- */
  function copyResponse(btn) {
    var text = els.response.textContent || '';
    if (!text.trim()) return;
    copyTextToClipboard(text, btn);
  }

  /* ---------- Retry helpers ---------- */

  /**
   * Abort-aware delay: resolves after ms, but rejects immediately
   * with AbortError if the user aborts during the wait.
   */
  function abortAwareDelay(ms, ctrl) {
    ctrl = ctrl || abortController;
    return new Promise((resolve, reject) => {
      if (ctrl && ctrl.signal.aborted) {
        reject({ name: 'AbortError' });
        return;
      }
      var onAbort = function () { clearTimeout(timer); reject({ name: 'AbortError' }); };
      var timer = setTimeout(function () {
        if (ctrl) ctrl.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (ctrl) ctrl.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Call Ollama.chat with automatic retry on failure.
   * Clears partial streaming response before each retry.
   * Abort errors propagate immediately (no retry).
   */
  async function chatWithRetry(chatOpts, item) {
    var lastErr;
    var ctrl = (item && item.abortController) || abortController;
    var clearFn = (item && typeof item.onClear === 'function')
      ? item.onClear
      : function () {
          els.response.textContent = '';
          els.responseMd.innerHTML = '';
          els.thinking.textContent = '';
          els.thinking.hidden = true;
        };
    var statusEl = (item && item.statusEl) || els.status;
    var id = (item && item.id != null) ? item.id : '?';
    var label = (item && item.label) ? (' (' + item.label + ')') : '';
    for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (ctrl && ctrl.signal.aborted) throw { name: 'AbortError' };
      // Clear partial response on retry
      if (attempt > 1) {
        clearFn();
        debugLog('INFO', '#' + id + label + ' retry attempt ' + attempt + '/' + MAX_RETRIES);
        statusEl.textContent = '⚠️ Retry ' + attempt + '/' + MAX_RETRIES + ' — ' +
          I18N.t('ai.status.generating') + ' #' + id + '…';
      }
      try {
        return await Ollama.chat(chatOpts);
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        lastErr = err;
        debugLog('ERR', '#' + id + label + ' attempt ' + attempt + '/' + MAX_RETRIES +
          ' failed — ' + (err.message || err));
        if (attempt < MAX_RETRIES) {
          statusEl.innerHTML = '⚠️ ' + escapeHtml(err.message || '') +
            ' — retrying in ' + (RETRY_DELAY_MS / 1000) + 's (' +
            attempt + '/' + MAX_RETRIES + ')…';
          await abortAwareDelay(RETRY_DELAY_MS, ctrl);
        }
      }
    }
    throw lastErr;
  }

  /* ---------- Send (with queue) ---------- */
  async function onSend() {
    collectSettings();
    if (!settings.model) {
      els.status.textContent = I18N.t('ai.status.setModel');
      return;
    }

    // Gather context NOW (captures current page/selection state)
    els.status.textContent = isProcessing
      ? I18N.t('ai.status.queuing')
      : I18N.t('ai.status.gathering');
    const ctx = await gatherContext();
    const pdfCtx = settings.pdfContext && settings.pdfContext.trim()
      ? settings.pdfContext.trim()
      : '';
    const prompt = settings.promptTemplate
      .replace(/\$pdfContext/g, pdfCtx)
      .replace(/\$text/g, ctx.text);
    const messages = [];
    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      messages.push({ role: 'system', content: settings.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    // Build a human-readable label for this action
    let label;
    if (ctx.label) {
      label = ctx.label;
    } else if (ctx.pages.length > 0) {
      label = ctx.pages.length === 1
        ? 'Page ' + ctx.pages[0].page
        : 'Pages ' + ctx.pages.map((p) => p.page).join(',');
    } else {
      label = 'Selected text';
    }

    const item = { id: ++queueIdCounter, messages, label, hint: ctx.hint || '' };

    if (!isProcessing) {
      // Execute immediately
      processQueueItem(item);
    } else {
      // Add to queue
      queue.push(item);
      updateQueueUI();
      els.status.textContent = 'Queued #' + item.id + ' (' + label + ') — position ' + queue.length;
      playQueueSound();
    }
  }

  async function processQueueItem(item) {
    isProcessing = true;
    els.send.disabled = false; // Stay enabled so user can queue more
    els.send.textContent = 'Send';
    els.stop.hidden = false;
    updateQueueUI();

    // Clear response for new item
    els.response.textContent = '';
    els.responseMd.innerHTML = '';
    els.thinking.textContent = '';
    els.thinking.hidden = true;

    abortController = new AbortController();
    try {
      els.status.textContent = (item.hint ? item.hint + ' ' : '') +
        I18N.t('ai.status.generating') + ' #' + item.id + ' (' + item.label + ')…';
      const result = await chatWithRetry({
        host: settings.host,
        model: settings.model,
        messages: item.messages,
        stream: settings.streaming,
        maxTokens: settings.maxTokens,
        numCtx: settings.numCtx,
        think: settings.reasoning,
        signal: abortController.signal,
        onChunk: (c) => {
          els.response.textContent += c;
          if (viewMode === 'markdown') {
            els.responseMd.innerHTML = Markdown.render(els.response.textContent);
          }
        },
        onThinking: (t) => {
          els.thinking.hidden = false;
          els.thinking.textContent += t;
        },
        onStats: (s) => {
          debugLog('REQ', '#' + item.id + ' POST ' + s.url + ' | model=' + s.model +
            ' | stream=' + s.stream + ' | think=' + s.think +
            ' | maxTokens=' + s.maxTokens + ' | numCtx=' + s.numCtx +
            ' | messages=' + s.messageCount + ' | promptLen=' + s.requestLength);
          debugLog('BODY', s.requestBody);
          debugLog('RESP', '#' + item.id + ' Response length: ' + s.responseLength + ' chars', s.responseText);
          debugLog('TIME', '#' + item.id + ' First token: ' + formatMs(s.timeToFirstTokenMs) +
            ' | Total: ' + formatMs(s.totalTimeMs));
        },
      }, item);
      if (!settings.streaming) els.response.textContent = result;
      els.responseMd.innerHTML = Markdown.render(els.response.textContent);
      els.status.textContent = '✓ ' + I18N.t('ai.status.done') + ' #' + item.id + ' (' + item.label + ')';
      playCompletionSound();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        els.status.textContent = I18N.t('ai.status.stopped') + ' #' + item.id + '.';
      } else {
        debugLog('ERR', '#' + item.id + ' all ' + MAX_RETRIES + ' attempts failed — ' + (err.message || err));
        els.status.innerHTML = '⚠️ #' + item.id + ' failed after ' + MAX_RETRIES + ' retries: ' +
          escapeHtml(err.message || '') +
          '<br><span class="hint">' + I18N.t('ai.status.corsHint') + ' ' +
          '<code>OLLAMA_ORIGINS=*</code>.</span>';
        playErrorSound();
      }
    } finally {
      abortController = null;
    }

    // Process next item or finish
    if (queue.length > 0 && !abortController) {
      const next = queue.shift();
      updateQueueUI();
      processQueueItem(next);
    } else {
      isProcessing = false;
      els.stop.hidden = true;
      updateQueueUI();
    }
  }

  function onStop() {
    if (abortController) abortController.abort();
    // Also clear the queue
    if (queue.length > 0) {
      queue = [];
      updateQueueUI();
    }
  }

  function clearQueue() {
    const n = queue.length;
    queue = [];
    updateQueueUI();
    if (n > 0) els.status.textContent = I18N.t('msg.cleared') + ' ' + n + ' ' + I18N.t('msg.queued') + '.';
  }

  function updateQueueUI() {
    const n = queue.length;
    if (els.queueBadge) {
      els.queueBadge.textContent = n;
      els.queueBadge.hidden = n === 0;
    }
    if (els.clearQueue) {
      els.clearQueue.hidden = n === 0;
    }
  }

  /* ---------- Sound (Web Audio API, no external files) ---------- */
  function ensureAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }

  function playCompletionSound() {
    if (!settings.soundEnabled) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      // Pleasant two-note rising chime
      const now = ctx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.12;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    } catch (e) { /* ignore */ }
  }

  function playQueueSound() {
    if (!settings.soundEnabled) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      // Short soft click
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) { /* ignore */ }
  }

  function playErrorSound() {
    if (!settings.soundEnabled) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      // Low buzz
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) { /* ignore */ }
  }

  /* ---------- Mindmap ---------- */
  let mindmapAbort = null;

  /**
   * Build the mindmap prompt from the template.
   * Placeholders:
   *   $maxLevels       — instruction for depth limit (empty when not set)
   *   $currentMindmap  — the current mindmap text to continue/complete (empty on first run)
   *   $pdfContext      — optional background context
   *   $text            — the page text
   */
  function buildMindmapPrompt(text, maxLevels, currentMindmap, pdfContext, template) {
    const levelsLine = maxLevels && maxLevels > 0
      ? 'Limit the mindmap to at most ' + maxLevels + ' level(s) of depth (the central topic is level 1).'
      : '';
    const mapLine = currentMindmap && currentMindmap.trim()
      ? 'Here is the current mindmap. Continue and COMPLETE it by adding more topics and subtopics. ' +
        'Return the FULL mindmap (include the existing topics plus the new ones), still following the 4-space indentation rule:\n\n' +
        currentMindmap.trim()
      : '';
    const ctx = pdfContext && pdfContext.trim() ? pdfContext.trim() : '';
    const tmpl = (template && template.trim()) ? template.trim() : I18N.t('ai.defaultMindmapPrompt');
    return tmpl
      .replace(/\$maxLevels/g, levelsLine)
      .replace(/\$currentMindmap/g, mapLine)
      .replace(/\$pdfContext/g, ctx)
      .replace(/\$text/g, text);
  }

  /**
   * Split the gathered context into one or more iterations.
   * - 'all' mode: a single iteration with the combined page text.
   * - 'perPage' mode: one iteration per page, carrying the mindmap forward so
   *   each page improves on the previous one.
   * Falls back to a single iteration for selected-text or single-page ranges.
   * Returns [{text, label}].
   */
  function buildMindmapIterations(ctx, mode) {
    if (mode === 'perPage' && ctx.pages.length > 1) {
      return ctx.pages.map((pg, i) => ({
        text: pg.text,
        label: 'Page ' + pg.page + ' (' + (i + 1) + '/' + ctx.pages.length + ')',
      }));
    }
    let label;
    if (ctx.pages.length > 0) {
      label = ctx.pages.length === 1
        ? 'Page ' + ctx.pages[0].page
        : 'Pages ' + ctx.pages.map((p) => p.page).join(',');
    } else {
      label = 'Selected text';
    }
    return [{ text: ctx.text, label: label }];
  }

  async function onMindmapRun() {
    collectSettings();
    if (!settings.model) {
      els.mindmapStatus.textContent = I18N.t('ai.status.setModel');
      return;
    }
    if (mindmapAbort) return; // already running

    els.mindmapRun.disabled = true;
    els.mindmapStop.hidden = false;

    const maxLevels = settings.mindmapMaxLevels ? parseInt(settings.mindmapMaxLevels, 10) : null;
    const mode = settings.mindmapMode === 'perPage' ? 'perPage' : 'all';

    try {
      els.mindmapStatus.textContent = I18N.t('ai.mindmapStatus.generating');
      const ctx = await gatherContext();
      const iterations = buildMindmapIterations(ctx, mode);

      mindmapAbort = new AbortController();

      for (let i = 0; i < iterations.length; i++) {
        if (mindmapAbort.signal.aborted) break;
        const it = iterations[i];

        // The current mindmap is carried over from the output (edited by the user
        // or produced by the previous page iteration) and sent to the AI to
        // complete/improve.
        const currentMindmap = els.mindmapOutput.value || '';

        // Debug: show the actual current mindmap being sent to the AI
        debugLog('MAP', it.label + ': current mindmap sent to AI (' + currentMindmap.length + ' chars)',
          currentMindmap && currentMindmap.trim() ? currentMindmap : '(empty — generating a new mindmap)');

        els.mindmapStatus.textContent = iterations.length > 1
          ? I18N.t('ai.mindmapStatus.generating') + ' ' + it.label
          : I18N.t('ai.mindmapStatus.generating');

        const prompt = buildMindmapPrompt(it.text, maxLevels, currentMindmap, settings.pdfContext, settings.mindmapTemplate);
        const messages = [];
        if (settings.systemPrompt && settings.systemPrompt.trim()) {
          messages.push({ role: 'system', content: settings.systemPrompt.trim() });
        }
        messages.push({ role: 'user', content: prompt });

        els.mindmapOutput.value = '';
        try {
          const result = await chatWithRetry({
            host: settings.host,
            model: settings.model,
            messages,
            stream: settings.streaming,
            maxTokens: settings.maxTokens,
            numCtx: settings.numCtx,
            think: settings.reasoning,
            signal: mindmapAbort.signal,
            onChunk: (c) => { els.mindmapOutput.value += c; },
            onStats: (s) => {
              debugLog('REQ', 'Mindmap (' + it.label + '): POST ' + s.url + ' | model=' + s.model +
                ' | stream=' + s.stream + ' | think=' + s.think +
                ' | maxTokens=' + s.maxTokens + ' | numCtx=' + s.numCtx +
                ' | messages=' + s.messageCount + ' | promptLen=' + s.requestLength);
              debugLog('BODY', s.requestBody);
              debugLog('RESP', 'Mindmap (' + it.label + '): response length ' + s.responseLength + ' chars', s.responseText);
              debugLog('TIME', 'Mindmap (' + it.label + '): first token ' + formatMs(s.timeToFirstTokenMs) +
                ' | total ' + formatMs(s.totalTimeMs));
            },
          }, {
            id: 'mindmap',
            label: it.label,
            abortController: mindmapAbort,
            statusEl: els.mindmapStatus,
            onClear: function () { els.mindmapOutput.value = ''; },
          });
          if (!settings.streaming) els.mindmapOutput.value = result;
          // The improved mindmap now lives in the output and becomes the
          // "current mindmap" for the next page iteration.
        } catch (err) {
          // Restore the mindmap we had before this iteration so work isn't lost
          if (currentMindmap) els.mindmapOutput.value = currentMindmap;
          throw err;
        }
      }

      if (mindmapAbort.signal.aborted) {
        els.mindmapStatus.textContent = I18N.t('ai.mindmapStatus.stopped');
      } else {
        els.mindmapStatus.textContent = '✓ ' + I18N.t('ai.mindmapStatus.done');
        playCompletionSound();
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        els.mindmapStatus.textContent = I18N.t('ai.mindmapStatus.stopped');
      } else {
        debugLog('ERR', 'Mindmap: all ' + MAX_RETRIES + ' attempts failed — ' + (err.message || err));
        els.mindmapStatus.innerHTML = '⚠️ ' + escapeHtml(err.message || '');
        playErrorSound();
      }
    } finally {
      mindmapAbort = null;
      els.mindmapRun.disabled = false;
      els.mindmapStop.hidden = true;
    }
  }

  function onMindmapStop() {
    if (mindmapAbort) mindmapAbort.abort();
  }

  function onMindmapClear() {
    els.mindmapOutput.value = '';
    els.mindmapStatus.textContent = I18N.t('ai.mindmapStatus.empty');
    debugLog('MAP', 'Mindmap cleared by user');
  }

  /* ---------- Auto-annotate ---------- */
  function onAutoRun() {
    collectSettings();
    if (!settings.model) {
      els.autoStatus.textContent = I18N.t('ai.status.setModel');
      return;
    }
    els.autoRun.disabled = true;
    els.autoStop.hidden = false;
    els.autoStatus.textContent = I18N.t('auto.starting');
    const howMany = settings.howManyAnnotations ? parseInt(settings.howManyAnnotations, 10) : null;
    gatherContext().then((ctx) => {
      if (ctx.pages.length === 0 && ctx.text) {
        // selectedText mode — annotate current page
        const cp = callbacks.getCurrentPage ? callbacks.getCurrentPage() : 1;
        ctx.pages = [{ page: cp, text: ctx.text }];
      }
      if (callbacks.onAutoAnnotate) {
        callbacks.onAutoAnnotate({
          howMany: howMany && howMany > 0 ? howMany : null,
          includeNotes: settings.includeNotes,
          promptTemplate: settings.autoAnnotateTemplate,
          pdfContext: settings.pdfContext,
          pages: ctx.pages,
        });
      }
    });
  }

  function onAutoStop() {
    if (callbacks.onAutoAnnotate) callbacks.onAutoAnnotate({ abort: true });
  }

  function setAutoStatus(msg) { els.autoStatus.textContent = msg; }
  function setAutoDone() { els.autoRun.disabled = false; els.autoStop.hidden = true; }

  /* ---------- Debug log ---------- */
  let debugCount = 0;

  function debugLog(category, message, data) {
    if (!els.debugLog) return;
    const entry = document.createElement('div');
    entry.className = 'debug-entry';
    // Copy button for AI response entries (floats to the entry's top-right)
    if (category === 'RESP' && typeof data === 'string' && data) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'debug-copy-btn';
      copyBtn.title = I18N.t('ai.debugCopy');
      copyBtn.textContent = '📋';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyTextToClipboard(data, copyBtn);
      });
      entry.appendChild(copyBtn);
    }
    const time = new Date().toLocaleTimeString([], { hour12: false }) + '.' +
      String(Date.now() % 1000).padStart(3, '0');
    const tag = document.createElement('span');
    tag.className = 'debug-tag debug-tag-' + category;
    tag.textContent = category;
    const timeEl = document.createElement('span');
    timeEl.className = 'debug-time';
    timeEl.textContent = ' ' + time;
    const msg = document.createElement('span');
    msg.textContent = ' ' + message;
    entry.appendChild(tag);
    entry.appendChild(timeEl);
    entry.appendChild(msg);
    if (data !== undefined) {
      const dataEl = document.createElement('span');
      dataEl.className = 'debug-data';
      dataEl.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      entry.appendChild(dataEl);
    }
    els.debugLog.appendChild(entry);
    debugCount++;
    if (els.debugBadge) {
      els.debugBadge.textContent = debugCount;
      els.debugBadge.hidden = false;
    }
    if (els.debugAutoScroll && els.debugAutoScroll.checked) {
      els.debugLog.scrollTop = els.debugLog.scrollHeight;
    }
  }

  function clearDebug() {
    if (els.debugLog) els.debugLog.innerHTML = '';
    debugCount = 0;
    if (els.debugBadge) els.debugBadge.hidden = true;
  }

  /* ---------- Test Matching (manual debug tool) ---------- */
  function onTestMatch() {
    const pdfText = els.testPdfText.value.trim();
    const aiJson = els.testAiJson.value.trim();

    if (!pdfText) {
      debugLog('TEST', '⚠️ PDF text is empty. Paste some text first.');
      return;
    }
    if (!aiJson) {
      debugLog('TEST', '⚠️ AI JSON is empty. Paste an AI response first.');
      return;
    }

    debugLog('TEST', 'Starting test match', {
      pdfTextLength: pdfText.length + ' chars',
      pdfTextPreview: pdfText.length > 120 ? pdfText.slice(0, 120) + '…' : pdfText,
    });

    // Parse passages using the same logic as auto-annotate
    const passages = AutoAnnotate.parsePassages(aiJson);
    debugLog('TEST', 'Parsed ' + passages.length + ' passage(s) from AI JSON');
    if (passages.length === 0) {
      debugLog('TEST', '⚠️ No passages parsed. Check your JSON format. Expected: [{"text": "...", "note": "..."}]');
      return;
    }

    // Build a minimal text index from plain text (no PDF.js items needed for matching)
    const idx = { full: pdfText, charMap: [], items: [] };

    let matched = 0;
    let unmatched = 0;

    for (let i = 0; i < passages.length; i++) {
      const p = passages[i];
      const snippet = (p.text || '').trim();
      if (!snippet) continue;

      const preview = '"' + snippet.slice(0, 80) + (snippet.length > 80 ? '…' : '') + '"';
      debugLog('TEST', '─── Passage ' + (i + 1) + '/' + passages.length + ': ' + preview);

      const range = TextGeometry.findSnippetRange(idx, snippet, (info) => {
        if (info.type === 'fuzzy-start') {
          debugLog('FUZZY', 'Strategies 1-3 failed, attempting fuzzy match', {
            aiOriginal: info.aiOriginal,
            aiStripped: info.aiStripped,
            aiWords: info.aiWordCount,
            pdfWords: info.pdfWordCount,
          });
        } else if (info.type === 'fuzzy-match') {
          debugLog('FUZZY', 'FUZZY MATCH (score=' + info.score.toFixed(2) +
            ', ' + info.matchedWords + '/' + info.totalAiWords + ' words, ' + info.skips + ' skips)', {
            score: info.score,
            matchedWords: info.matchedWords + '/' + info.totalAiWords,
            skips: info.skips,
            skippedAiWords: info.skippedAiWords,
            pdfMatchedRegion: info.pdfMatchedRegion,
            pdfMatchedStripped: info.pdfMatchedStripped,
          });
        } else if (info.type === 'fuzzy-no-match') {
          debugLog('FUZZY', 'Fuzzy match failed — ' + info.reason, {
            aiWordCount: info.aiWordCount,
            maxSkips: info.maxSkips,
          });
        } else if (info.type === 'fuzzy-reject') {
          debugLog('FUZZY', 'Fuzzy match rejected — ' + info.reason);
        }
      });

      if (range) {
        matched++;
        const matchedText = pdfText.slice(range.start, range.end);
        debugLog('TEST', '✓ MATCHED (score=' + range.score.toFixed(2) + ', chars ' + range.start + '-' + range.end + ')', {
          matchedText: matchedText.length > 200 ? matchedText.slice(0, 200) + '…' : matchedText,
        });
      } else {
        unmatched++;
        debugLog('TEST', '✗ NO MATCH (all strategies failed)');
      }
    }

    debugLog('TEST', '═══ Test complete: ' + matched + ' matched, ' + unmatched + ' unmatched, ' + passages.length + ' total ═══');
  }

  function formatMs(ms) {
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  /* ---------- Helpers ---------- */
  function escapeHtml(s) {
    const map = {};
    map[38] = '&' + 'amp;';
    map[60] = '&' + 'lt;';
    map[62] = '&' + 'gt;';
    map[34] = '&' + 'quot;';
    map[39] = '&' + '#39;';
    return String(s).replace(/[&<>"']/g, (c) => map[c.charCodeAt(0)] || c);
  }

  return { init, getSettings, callbacks, setAutoStatus, setAutoDone, debugLog };
})();
