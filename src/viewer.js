/**
 * viewer.js — Dashboard viewer page orchestrator (viewer.html)
 * Wires together: router → registry → iframe / fallback → info panel
 *
 * Centralized refresh flow (Feature 3, 10):
 *   1. User clicks "Refresh Data" in the viewer bar
 *   2. Hub POSTs to /api/refresh with dashboardId + current filters
 *   3. Hub receives { results: { queryId: { rows, columns } } }
 *   4. Hub injects into iframe via direct JS call (same-origin) or postMessage
 *   5. Dashboard exposes window.dashboardHub.updateData(results)
 */

import { applyTheme, applyNavColor, applyNavTextColor } from './modules/theme.js';
import { findById }                  from './modules/registry.js';
import { getParam }                  from './modules/router.js';
import { mountIframe }               from './modules/iframe.js';
import { hideSpinner, show, hide }   from './modules/ui.js';
import {
  initInfoPanel,
  openInfoPanel,
  closeInfoPanel,
  updateRefreshStatus,
} from './modules/settings-panel.js';

applyTheme();
applyNavColor();
applyNavTextColor();

// Send a typed postMessage to the dashboard iframe (Feature 8).
// Spec: do NOT rely on direct iframe JS access — always use postMessage.
function sendToIframe(type, payload) {
  const iframe = document.getElementById('dashboard-iframe');
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage({ type, payload }, '*');
}

async function init() {
  const id = getParam('id');

  if (!id) { showNotFound(); return; }

  let entry;
  try {
    entry = await findById(id);
  } catch {
    showNotFound(); return;
  }

  if (!entry) { showNotFound(); return; }

  // ── Populate viewer bar ────────────────────────────────────────────
  const titleEl    = document.getElementById('viewer-title');
  const categoryEl = document.getElementById('viewer-category');
  const newtabBtn  = document.getElementById('btn-newtab');

  if (titleEl)    titleEl.textContent    = entry.title;
  if (categoryEl) categoryEl.textContent = entry.category || '';
  document.title = `${entry.title} — 10 Federal`;

  // ── Resolve best iframe src: static SWA path preferred over blobUrl
  // (same-origin → auth cookies → /api/* calls work)
  const staticPath  = entry.filename ? `./dashboards/${entry.filename}` : null;
  let resolvedSrc   = entry.blobUrl || staticPath;
  if (staticPath) {
    try {
      const probe = await fetch(staticPath, { method: 'HEAD' });
      if (probe.ok) resolvedSrc = staticPath;
    } catch { /* keep blobUrl fallback */ }
  }

  if (newtabBtn) { newtabBtn.href = resolvedSrc; newtabBtn.hidden = false; }

  if (entry.openInNewTab) {
    window.open(resolvedSrc, '_blank', 'noopener');
    window.location.href = 'index.html';
    return;
  }

  const mountEntry = { ...entry, _resolvedSrc: resolvedSrc };
  hideSpinner();
  show('dashboard-iframe');
  mountIframe(mountEntry);

  // ── Info panel (always shown — Features 4, 6, 7) ──────────────────
  initInfoPanel(entry);
  const infoBtn = document.getElementById('btn-info');
  if (infoBtn) {
    infoBtn.hidden = false;
    infoBtn.addEventListener('click', () => {
      const expanded = infoBtn.getAttribute('aria-expanded') === 'true';
      if (expanded) closeInfoPanel(); else openInfoPanel();
    });
  }

  // ── Live data refresh (Features 3, 8, 9 — centralized hub execution) ─
  const hasDataConn = Boolean(entry.dataConnection || entry.datasetId);
  if (hasDataConn) {
    const refreshBtn = document.getElementById('btn-refresh-data');
    const refreshTs  = document.getElementById('refresh-timestamp');

    if (refreshBtn) {
      refreshBtn.hidden = false;

      // Per-session cooldown — 60 seconds between refreshes (Feature 9)
      let lastRefreshTime = 0;

      refreshBtn.addEventListener('click', async () => {
        // ── 60-second cooldown check ────────────────────────────────
        const now = Date.now();
        if (now - lastRefreshTime < 60_000) {
          if (refreshTs) {
            refreshTs.textContent = 'Please wait before refreshing again.';
            refreshTs.hidden = false;
          }
          return;
        }
        lastRefreshTime = now;

        refreshBtn.disabled    = true;
        refreshBtn.textContent = '↻ Refreshing…';

        // Notify dashboard iframe that refresh is starting
        sendToIframe('dashboardHub.showLoading');

        const startTime = Date.now();

        try {
          // ── Step 1: Hub executes queries centrally via /api/refresh ─
          const body = { dashboardId: entry.id };

          // Include inline queries if stored in entry
          if (entry.dataConnection?.queries) {
            body.queries = entry.dataConnection.queries;
          }

          const res  = await fetch('/api/refresh', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || `Refresh failed (HTTP ${res.status})`);
          }

          const { results, refreshedAt } = data;

          // ── Step 2: Inject results into iframe via postMessage (Feature 8)
          // Spec: do NOT rely on direct iframe JS access — always use postMessage.
          sendToIframe('dashboardHub.refreshData', {
            dashboardId:  entry.id,
            refreshedUtc: refreshedAt,
            queries:      results,
          });

          // ── Step 3: Update info panel refresh status ─────────────────
          updateRefreshStatus({
            lastRefreshUtc:        refreshedAt,
            lastRefreshStatus:     Object.values(results).some(r => r.error) ? 'partial' : 'success',
            lastRefreshDurationMs: Date.now() - startTime,
          });

          if (refreshTs) {
            const ts = new Date(refreshedAt).toLocaleTimeString();
            refreshTs.textContent = `Updated ${ts}`;
            refreshTs.hidden = false;
          }

        } catch (err) {
          // Notify iframe of error state
          sendToIframe('dashboardHub.showError', { message: err.message });

          updateRefreshStatus({
            lastRefreshUtc:        new Date().toISOString(),
            lastRefreshStatus:     'error',
            lastRefreshDurationMs: Date.now() - startTime,
          });
          if (refreshTs) {
            refreshTs.textContent = `Refresh failed: ${err.message}`;
            refreshTs.hidden = false;
          }
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = `
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Refresh Data`;
        }
      });
    }

    // Listen for iframe self-refresh signals (dashboards that fetch their own data)
    window.addEventListener('message', event => {
      const refreshTs = document.getElementById('refresh-timestamp');
      if (event.data?.type === 'pbi-refresh-done') {
        if (refreshTs) {
          const ts = event.data.refreshedAt
            ? new Date(event.data.refreshedAt).toLocaleTimeString()
            : new Date().toLocaleTimeString();
          refreshTs.textContent = `Updated ${ts}`;
          refreshTs.hidden = false;
        }
      }
    });
  }
}

function showNotFound() {
  hide('spinner');
  hide('dashboard-iframe');
  show('viewer-error');
}

init();
