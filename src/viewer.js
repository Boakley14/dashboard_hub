/**
 * viewer.js — Dashboard viewer page orchestrator (viewer.html)
 * Wires together: router → registry → iframe / fallback
 */

import { applyTheme, applyNavColor, applyNavTextColor } from './modules/theme.js';
import { findById }                  from './modules/registry.js';
import { getParam }                  from './modules/router.js';
import { mountIframe }               from './modules/iframe.js';
import { hideSpinner, show, hide }   from './modules/ui.js';

applyTheme();
applyNavColor();
applyNavTextColor();

async function init() {
  const id = getParam('id');

  // No id in URL → show error
  if (!id) {
    showNotFound();
    return;
  }

  let entry;
  try {
    entry = await findById(id);
  } catch {
    // Registry could not be loaded — treat as not found
    showNotFound();
    return;
  }

  // id not in registry → show error
  if (!entry) {
    showNotFound();
    return;
  }

  // Populate the viewer bar
  const titleEl    = document.getElementById('viewer-title');
  const categoryEl = document.getElementById('viewer-category');
  const newtabBtn  = document.getElementById('btn-newtab');

  if (titleEl)    titleEl.textContent = entry.title;
  if (categoryEl) categoryEl.textContent = entry.category || '';

  // Update browser tab title
  document.title = `${entry.title} — 10 Federal`;

  // Resolve the best src for this dashboard.
  // Prefer the same-origin static path (./dashboards/<filename>) so that the
  // iframe shares the SWA's auth cookies and can call /api/* without CORS issues.
  // Fall back to blobUrl only when the static file doesn't exist (e.g. uploaded
  // via Settings but never pushed to git).
  const staticPath  = entry.filename ? `./dashboards/${entry.filename}` : null;
  let resolvedSrc   = entry.blobUrl || staticPath;    // pessimistic default
  if (staticPath) {
    try {
      const probe = await fetch(staticPath, { method: 'HEAD' });
      if (probe.ok) resolvedSrc = staticPath;         // static file found → use it
    } catch { /* network error — keep blobUrl fallback */ }
  }

  // "Open in new tab" button always available in the bar
  const rawSrc = resolvedSrc;
  if (newtabBtn) {
    newtabBtn.href = rawSrc;
    newtabBtn.hidden = false;
  }

  // If the dashboard is flagged to open in a new tab → do it and go back
  if (entry.openInNewTab) {
    window.open(rawSrc, '_blank', 'noopener');
    // Return to hub after opening
    window.location.href = 'index.html';
    return;
  }

  // Mount iframe — pass resolvedSrc so iframe.js doesn't re-pick blobUrl
  const mountEntry = { ...entry, _resolvedSrc: resolvedSrc };
  hideSpinner();
  show('dashboard-iframe');
  mountIframe(mountEntry);

  // ── Live data refresh ──────────────────────────────────────
  // Show the "↻ Refresh Data" button only when the entry has a stored dataConnection.
  if (entry.dataConnection) {
    const refreshBtn = document.getElementById('btn-refresh-data');
    const refreshTs  = document.getElementById('refresh-timestamp');
    const iframe     = document.getElementById('dashboard-iframe');

    if (refreshBtn) {
      refreshBtn.hidden = false;

      refreshBtn.addEventListener('click', () => {
        refreshBtn.disabled  = true;
        refreshBtn.textContent = '↻ Refreshing…';

        // Signal the iframe to re-fetch its data
        iframe?.contentWindow?.postMessage({ type: 'pbi-refresh' }, '*');

        // Re-enable after 15 s as a safety fallback (iframe sends pbi-refresh-done on completion)
        const fallback = setTimeout(() => {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = `
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg> Refresh Data`;
        }, 15_000);

        // Listen for completion signal from the iframe's data-connection.js
        const onDone = event => {
          if (event.data?.type !== 'pbi-refresh-done') return;
          clearTimeout(fallback);
          window.removeEventListener('message', onDone);
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = `
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg> Refresh Data`;
          if (refreshTs) {
            const ts = event.data.refreshedAt
              ? new Date(event.data.refreshedAt).toLocaleTimeString()
              : new Date().toLocaleTimeString();
            refreshTs.textContent = `Updated ${ts}`;
            refreshTs.hidden = false;
          }
        };
        window.addEventListener('message', onDone);
      });
    }
  }
}

function showNotFound() {
  hide('spinner');
  hide('dashboard-iframe');
  show('viewer-error');
}

init();
