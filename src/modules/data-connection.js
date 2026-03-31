/**
 * data-connection.js
 *
 * Client-side module for HTML dashboards that use the /api/pbi-data endpoint.
 * Reads a <script type="application/json" id="data-connection-config"> block
 * embedded by AI when the dashboard is created, then provides helpers for
 * fetching named queries and handling refresh signals from the viewer bar.
 *
 * Usage in a dashboard HTML file:
 *
 *   <script type="application/json" id="data-connection-config">
 *   {
 *     "endpoint": "/api/pbi-data",
 *     "workspaceId": "df46ca8b-208f-4c39-ad9f-829f8379a5bd",
 *     "datasetId":   "a28bcbcc-e7c9-4691-ad27-0f1cd7fdc19d",
 *     "queries": [
 *       { "id": "kpis",   "queryName": "portfolio-kpis",  "params": { "months": 12 } },
 *       { "id": "trend",  "queryName": "financial-trend", "params": { "months": 12 } }
 *     ]
 *   }
 *   </script>
 *
 *   <script type="module">
 *   import { initDataConnection, refreshAll, listenForRefresh }
 *     from '/src/modules/data-connection.js';
 *
 *   const dc = await initDataConnection();
 *
 *   const handlers = {
 *     kpis:  (rows, cols) => renderKpis(rows),
 *     trend: (rows, cols) => renderChart(rows),
 *   };
 *
 *   await refreshAll(dc, handlers);          // initial load
 *   listenForRefresh(dc, handlers);          // wire hub "↻ Refresh Data" button
 *   </script>
 */

import { getPbiToken } from './pbi-auth.js';

// Cache prefix in sessionStorage
const CACHE_PREFIX = 'pbi-dc-';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read and validate the embedded data-connection config from the page.
 * Returns the parsed config object or throws if the script tag is missing/invalid.
 *
 * @returns {Promise<Object>} dc — the parsed config object
 */
export async function initDataConnection() {
  const el = document.getElementById('data-connection-config');
  if (!el) {
    throw new Error(
      '[data-connection] No <script id="data-connection-config"> found in this page.'
    );
  }

  let config;
  try {
    config = JSON.parse(el.textContent.trim());
  } catch (e) {
    throw new Error('[data-connection] Invalid JSON in data-connection-config: ' + e.message);
  }

  if (!config.queries?.length) {
    throw new Error('[data-connection] data-connection-config must include at least one query.');
  }

  return config;
}

/**
 * Fetch a single named query by its local id (not the queryName).
 * Results are cached in sessionStorage; pass `{ bust: true }` in overrides to skip cache.
 *
 * @param {Object} dc          - config from initDataConnection()
 * @param {string} queryId     - the "id" field from one of dc.queries
 * @param {Object} [overrides] - optional extra URL params (e.g. { months: 6, property: 'X' })
 *                               pass { bust: true } to force a fresh fetch
 * @returns {Promise<{ rows: Object[], columns: string[], fetchedAt: string }>}
 */
