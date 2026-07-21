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
  };

  let settings = { ...DEFAULT_SETTINGS };
  let els = {};
  let abortController = null;
  let viewMode = 'text'; // 'text' | 'markdown'

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
    els.thinking = $('aiThinking');
    els.status = $('aiStatus');
    els.autoHowMany = $('aiAutoHowMany');
    els.autoNotes = $('aiAutoNotes');
    els.autoTemplate = $('aiAutoTemplate');
    els.autoResetTpl = $('aiAutoResetTpl');
    els.autoRun = $('aiAutoRun');
    els.autoStop = $('aiAutoStop');
    els.autoStatus = $('aiAutoStatus');
    els.debugLog = $('aiDebugLog');
    els.debugClear = $('aiDebugClear');
    els.debugBadge = $('aiDebugBadge');
    els.debugAutoScroll = $('aiDebugAutoScroll');
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
     els.autoTemplate].forEach((el) => {
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
    els.autoRun.addEventListener('click', onAutoRun);
    els.autoStop.addEventListener('click', onAutoStop);
    els.autoResetTpl.addEventListener('click', () => {
      els.autoTemplate.value = I18N.t('ai.defaultAutoPrompt');
      collectSettings();
    });
    els.debugClear.addEventListener('click', clearDebug);
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
    return { text: parts.join('\n\n'), pages };
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
    if (ctx.pages.length > 0) {
      label = ctx.pages.length === 1
        ? 'Page ' + ctx.pages[0].page
        : 'Pages ' + ctx.pages.map((p) => p.page).join(',');
    } else {
      label = 'Selected text';
    }

    const item = { id: ++queueIdCounter, messages, label };

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
      els.status.textContent = I18N.t('ai.status.generating') + ' #' + item.id + ' (' + item.label + ')…';
      const result = await Ollama.chat({
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
          debugLog('RESP', '#' + item.id + ' Response length: ' + s.responseLength + ' chars');
          debugLog('TIME', '#' + item.id + ' First token: ' + formatMs(s.timeToFirstTokenMs) +
            ' | Total: ' + formatMs(s.totalTimeMs));
        },
      });
      if (!settings.streaming) els.response.textContent = result;
      els.responseMd.innerHTML = Markdown.render(els.response.textContent);
      els.status.textContent = '✓ ' + I18N.t('ai.status.done') + ' #' + item.id + ' (' + item.label + ')';
      playCompletionSound();
    } catch (err) {
      if (err.name === 'AbortError') {
        els.status.textContent = I18N.t('ai.status.stopped') + ' #' + item.id + '.';
      } else {
        els.status.innerHTML = '⚠️ #' + item.id + ' ' + escapeHtml(err.message) +
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
