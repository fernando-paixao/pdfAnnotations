/* ============================================================
   markdown.js — lightweight, dependency-free Markdown to HTML
   renderer. Escapes HTML first (XSS-safe), then applies common
   Markdown transformations.
   Exposes global: Markdown
   ============================================================ */
const Markdown = (() => {

  /**
   * Convert a Markdown string to safe HTML.
   * @param {string} src
   * @returns {string} HTML string
   */
  function render(src) {
    if (!src) return '';
    // 1) Extract fenced code blocks first (protect them from inline parsing)
    const codeBlocks = [];
    let text = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || '', code: escapeHtml(code.replace(/\n$/, '')) });
      return '\u0000CODEBLOCK' + idx + '\u0000';
    });

    // 2) Escape all remaining HTML
    text = escapeHtml(text);

    // 3) Split into lines for block-level parsing
    const lines = text.split('\n');
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code block placeholder
      const cbMatch = line.match(/^\u0000CODEBLOCK(\d+)\u0000$/);
      if (cbMatch) {
        const cb = codeBlocks[Number(cbMatch[1])];
        html.push('<pre class="md-code-block"><code>' + cb.code + '</code></pre>');
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html.push('<hr/>');
        i++;
        continue;
      }

      // Headings
      const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        html.push('<h' + level + ' class="md-h' + level + '">' + inline(hMatch[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      // Blockquote (note: '>' was escaped to '&gt;' in step 2)
      if (/^(?:&gt;|>)\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^(?:&gt;|>)\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^(?:&gt;|>)\s?/, ''));
          i++;
        }
        html.push('<blockquote class="md-quote">' + inline(quoteLines.join(' ')) + '</blockquote>');
        continue;
      }

      // Unordered list
      if (/^[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^[-*+]\s+/, '')) + '</li>');
          i++;
        }
        html.push('<ul class="md-ul">' + items.join('') + '</ul>');
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
          i++;
        }
        html.push('<ol class="md-ol">' + items.join('') + '</ol>');
        continue;
      }

      // Blank line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Paragraph (consume consecutive non-empty, non-special lines)
      const paraLines = [];
      while (i < lines.length && lines[i].trim() !== '' &&
             !/^(#{1,6}\s|(?:&gt;|>)\s?|[-*+]\s|\d+\.\s|(-{3,}|\*{3,}|_{3,})\s*$|\u0000CODEBLOCK)/.test(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        html.push('<p class="md-p">' + inline(paraLines.join(' ')) + '</p>');
      }
    }

    return html.join('\n');
  }

  /**
   * Inline formatting: bold, italic, code, links, strikethrough.
   * Must be called AFTER HTML escaping.
   */
  function inline(text) {
    let t = text;
    // Inline code (do first to protect content)
    const codeSpans = [];
    t = t.replace(/`([^`]+)`/g, (m, code) => {
      codeSpans.push(code);
      return '\u0001CS' + (codeSpans.length - 1) + '\u0001';
    });
    // Bold (** or __)
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // Italic (* or _)
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');
    // Strikethrough (~~)
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // Links [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Restore code spans
    t = t.replace(/\u0001CS(\d+)\u0001/g, (m, idx) => '<code class="md-code">' + codeSpans[Number(idx)] + '</code>');
    return t;
  }

  function escapeHtml(s) {
    const map = {};
    map[38] = '&' + 'amp;';   // &
    map[60] = '&' + 'lt;';    // <
    map[62] = '&' + 'gt;';    // >
    map[34] = '&' + 'quot;';  // "
    map[39] = '&' + '#39;';   // '
    return String(s).replace(/[&<>"']/g, (c) => map[c.charCodeAt(0)] || c);
  }

  return { render };
})();