export async function fetchQuery(dc, queryId, overrides = {}) {
  const queryDef = dc.queries.find(q => q.id === queryId);
  if (!queryDef) {
    throw new Error(`[data-connection] Unknown query id: "${queryId}"`);
  }

  const { bust, ...extraParams } = overrides;
  const mergedParams = { ...queryDef.params, ...extraParams };

  // Build URL
  const endpoint    = dc.endpoint ?? '/api/pbi-data';
  const queryParams = new URLSearchParams({
    query: queryDef.queryName,
    ...(dc.workspaceId ? { workspaceId: dc.workspaceId } : {}),
    ...(dc.datasetId   ? { datasetId:   dc.datasetId   } : {}),
  });

  // Append merged params — handle arrays (repeating params) correctly
  for (const [key, val] of Object.entries(mergedParams)) {
    if (Array.isArray(val)) {
      val.forEach(v => queryParams.append(key, v));
    } else if (val != null) {
      queryParams.set(key, val);
    }
  }

  const cacheKey = `${CACHE_PREFIX}${queryId}-${queryParams.toString()}`;

  // Return cached result unless busting
  if (!bust) {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through to fresh fetch */ }
    }
  } else {
    // Clear all cached entries for this query id when busting
    _clearCacheForQuery(queryId);
  }

  // Acquire user's token for delegated auth (RLS enforced by Power BI)
  let headers = {};
  try {
    const token = await getPbiToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // Auth failed — fall back to service principal (API will use it automatically)
  }

  const res = await fetch(`${endpoint}?${queryParams.toString()}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `[data-connection] /api/pbi-data returned ${res.status}: ${err.error ?? 'Unknown error'}`
    );
  }

  const data = await res.json();
  const result = {
    rows:      data.rows      ?? [],
    columns:   data.columns   ?? [],
    fetchedAt: data.fetchedAt ?? new Date().toISOString(),
    filters:   data.filters   ?? {},
    auth:      data.auth      ?? 'unknown',
  };

  // Cache the result
  try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* storage full */ }

  return result;
}

/**
 * Fetch all queries defined in the config and call the matching handler for each.
 * Queries are fetched in parallel for speed.
 *
 * @param {Object}  dc       - config from initDataConnection()
 * @param {Object}  handlers - map of queryId → function(rows, columns, meta)
 * @param {Object}  [opts]   - { bust: true } to bypass cache; { params: { months: 6 } } for overrides
 * @returns {Promise<void>}
 */
export async function refreshAll(dc, handlers = {}, opts = {}) {
  const { bust = false, params: globalParams = {} } = opts;

  await Promise.all(
    dc.queries.map(async queryDef => {
      const handler = handlers[queryDef.id];
      if (!handler) return;  // no handler registered — skip

      try {
        const result = await fetchQuery(dc, queryDef.id, { ...globalParams, ...(bust ? { bust: true } : {}) });
        handler(result.rows, result.columns, result);
      } catch (err) {
        console.error(`[data-connection] Failed to load query "${queryDef.id}":`, err.message);
        // Call handler with empty data so the dashboard can show an error state
        handler([], [], { error: err.message, fetchedAt: new Date().toISOString() });
      }
    })
  );
}

/**
 * Listen for a { type: 'pbi-refresh' } postMessage from the viewer bar's
 * "↻ Refresh Data" button. On receipt, clears the cache and calls refreshAll().
 *
 * Call this once after initial load.
 *
 * @param {Object}   dc        - config from initDataConnection()
 * @param {Object}   handlers  - same handlers map passed to refreshAll()
 * @param {Function} [onStart] - optional callback fired when refresh begins (e.g. show spinner)
 * @param {Function} [onDone]  - optional callback fired when refresh completes
 */
export function listenForRefresh(dc, handlers, onStart, onDone) {
  window.addEventListener('message', async event => {
    if (event.data?.type !== 'pbi-refresh') return;

    try {
      onStart?.();
      await refreshAll(dc, handlers, { bust: true });
      onDone?.({ success: true, refreshedAt: new Date().toISOString() });

      // Notify the viewer that refresh completed (so it can update the timestamp)
      window.parent.postMessage({ type: 'pbi-refresh-done', refreshedAt: new Date().toISOString() }, '*');
    } catch (err) {
      console.error('[data-connection] Refresh failed:', err);
      onDone?.({ success: false, error: err.message });
      window.parent.postMessage({ type: 'pbi-refresh-done', error: err.message }, '*');
    }
  });
}

/**
 * Convenience: clear all cached pbi-dc-* entries from sessionStorage.
 * Useful if filters change and the cache needs to be fully invalidated.
 */
export function clearCache() {
  const keysToRemove = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => sessionStorage.removeItem(k));
}

// ── Internal ────────────────────────────────────────────────────────────────

function _clearCacheForQuery(queryId) {
  const prefix = `${CACHE_PREFIX}${queryId}-`;
  const keysToRemove = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(prefix)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => sessionStorage.removeItem(k));
}
