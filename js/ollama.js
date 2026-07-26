/* ============================================================
   ollama.js — fetch-based Ollama API client (no backend needed).
   Streaming via ReadableStream, cancellation via AbortController.
   Exposes global: Ollama
   ============================================================ */
const Ollama = (() => {
  const DEFAULT_HOST = 'http://localhost:11434';

  /**
   * List available models from the OpenAI-compatible endpoint.
   * @returns {Promise<string[]>} model ids
   */
  async function listModels(host) {
    const base = (host || DEFAULT_HOST).trim().replace(/\/+$/, '');
    const url = base + '/v1/models';
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('Ollama listModels error ' + res.status + ': ' + body);
    }
    const data = await res.json();
    return (data.data || []).map((m) => m.id);
  }

  /**
   * Send a chat request to Ollama.
   * @param {Object} opts
   * @param {string} opts.host
   * @param {string} opts.model
   * @param {Array<{role:string,content:string}>} opts.messages
   * @param {boolean} opts.stream
   * @param {number} opts.maxTokens  (num_predict)
   * @param {number} opts.numCtx
   * @param {boolean} opts.think     (reasoning)
   * @param {function(string):void} [opts.onChunk]     called per content delta
   * @param {function(string):void} [opts.onThinking]  called per thinking delta
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<string>} full response text
   */
  async function chat(opts) {
    const host = (opts.host || DEFAULT_HOST).trim().replace(/\/+$/, '');
    const url = host + '/api/chat';
    const body = {
      model: opts.model,
      messages: opts.messages,
      stream: opts.stream !== false,
      think: !!opts.think,
      options: {
        num_predict: opts.maxTokens || 2048,
        num_ctx: opts.numCtx || 8192,
      },
      format: opts.format || undefined,
    };
    // Remove undefined keys
    if (!opts.format) delete body.format;

    const startTime = performance.now();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Ollama error ' + res.status + ': ' + text);
    }

    if (opts.stream !== false) {
      return readStream(res, opts, url, body, startTime);
    }
    // Non-streaming: single JSON object
    const json = await res.json();
    const endTime = performance.now();
    const content = (json.message && json.message.content) || '';
    if (json.thinking && opts.onThinking) opts.onThinking(json.thinking);
    emitStats(opts, url, body, content, startTime, endTime, endTime - startTime, false);
    return content;
  }

  function emitStats(opts, url, body, responseText, startTime, endTime, firstTokenMs, stream) {
    if (!opts.onStats) return;
    opts.onStats({
      url,
      model: body.model,
      stream,
      think: body.think,
      maxTokens: body.options.num_predict,
      numCtx: body.options.num_ctx,
      messageCount: body.messages.length,
      requestLength: JSON.stringify(body.messages).length,
      requestBody: JSON.stringify(body, null, 2),
      responseLength: responseText.length,
      responseText: responseText,
      timeToFirstTokenMs: Math.round(firstTokenMs),
      totalTimeMs: Math.round(endTime - startTime),
    });
  }

  async function readStream(res, opts, url, body, startTime) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    let firstTokenAt = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Process complete NDJSON lines
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let chunk;
        try { chunk = JSON.parse(line); } catch (e) { continue; }
        if (chunk.thinking && opts.onThinking) opts.onThinking(chunk.thinking);
        const content = (chunk.message && chunk.message.content) || '';
        if (content) {
          if (firstTokenAt === null) firstTokenAt = performance.now() - startTime;
          full += content;
          if (opts.onChunk) opts.onChunk(content);
        }
      }
    }
    const endTime = performance.now();
    const firstMs = firstTokenAt !== null ? firstTokenAt : (endTime - startTime);
    emitStats(opts, url, body, full, startTime, endTime, firstMs, true);
    return full;
  }

  return { listModels, chat, DEFAULT_HOST };
})();
