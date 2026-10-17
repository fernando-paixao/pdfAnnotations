# Plan: Enqueue per-highlight segments when "Number of highlights ahead" is empty

## Goal
With context scope **Current highlight → next highlight** and an **empty** "Number of highlights ahead" field, one click of **Send** must enqueue the whole chain of highlight-to-highlight segments instead of building one giant prompt:

- Segment 1: *current highlight* (text included) → *next highlight* (excluded)
- Segment 2: *next highlight* (text included) → *next-next highlight* (excluded)
- … continuing until the last highlight; the final segment runs to the **end of the document**

The queue must visibly contain all segments immediately after the first Send (existing queue badge, Clear Queue, and Stop behavior apply).

## Resolved decisions
- **Number values (1, 2, …) are preserved**: they keep today's single-span behavior (anchor → Nth boundary in ONE send). Only the **empty** value switches to the new enqueue-all-segments behavior.
- **Last segment boundary** = end of document (consistent with the already-shipped "empty = until the end" semantics).
- **Segments are contiguous, no overlap**: each boundary highlight is excluded from segment *i* and included (its text) as the start of segment *i+1*.
- **Auto-Annotate and Mindmap are unchanged**: they keep consuming the merged whole-span context via a compatibility wrapper (they never enqueue).
- **No anchor clicked** → existing fallback (hint + entire page), unchanged.
- Segment labels follow the mindmap perPage convention: `Highlights p.3→4 (1/12)`.

## Files
- `js/app.js` — segment-chain builder callback
- `js/ai-panel.js` — multi-context gather + multi-enqueue in `onSend`
- `js/i18n.js` — one new status key (en + pt-BR)
- `README.md` — scope bullet update

## Tasks

### 1. `js/app.js` — expose `getHighlightSegments`
Refactor inside the existing highlight-scope block (below `resolveAnnotationRange`):
1. Extract the span-slicing body of `AIPanel.callbacks.getHighlightSpan` into a helper, e.g.
   `sliceSpan(fromRange, boundary)` → `{ text, pages }`:
   - anchor page `fromRange.idx.full.slice(fromRange.start, boundary && boundary.page === fromRange.page ? boundary.start : undefined)`
   - intermediate pages full text (`getPageText`) up to `boundary.page` (or `total + 1` when none)
   - final page `boundary.idx.full.slice(0, boundary.start)` when `boundary.page > fromRange.page`
2. `getHighlightSpan` (count 1..N, preserved) = `sliceSpan(anchorRange, Nth-boundary)` with the existing bounded boundary walk.
3. New `AIPanel.callbacks.getHighlightSegments = async (anchor)`:
   - resolve anchor + candidates exactly as today (same `resolveAnnotationRange` fallback, sorted by `(page, start)`);
   - walk boundaries **unlimited** (same lexicographic rule, `used` id set → terminates) collecting ALL boundaries after the anchor;
   - segment starts = `[anchorRange, boundary1, boundary2, …]`; segment *i* = `sliceSpan(starts[i], starts[i+1] || null)`;
   - `label`: `'Highlights p.X→Y (i/n)'` per segment (numeric pages, `Y = boundary page` or `total` for the last);
   - return `{ segments: [{ text, pages, label }] }` or `null` when the anchor is unresolvable.
   - Note: 0 boundaries after the anchor ⇒ 1 segment (anchor → end of document), still returned as a single segment.

### 2. `js/ai-panel.js` — multi-context gather + multi-enqueue
1. Rename/refactor `gatherContext()` into `gatherContexts()` returning an **array**:
   - `selectedText` / page-based scopes / no-anchor fallback → array with a single context (existing logic, including `hint`);
   - `untilNextHighlight` with anchor:
     - if `settings.highlightCount` is empty/invalid → call `callbacks.getHighlightSegments(anchor)`; on success map each segment to `{ text, pages, label }` (no hint); empty/failed → fallback single context;
     - if a valid number → single context via existing `getHighlightSpan` (unchanged behavior).
2. Re-add a thin `gatherContext()` wrapper used by Mindmap (`onMindmapRun`) and Auto-Annotate (`onAutoRun`): `const list = await gatherContexts(); return { text: list.map(c => c.text).join('\n\n'), pages: list.flatMap(c => c.pages), label: list[0].label, hint: list[0].hint }` — merged, so their behavior is byte-identical to today.
3. `onSend`: after the model check, `const contexts = await gatherContexts();` and build one queue item per context with the existing prompt-building code (same `$text`/`$pdfContext` replacement, same `hint` handling). Then:
   - item 0: `processQueueItem(item)` when idle, else `queue.push(item)` (existing);
   - items 1..n: `queue.push(item)`;
   - after the loop: `updateQueueUI()`; if more than one item was enqueued set
     `els.status.textContent = I18N.t('ai.status.queuedMany').replace('{n}', queue.length).replace('{label}', firstLabel)`; else keep the existing single-item queued message; `playQueueSound()` once.
   - Existing `Stop` (aborts current + clears queue) and `Clear Queue` need no changes.

### 3. `js/i18n.js`
Add (en + pt-BR):
- `ai.status.queuedMany`: `'Queued {n} actions — starting with "{label}"'` / `'Enfileiradas {n} ações — começando com "{label}"'`

### 4. `README.md`
Update the `Current highlight → next highlight` bullet: an **empty** "Number of highlights ahead" now enqueues one send per highlight segment (current → next, next → next-next, … last → end of document) from a single Send; a number still produces one combined send.

## Edge cases handled
- Unresolvable legacy annotations are skipped as boundaries (their text merges into the preceding segment) — same rule as today's chain walk.
- Anchor is the last highlight → single segment to end of document (1 queue item).
- Anchor highlight deleted after click → `getLastClickedAnnotation` returns null → page fallback with hint.
- Very many segments (long books): queue holds all; Stop/Clear Queue let the user bail out; each item shows `Generating #id (Highlights p.X→Y (i/n))…` in the status line.

## Validation (user performs manually)
1. Scope = Current highlight → next highlight, field **empty**, ≥3 highlights: click Send → Debug/queue badge shows n items at once; each response corresponds to `highlight k → highlight k+1` (verify BODY prompts in Debug); boundaries excluded; last segment covers the tail of the document.
2. Field = `1` → single send, behavior identical to before (anchor text included, next highlight excluded). Field = `2` → single combined send anchor → 2nd next.
3. Stop mid-run → current generation aborts and the queue empties. Clear Queue works while idle-queued.
4. Mindmap (both modes) and Auto-Annotate with this scope → unchanged (single merged context).
5. No highlight clicked → hint shown and entire current page sent (single item).
6. pt-BR language → new status message translated.
