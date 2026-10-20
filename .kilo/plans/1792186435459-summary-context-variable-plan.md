# Plan: `$summaryContext` prompt-template variable (per-page summaries)

## Goal
Add a new optional **Summary Context** textarea to the AI panel. The user pastes page-indexed entries in this format:

```
---
277
PART V: WIDENING THE CIRCLE
---
278
PART V: WIDENING THE CIRCLE
CHAPTER FOURTEEN: Dialogue and the New Economy
---
```

Format: `---` separator line, page number on the next line, then multiline text.

A new **`$summaryContext`** placeholder is substituted in **all three templates** (Send prompt, Mindmap, Auto-Annotate — user confirmed) with the entries whose page numbers match the pages of the current request. Empty/unmatched → substituted with `''` (same behavior as `$pdfContext`).

## Resolved decisions
- Substitution scope: Send + Mindmap + Auto-Annotate (user picked "All templates").
- Persisted in settings like `pdfContext` (localStorage, key `summaryContext`, default `''`).
- Output block format mirrors the input: `---\n<page>\n<text>`, blocks joined by `\n`; only pages present in the request are emitted, in request order, duplicates skipped.
- `selectedText` scope (empty `pages`) falls back to the current page.
- Blocks whose first line is not a valid integer page number are dropped silently.
- New substitution uses function-form replacement (`.replace(re, () => value)`) so `$` sequences in the user's summary text (e.g. `$&`) are not interpreted; existing `$pdfContext`/`$text` behavior untouched.
- The variable is opt-in: default prompt templates are NOT changed.

## Files
- `index.html` — new textarea + hint; extend the placeholders hint line
- `js/ai-panel.js` — settings, element caching, persistence, parse/build helpers, `onSend`, `onMindmapRun`/`buildMindmapIterations`/`buildMindmapPrompt`, `onAutoRun`
- `js/auto-annotate.js` — accept per-page summary block, substitute in `buildPrompt`
- `js/i18n.js` — new keys (en + pt-BR)
- `README.md` — document the variable and format

## Tasks

### 1. `js/ai-panel.js` — settings + helpers
1. `DEFAULT_SETTINGS`: add `summaryContext: ''`.
2. `cacheEls`: `els.summaryContext = $('aiSummaryContext')`.
3. `applySettingsToUI`: `els.summaryContext.value = settings.summaryContext;`
4. `collectSettings`: `settings.summaryContext = els.summaryContext.value;`
5. `bindEvents`: add `els.summaryContext` to the change-persist array.
6. New helpers (near `gatherContexts`):
   - `parseSummaryContext(raw)` → `Map<page, text>`: split on `/\r?\n/`; lines that trim to `---` flush the current block; a block opens when `page == null` and `parseInt(line, 10)` is valid; remaining lines accumulate; flush at end. Invalid/dropped blocks are ignored.
   - `summaryBlock(map, page)` → `''` or `'---\n' + page + '\n' + text` (text trimmed).
   - `buildSummaryContext(map, pages)` → for `pages` (`[{page}]`, may be empty): when empty use `[callbacks.getCurrentPage() || 1]`; emit `summaryBlock` per unique page (skip pages already emitted or missing from the map); join with `'\n'`.

### 2. `js/ai-panel.js` — Send path
In `onSend`: `const summaryMap = parseSummaryContext(settings.summaryContext);` and inside the `items.map((ctx) => …)` builder:
```js
const summaryCtx = buildSummaryContext(summaryMap, ctx.pages);
const prompt = settings.promptTemplate
  .replace(/\$pdfContext/g, pdfCtx)
  .replace(/\$summaryContext/g, () => summaryCtx)
  .replace(/\$text/g, ctx.text);
```
Each queued segment gets only its own pages' summaries.

### 3. `js/ai-panel.js` — Mindmap
1. `buildMindmapIterations(ctx, mode)`: also return `pages` per iteration — `perPage`: `[pg.page]`; `all`/fallback: unique `ctx.pages` page numbers in order.
2. `buildMindmapPrompt(text, maxLevels, currentMindmap, pdfContext, summaryCtx, template)`: add `.replace(/\$summaryContext/g, () => summaryCtx || '')` next to the `$pdfContext` replace.
3. `onMindmapRun`: parse `summaryMap` once; per iteration pass `buildSummaryContext(summaryMap, it.pages)` as `summaryCtx`.

### 4. `js/auto-annotate.js` + `js/ai-panel.js` — Auto-Annotate
1. `onAutoRun` (ai-panel.js): parse `summaryMap` once and add `summaryMap` to the `callbacks.onAutoAnnotate({ … })` opts.
2. `auto-annotate.js` (~line 141): at the per-page `buildPrompt(pg.text, …)` call site, compute `const summaryBlock = opts.summaryMap ? (opts.summaryMap.get(pg.page) ? '---\n' + pg.page + '\n' + opts.summaryMap.get(pg.page) : '') : '';` and pass it.
3. `buildPrompt(pageText, howMany, includeNotes, template, pdfContext, summaryBlock)`: add `.replace(/\$summaryContext/g, () => summaryBlock || '')`.

### 5. `index.html`
1. After the "PDF Context (optional)" `details.ai-subsection` (line ~169-175), add:
   - `<details class="ai-subsection">` with `<summary data-i18n="ai.summaryContext">Summary Context (optional)</summary>`
   - `<textarea id="aiSummaryContext" rows="4" data-i18n-placeholder="ai.summaryContextPlaceholder" placeholder="…format example…">`
   - hint `<p>`: `data-i18n="ai.summaryContextHint"` + `<code>$summaryContext</code>`
2. Extend the placeholders hint line (~line 179) with `<code>$summaryContext</code> <span data-i18n="ai.promptHintSummary">(page summaries)</span>`.

### 6. `js/i18n.js` (en + pt-BR, next to the `ai.pdfContext*` keys)
- `ai.summaryContext`: `'Summary Context (optional)'` / `'Contexto de Resumo (opcional)'`
- `ai.summaryContextPlaceholder`: format example — `'---\n277\nPART V: WIDENING THE CIRCLE\n---\n278\nPART V…'` / pt-BR equivalent
- `ai.summaryContextHint`: `'Entries matching the request's pages, injected via'` / `'Entradas das páginas da requisição, injetadas via'`
- `ai.promptHintSummary`: `'(page summaries)'` / `'(resumos por página)'`

### 7. `README.md`
In "Prompt Panel": document the Summary Context textarea (format: `---`, page number, multiline text), the `$summaryContext` placeholder supported by Send, Mindmap and Auto-Annotate templates, and that only pages present in the request are injected (empty when nothing matches).

## Edge cases
- Scope `selectedText` → `pages` empty → current page's entry (if any).
- Segment contexts (empty highlights-ahead) → each queue item carries only its own segment's page entries.
- Mindmap "all" mode over merged segments → duplicate page numbers emitted once.
- Textarea empty or no matching pages → `$summaryContext` becomes `''`.
- Block with non-numeric page line → dropped; text before the first `---` with a numeric first line is accepted as a block.
- CRLF input handled (`/\r?\n/` split).

## Validation (user performs manually; agent runs `node --check` on the two JS files only)
1. Paste the example TOC; prompt template containing `$summaryContext`; scope Entire current page on page 277 → Debug BODY shows only the 277 block. Page 300 (no entry) → `$summaryContext` empty.
2. Multiple pages / highlight segments → each request shows only its pages' blocks.
3. Mindmap (both modes) and Auto-Annotate templates with `$summaryContext` → per-page/merged blocks as specified.
4. pt-BR language → new labels/hints translated; textarea content persists after reload.
