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
    contextScope: 'entirePage',
    pageCount: 1,
    promptTemplate: 'Summarize the key points of the following text:\n\n$text',
    includeNotes: true,
    howManyAnnotations: '',
  };

  let settings = { ...DEFAULT_SETTINGS };
  let els = {};
  let abortController = null;

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
    els.promptTemplate = $('aiPromptTemplate');
    els.contextScope = $('aiContextScope');
    els.pageCount = $('aiPageCount');
    els.pageCountWrap = $('aiPageCountWrap');
    els.send = $('aiSend');
    els.stop = $('aiStop');
    els.response = $('aiResponse');
    els.thinking = $('aiThinking');
    els.status = $('aiStatus');
    els.autoHowMany = $('aiAutoHowMany');
    els.autoNotes = $('aiAutoNotes');
    els.autoRun = $('aiAutoRun');
    els.autoStop = $('aiAutoStop');
    els.autoStatus = $('aiAutoStatus');
  }

  function applySettingsToUI() {
    els.host.value = settings.host;
    els.model.value = settings.model;
    els.maxTokens.value = settings.maxTokens;
    els.numCtx.value = settings.numCtx;
    els.reasoning.checked = settings.reasoning;
    els.streaming.checked = settings.streaming;
    els.promptTemplate.value = settings.promptTemplate;
    els.contextScope.value = settings.contextScope;
    els.pageCount.value = settings.pageCount;
    els.autoHowMany.value = settings.howManyAnnotations;
    els.autoNotes.checked = settings.includeNotes;
    updatePageCountVisibility();
  }

  function collectSettings() {
    settings.host = els.host.value.trim() || DEFAULT_SETTINGS.host;
    settings.model = els.model.value.trim();
    settings.maxTokens = parseInt(els.maxTokens.value, 10) || 2048;
    settings.numCtx = parseInt(els.numCtx.value, 10) || 8192;
    settings.reasoning = els.reasoning.checked;
    settings.streaming = els.streaming.checked;
    settings.promptTemplate = els.promptTemplate.value;
    settings.contextScope = els.contextScope.value;
    settings.pageCount = parseInt(els.pageCount.value, 10) || 1;
    settings.howManyAnnotations = els.autoHowMany.value.trim();
    settings.includeNotes = els.autoNotes.checked;
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
     els.contextScope, els.pageCount, els.autoHowMany].forEach((el) => {
      el.addEventListener('change', collectSettings);
    });
    [els.reasoning, els.streaming, els.autoNotes].forEach((el) => {
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
    els.autoRun.addEventListener('click', onAutoRun);
    els.autoStop.addEventListener('click', onAutoStop);
  }

  /* ---------- Fetch models ---------- */
  async function onFetchModels() {
    collectSettings();
    els.fetchModels.disabled = true;
    els.fetchModels.textContent = 'Fetching…';
    els.status.textContent = '';
    try {
      const models = await Ollama.listModels(settings.host);
      els.modelSelect.innerHTML = '';
      if (models.length === 0) {
        els.modelSelect.innerHTML = '<option value="">No models found</option>';
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
      els.status.textContent = 'Found ' + models.length + ' model(s).';
    } catch (err) {
      els.status.innerHTML = '⚠️ ' + escapeHtml(err.message) +
        '<br><span class="hint">Make sure Ollama is running and started with ' +
        '<code>OLLAMA_ORIGINS=*</code> to allow browser access.</span>';
    } finally {
      els.fetchModels.disabled = false;
      els.fetchModels.textContent = 'Fetch Models';
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

  /* ---------- Send (prompt template) ---------- */
  async function onSend() {
    collectSettings();
    if (!settings.model) {
      els.status.textContent = '⚠️ Please set a model first.';
      return;
    }
    els.response.textContent = '';
    els.thinking.textContent = '';
    els.thinking.hidden = true;
    els.status.textContent = 'Gathering context…';
    els.send.disabled = true;
    els.send.textContent = 'Generating…';
    els.stop.hidden = false;

    abortController = new AbortController();
    try {
      const ctx = await gatherContext();
      const prompt = settings.promptTemplate.replace(/\$text/g, ctx.text);
      els.status.textContent = 'Waiting for Ollama…';
      const result = await Ollama.chat({
        host: settings.host,
        model: settings.model,
        messages: [{ role: 'user', content: prompt }],
        stream: settings.streaming,
        maxTokens: settings.maxTokens,
        numCtx: settings.numCtx,
        think: settings.reasoning,
        signal: abortController.signal,
        onChunk: (c) => { els.response.textContent += c; },
        onThinking: (t) => {
          els.thinking.hidden = false;
          els.thinking.textContent += t;
        },
      });
      if (!settings.streaming) els.response.textContent = result;
      els.status.textContent = 'Done.';
    } catch (err) {
      if (err.name === 'AbortError') {
        els.status.textContent = 'Stopped.';
      } else {
        els.status.innerHTML = '⚠️ ' + escapeHtml(err.message) +
          '<br><span class="hint">If this is a CORS error, start Ollama with ' +
          '<code>OLLAMA_ORIGINS=*</code>.</span>';
      }
    } finally {
      els.send.disabled = false;
      els.send.textContent = 'Send';
      els.stop.hidden = true;
      abortController = null;
    }
  }

  function onStop() {
    if (abortController) abortController.abort();
  }

  /* ---------- Auto-annotate ---------- */
  function onAutoRun() {
    collectSettings();
    if (!settings.model) {
      els.autoStatus.textContent = '⚠️ Please set a model first.';
      return;
    }
    els.autoRun.disabled = true;
    els.autoStop.hidden = false;
    els.autoStatus.textContent = 'Starting…';
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

  return { init, getSettings, callbacks, setAutoStatus, setAutoDone };
})();
