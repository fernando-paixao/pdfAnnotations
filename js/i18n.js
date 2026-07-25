/* ============================================================
   i18n.js — Internationalization (en + pt-BR)
   Exposes global: I18N
   Usage: I18N.t('key'), I18N.setLang('pt-BR'), I18N.applyTranslations(rootEl)
   ============================================================ */
const I18N = (() => {
  const LANG_KEY = 'pdf-ann-lang';

  const translations = {
    'en': {
      // Toolbar
      'toolbar.openPdf': 'Open PDF',
      'toolbar.noPdf': 'No PDF loaded',
      'toolbar.findInPdf': 'Find in PDF…',
      'toolbar.prevMatch': 'Previous match (Shift+Enter)',
      'toolbar.nextMatch': 'Next match (Enter)',
      'toolbar.clearSearch': 'Clear search (Esc)',
      'toolbar.prevPage': 'Previous page',
      'toolbar.nextPage': 'Next page',
      'toolbar.zoomOut': 'Zoom out',
      'toolbar.zoomIn': 'Zoom in',
      'toolbar.export': 'Export',
      'toolbar.import': 'Import',
      'toolbar.ai': 'AI',

      // Viewer / empty state
      'viewer.openToBegin': 'Open a PDF to begin',
      'viewer.selectHint': 'Select text to highlight it and add annotations.',
      'viewer.offlineHint': 'Everything runs locally in your browser — no upload, works offline.',

      // Side panel
      'panel.annotations': 'Annotations',
      'panel.searchPlaceholder': 'Search annotations…',
      'panel.empty': 'No annotations yet. Select text in the PDF and click',
      'panel.emptyHighlight': 'Highlight',
      'panel.noMatches': 'No matches.',
      'panel.copyText': 'Copy text',

      // Namespace
      'ns.selectTitle': 'Select namespace',
      'ns.createTitle': 'Create new namespace',
      'ns.renameTitle': 'Rename namespace',
      'ns.deleteTitle': 'Delete namespace',

      // Highlight button + editor
      'editor.highlight': 'Highlight',
      'editor.notePlaceholder': 'Add a note (optional)…',
      'editor.delete': 'Delete',
      'editor.save': 'Save',

      // AI Panel
      'ai.assistant': 'AI Assistant',
      'ai.localOllama': 'Local Ollama',
      'ai.settings': 'Settings',
      'ai.host': 'Host',
      'ai.model': 'Model',
      'ai.fetchModels': 'Fetch Models',
      'ai.fetching': 'Fetching…',
      'ai.maxTokens': 'Max tokens',
      'ai.contextWindow': 'Context window',
      'ai.reasoning': 'Reasoning',
      'ai.streaming': 'Streaming',
      'ai.sound': '🔔 Sound',

      // Prompt template
      'ai.promptTemplate': 'Prompt Template',
      'ai.systemPrompt': 'System Prompt (optional)',
      'ai.systemPromptPlaceholder': 'e.g. You are a helpful assistant that analyzes PDF documents. Answer concisely.',
      'ai.systemPromptHint': 'Sent as a',
      'ai.systemPromptHint2': 'message before your prompt.',
      'ai.pdfContext': 'PDF Context (optional)',
      'ai.pdfContextPlaceholder': 'e.g. This is a research paper about quantum computing published in 2024. The author discusses…',
      'ai.pdfContextHint': 'Background info injected into your prompt via',
      'ai.promptPlaceholder': 'Write your prompt. Use $text where the PDF page text goes.',
      'ai.promptHint': 'Placeholders:',
      'ai.promptHintText': '(page text)',
      'ai.promptHintContext': '(your context above).',
      'ai.contextScope': 'Context scope',
      'ai.scope.selectedText': 'Selected text',
      'ai.scope.entirePage': 'Entire current page',
      'ai.scope.entirePages': 'Multiple pages (from current)',
      'ai.pageCount': 'Number of pages',
      'ai.send': 'Send',
      'ai.stop': 'Stop',
      'ai.clearQueue': 'Clear Queue',

      // Response
      'ai.response': 'Response',
      'ai.viewText': 'Text',
      'ai.viewMarkdown': 'Markdown',
      'ai.responseEmpty': 'Response will appear here.',

      // Auto-annotate
      'ai.autoAnnotate': 'Auto-Annotate',
      'ai.autoHint': 'AI finds the most important passages and creates highlight annotations automatically.',
      'ai.autoHowMany': 'Desired annotations (optional)',
      'ai.autoHowManyPlaceholder': 'leave empty = AI decides',
      'ai.autoNotes': 'Include notes',
      'ai.autoTemplate': 'Prompt Template',
      'ai.autoTemplatePlaceholder': 'Template is empty — the built-in default will be used.',
      'ai.autoResetTpl': 'Reset to default',
      'ai.autoRun': 'Annotate',

      // Debug
      'ai.debug': 'Debug',
      'ai.clear': 'Clear',
      'ai.autoScroll': 'Auto-scroll',
      'ai.debugEmpty': 'No debug messages yet.',

      // AI status messages
      'ai.status.setModel': '⚠️ Please set a model first.',
      'ai.status.gathering': 'Gathering context…',
      'ai.status.queuing': 'Queuing… (gathering context)',
      'ai.status.waiting': 'Waiting for Ollama…',
      'ai.status.done': 'Done.',
      'ai.status.stopped': 'Stopped.',
      'ai.status.noModels': 'No models found',
      'ai.status.foundModels': 'Found',
      'ai.status.models': 'model(s).',
      'ai.status.corsHint': 'If this is a CORS error, start Ollama with',
      'ai.status.corsHintSettings': 'Make sure Ollama is running and started with',
      'ai.status.corsAllow': 'to allow browser access.',
      'ai.status.generating': 'Generating…',

      // Auto-annotate status
      'auto.starting': 'Starting…',
      'auto.done': 'Done:',
      'auto.created': 'created,',
      'auto.unmatched': 'unmatched (of',
      'auto.total': 'total).',
      'auto.noModel': 'No AI model configured. Open the AI panel and set a model.',
      'auto.noPageText': 'No page text to annotate.',

      // Default AI prompts (placeholders stay in English)
      'ai.defaultPrompt': 'Summarize the key points of the following text:\n\n$text',
      'ai.defaultAutoPrompt': [
        'You are analyzing the text content of a PDF page.',
        'Identify the most important passages worth highlighting.',
        '$howMany',
        '',
        'CRITICAL RULES:',
        '1. The "text" value MUST be copied VERBATIM from the page text below (do not paraphrase, do not summarize).',
        '2. Return ONLY a JSON array. No markdown fences, no commentary, no prose.',
        '3. $formatLine',
        '4. Do NOT wrap the text value in quotation marks. Copy the passage exactly as it appears in the PDF.',
        '5. Use ONLY standard double quotes (") for JSON syntax. Never use single quotes (\') for JSON strings.',
        '6. Each array element must contain exactly ONE passage. Do not combine multiple quotes in one "text" value.',
        '',
        'Example of CORRECT format:',
        '[{"text": "This is a verbatim excerpt from the page.", "note": "Why it matters."}]',
        '',
        'Page text:',
        '$pageText',
      ].join('\n'),

      // Toast / prompt messages
      'msg.loading': 'Loading PDF…',
      'msg.loaded': 'annotation(s) loaded',
      'msg.annotationDeleted': 'Annotation deleted',
      'msg.exported': 'Exported',
      'msg.imported': 'Imported',
      'msg.importFailed': 'Import failed:',
      'msg.loadFailed': 'Failed to load PDF:',
      'msg.storageUnavailable': 'Storage unavailable (IndexedDB blocked)',
      'msg.aiCreated': 'AI created',
      'msg.annotation_s': 'annotation(s)',
      'msg.namespaceCreated': 'Namespace created',
      'msg.namespaceRenamed': 'Renamed to',
      'msg.namespaceDeleted': 'Namespace deleted',
      'msg.cantDeleteLast': 'Cannot delete the last namespace',
      'msg.cleared': 'Cleared',
      'msg.queued': 'queued action(s)',
      'msg.inNamespace': 'annotation(s) in',

      // Namespace prompts
      'ns.newName': 'New namespace name:',
      'ns.renamePrompt': 'Rename namespace:',
      'ns.deleteConfirm': 'Delete namespace',
      'ns.andAllAnnotations': 'and all its annotations?',
      'ns.newNamespace': 'New Namespace',
    },

    'pt-BR': {
      // Toolbar
      'toolbar.openPdf': 'Abrir PDF',
      'toolbar.noPdf': 'Nenhum PDF carregado',
      'toolbar.findInPdf': 'Buscar no PDF…',
      'toolbar.prevMatch': 'Resultado anterior (Shift+Enter)',
      'toolbar.nextMatch': 'Próximo resultado (Enter)',
      'toolbar.clearSearch': 'Limpar busca (Esc)',
      'toolbar.prevPage': 'Página anterior',
      'toolbar.nextPage': 'Próxima página',
      'toolbar.zoomOut': 'Reduzir zoom',
      'toolbar.zoomIn': 'Aumentar zoom',
      'toolbar.export': 'Exportar',
      'toolbar.import': 'Importar',
      'toolbar.ai': 'IA',

      // Viewer / empty state
      'viewer.openToBegin': 'Abra um PDF para começar',
      'viewer.selectHint': 'Selecione texto para destacá-lo e adicionar anotações.',
      'viewer.offlineHint': 'Tudo roda localmente no seu navegador — sem upload, funciona offline.',

      // Side panel
      'panel.annotations': 'Anotações',
      'panel.searchPlaceholder': 'Buscar anotações…',
      'panel.empty': 'Nenhuma anotação ainda. Selecione texto no PDF e clique em',
      'panel.emptyHighlight': 'Destacar',
      'panel.noMatches': 'Nenhuma correspondência.',
      'panel.copyText': 'Copiar texto',

      // Namespace
      'ns.selectTitle': 'Selecionar namespace',
      'ns.createTitle': 'Criar novo namespace',
      'ns.renameTitle': 'Renomear namespace',
      'ns.deleteTitle': 'Excluir namespace',

      // Highlight button + editor
      'editor.highlight': 'Destacar',
      'editor.notePlaceholder': 'Adicione uma nota (opcional)…',
      'editor.delete': 'Excluir',
      'editor.save': 'Salvar',

      // AI Panel
      'ai.assistant': 'Assistente IA',
      'ai.localOllama': 'Ollama Local',
      'ai.settings': 'Configurações',
      'ai.host': 'Host',
      'ai.model': 'Modelo',
      'ai.fetchModels': 'Buscar Modelos',
      'ai.fetching': 'Buscando…',
      'ai.maxTokens': 'Máx. tokens',
      'ai.contextWindow': 'Janela de contexto',
      'ai.reasoning': 'Raciocínio',
      'ai.streaming': 'Streaming',
      'ai.sound': '🔔 Som',

      // Prompt template
      'ai.promptTemplate': 'Modelo de Prompt',
      'ai.systemPrompt': 'Prompt de Sistema (opcional)',
      'ai.systemPromptPlaceholder': 'ex. Você é um assistente útil que analisa documentos PDF. Responda de forma concisa.',
      'ai.systemPromptHint': 'Enviado como mensagem',
      'ai.systemPromptHint2': 'antes do seu prompt.',
      'ai.pdfContext': 'Contexto do PDF (opcional)',
      'ai.pdfContextPlaceholder': 'ex. Este é um artigo sobre computação quântica publicado em 2024. O autor discute…',
      'ai.pdfContextHint': 'Informações de contexto injetadas no seu prompt via',
      'ai.promptPlaceholder': 'Escreva seu prompt. Use $text onde vai o texto da página do PDF.',
      'ai.promptHint': 'Placeholders:',
      'ai.promptHintText': '(texto da página)',
      'ai.promptHintContext': '(seu contexto acima).',
      'ai.contextScope': 'Escopo do contexto',
      'ai.scope.selectedText': 'Texto selecionado',
      'ai.scope.entirePage': 'Página atual inteira',
      'ai.scope.entirePages': 'Múltiplas páginas (a partir da atual)',
      'ai.pageCount': 'Número de páginas',
      'ai.send': 'Enviar',
      'ai.stop': 'Parar',
      'ai.clearQueue': 'Limpar Fila',

      // Response
      'ai.response': 'Resposta',
      'ai.viewText': 'Texto',
      'ai.viewMarkdown': 'Markdown',
      'ai.responseEmpty': 'A resposta aparecerá aqui.',

      // Auto-annotate
      'ai.autoAnnotate': 'Auto-Anotar',
      'ai.autoHint': 'A IA encontra as passagens mais importantes e cria anotações automaticamente.',
      'ai.autoHowMany': 'Anotações desejadas (opcional)',
      'ai.autoHowManyPlaceholder': 'vazio = IA decide',
      'ai.autoNotes': 'Incluir notas',
      'ai.autoTemplate': 'Modelo de Prompt',
      'ai.autoTemplatePlaceholder': 'Modelo vazio — o padrão será usado.',
      'ai.autoResetTpl': 'Restaurar padrão',
      'ai.autoRun': 'Anotar',

      // Debug
      'ai.debug': 'Debug',
      'ai.clear': 'Limpar',
      'ai.autoScroll': 'Auto-rolar',
      'ai.debugEmpty': 'Nenhuma mensagem de debug ainda.',

      // AI status messages
      'ai.status.setModel': '⚠️ Defina um modelo primeiro.',
      'ai.status.gathering': 'Coletando contexto…',
      'ai.status.queuing': 'Enfileirando… (coletando contexto)',
      'ai.status.waiting': 'Aguardando Ollama…',
      'ai.status.done': 'Concluído.',
      'ai.status.stopped': 'Interrompido.',
      'ai.status.noModels': 'Nenhum modelo encontrado',
      'ai.status.foundModels': 'Encontrado(s)',
      'ai.status.models': 'modelo(s).',
      'ai.status.corsHint': 'Se for um erro de CORS, inicie o Ollama com',
      'ai.status.corsHintSettings': 'Certifique-se de que o Ollama está rodando e foi iniciado com',
      'ai.status.corsAllow': 'para permitir acesso do navegador.',
      'ai.status.generating': 'Gerando…',

      // Auto-annotate status
      'auto.starting': 'Iniciando…',
      'auto.done': 'Concluído:',
      'auto.created': 'criada(s),',
      'auto.unmatched': 'sem correspondência (de',
      'auto.total': 'total).',
      'auto.noModel': 'Nenhum modelo de IA configurado. Abra o painel de IA e defina um modelo.',
      'auto.noPageText': 'Sem texto de página para anotar.',

      // Default AI prompts (placeholders stay in English)
      'ai.defaultPrompt': 'Resuma os pontos principais do seguinte texto:\n\n$text',
      'ai.defaultAutoPrompt': [
        'Você está analisando o conteúdo de texto de uma página de PDF.',
        'Identifique as passagens mais importantes que valem a pena destacar.',
        '$howMany',
        '',
        'REGRAS CRÍTICAS:',
        '1. O valor de "text" DEVE ser copiado VERBATIM (literalmente) do texto da página abaixo (não parafrasear, não resumir).',
        '2. Retorne APENAS um array JSON. Sem cercas markdown, sem comentários, sem prosa.',
        '3. $formatLine',
        '4. NÃO envolva o valor de "text" em aspas. Copie a passagem exatamente como aparece no PDF.',
        '5. Use APENAS aspas duplas padrão (") para a sintaxe JSON. Nunca use aspas simples (\') para strings JSON.',
        '6. Cada elemento do array deve conter exatamente UMA passagem. Não combine múltiplas citações em um valor "text".',
        '',
        'Exemplo de formato CORRETO:',
        '[{"text": "Este é um trecho literal da página.", "note": "Por que é importante."}]',
        '',
        'Texto da página:',
        '$pageText',
      ].join('\n'),

      // Toast / prompt messages
      'msg.loading': 'Carregando PDF…',
      'msg.loaded': 'anotação(ões) carregada(s)',
      'msg.annotationDeleted': 'Anotação excluída',
      'msg.exported': 'Exportada(s)',
      'msg.imported': 'Importada(s)',
      'msg.importFailed': 'Falha na importação:',
      'msg.loadFailed': 'Falha ao carregar PDF:',
      'msg.storageUnavailable': 'Armazenamento indisponível (IndexedDB bloqueado)',
      'msg.aiCreated': 'IA criou',
      'msg.annotation_s': 'anotação(ões)',
      'msg.namespaceCreated': 'Namespace criado',
      'msg.namespaceRenamed': 'Renomeado para',
      'msg.namespaceDeleted': 'Namespace excluído',
      'msg.cantDeleteLast': 'Não é possível excluir o último namespace',
      'msg.cleared': 'Limpo(s)',
      'msg.queued': 'ação(ões) enfileirada(s)',
      'msg.inNamespace': 'anotação(ões) em',

      // Namespace prompts
      'ns.newName': 'Nome do novo namespace:',
      'ns.renamePrompt': 'Renomear namespace:',
      'ns.deleteConfirm': 'Excluir namespace',
      'ns.andAllAnnotations': 'e todas as suas anotações?',
      'ns.newNamespace': 'Novo Namespace',
    },
  };

  let currentLang = 'en';

  function detectLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && translations[saved]) return saved;
    } catch (e) {}
    const browser = (navigator.language || 'en').toLowerCase();
    if (browser.startsWith('pt')) return 'pt-BR';
    return 'en';
  }

  function init() {
    currentLang = detectLang();
    document.documentElement.lang = currentLang;
  }

  function t(key) {
    const dict = translations[currentLang] || translations['en'];
    return dict[key] !== undefined ? dict[key] : (translations['en'][key] || key);
  }

  function getLang() { return currentLang; }

  function setLang(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.documentElement.lang = lang;
  }

  function getAvailableLangs() {
    return Object.keys(translations);
  }

  /**
   * Update all DOM elements with data-i18n / data-i18n-placeholder attributes.
   * Call after setLang() and on page load.
   */
  function applyTranslations(root) {
    const el = root || document;
    el.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      const text = t(key);
      node.textContent = text;
    });
    el.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      const key = node.getAttribute('data-i18n-placeholder');
      node.setAttribute('placeholder', t(key));
    });
    el.querySelectorAll('[data-i18n-title]').forEach((node) => {
      const key = node.getAttribute('data-i18n-title');
      node.setAttribute('title', t(key));
    });
    // Update CSS ::before content via custom properties
    const rootEl = document.documentElement;
    const esc = (s) => '"' + s.replace(/"/g, '\\"') + '"';
    rootEl.style.setProperty('--i18n-response-empty', esc(t('ai.responseEmpty')));
    rootEl.style.setProperty('--i18n-debug-empty', esc(t('ai.debugEmpty')));
  }

  init();

  return { t, getLang, setLang, applyTranslations, getAvailableLangs };
})();
