/**
 * model.js — MakerThing data layer
 *
 * Responsibilities:
 *  - All fetch() calls to the Flask REST API
 *  - Request/response normalisation
 *  - Error classification (network vs HTTP vs parse)
 *  - No DOM access — pure data in/out
 *
 * API surface (all methods return Promises):
 *  Model.fetchPages()            → [{ id, title, slug }]
 *  Model.fetchPage(id)           → { id, title, slug, blocks }
 *  Model.savePage(id, data)      → { id, savedAt }
 *  Model.createPage(data)        → { id, title, slug }
 *  Model.deletePage(id)          → { ok: true }
 */

'use strict';

const Model = (() => {

  // ── Config ──────────────────────────────────────────────────────────────────

  const BASE = '/api';

  // ── Error types ─────────────────────────────────────────────────────────────

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name   = 'ApiError';
      this.status = status;   // HTTP status code (or 0 for network errors)
      this.body   = body;     // parsed JSON body if available
    }
  }

  class NetworkError extends Error {
    constructor(cause) {
      super('Network request failed — check your connection.');
      this.name  = 'NetworkError';
      this.cause = cause;
    }
  }

  // ── Core fetch wrapper ───────────────────────────────────────────────────────

  /**
   * request(method, path, body?)
   *
   * Throws NetworkError  — fetch() itself rejected (offline, DNS, etc.)
   * Throws ApiError      — server returned a non-2xx status
   * Returns              — parsed JSON body on success
   */
  async function request(method, path, body = null) {
    const url     = BASE + path;
    const headers = { 'Content-Type': 'application/json' };
    const init    = { method, headers };

    if (body !== null) {
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new NetworkError(err);
    }

    // Parse body regardless of status — Flask often sends error detail as JSON
    let parsed;
    const contentType = response.headers.get('Content-Type') ?? '';
    try {
      parsed = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const message = (parsed && parsed.error)
        ? parsed.error
        : `HTTP ${response.status} ${response.statusText}`;
      throw new ApiError(message, response.status, parsed);
    }

    return parsed;
  }

  // ── Retry helper ─────────────────────────────────────────────────────────────

  /**
   * withRetry(fn, retries, delayMs)
   *
   * Retries only on NetworkError or 5xx ApiError (not 4xx — those are
   * client errors and retrying won't help).
   */
  async function withRetry(fn, retries = 2, delayMs = 800) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const isRetryable =
          err instanceof NetworkError ||
          (err instanceof ApiError && err.status >= 500);
        if (!isRetryable || attempt === retries) throw err;
        await delay(delayMs * (attempt + 1)); // simple back-off
      }
    }
    throw lastErr;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Response validators ──────────────────────────────────────────────────────

  function assertShape(obj, keys, context) {
    for (const key of keys) {
      if (!(key in obj)) {
        throw new ApiError(
          `Unexpected response from server (missing "${key}" in ${context})`,
          0,
          obj
        );
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * fetchPages() → [{ id, title, slug }]
   * GET /api/pages
   */
  async function fetchPages() {
    const data = await withRetry(() => request('GET', '/pages'));

    if (!Array.isArray(data)) {
      throw new ApiError('Expected an array of pages from server.', 0, data);
    }

    return data.map(page => {
      assertShape(page, ['id', 'title'], 'fetchPages');
      return {
        id:    page.id,
        title: page.title,
        slug:  page.slug ?? '',
      };
    });
  }

  /**
   * fetchPage(id) → { id, title, slug, blocks }
   * GET /api/pages/:id
   */
  async function fetchPage(id) {
    if (!id) throw new ApiError('fetchPage requires an id.', 0, null);

    const data = await withRetry(() => request('GET', `/pages/${id}`));
    assertShape(data, ['id', 'title', 'blocks'], 'fetchPage');

    return {
      id:     data.id,
      title:  data.title,
      slug:   data.slug  ?? '',
      blocks: Array.isArray(data.blocks) ? data.blocks : [],
    };
  }

  /**
   * savePage(id, pageData) → { id, savedAt }
   * POST /api/pages/:id
   *
   * pageData shape: { title, blocks, savedAt }
   * (as produced by editor.js serializePage())
   */
  async function savePage(id, pageData) {
    if (!id)       throw new ApiError('savePage requires an id.', 0, null);
    if (!pageData) throw new ApiError('savePage requires pageData.', 0, null);

    const payload = {
      title:   pageData.title   ?? '',
      blocks:  pageData.blocks  ?? [],
      savedAt: pageData.savedAt ?? new Date().toISOString(),
    };

    const data = await withRetry(() => request('PUT', `/pages/${id}`, payload));
    assertShape(data, ['id'], 'savePage');

    return {
      id:      data.id,
      savedAt: data.savedAt ?? new Date().toISOString(),
    };
  }

  /**
   * createPage(data) → { id, title, slug }
   * POST /api/pages
   */
  async function createPage(data) {
    if (!data || !data.title) {
      throw new ApiError('createPage requires a title.', 0, null);
    }

    const payload = {
      title:  data.title.trim(),
      blocks: data.blocks ?? [],
    };

    const result = await request('POST', '/pages', payload);
    assertShape(result, ['id', 'title'], 'createPage');

    return {
      id:    result.id,
      title: result.title,
      slug:  result.slug ?? '',
    };
  }

  /**
   * deletePage(id) → { ok: true }
   * DELETE /api/pages/:id
   */
  async function deletePage(id) {
    if (!id) throw new ApiError('deletePage requires an id.', 0, null);

    await request('DELETE', `/pages/${id}`);
    return { ok: true };
  }

  // ── Expose ───────────────────────────────────────────────────────────────────

  return {
    fetchPages,
    fetchPage,
    savePage,
    createPage,
    deletePage,
    // Expose error types so app.js can instanceof-check if needed
    ApiError,
    NetworkError,
  };

})();