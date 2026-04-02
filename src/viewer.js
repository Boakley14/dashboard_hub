/**
 * viewer.js - Dashboard viewer page orchestrator (viewer.html)
 * Wires together: router -> registry -> iframe / fallback -> info panel
 *
 * Centralized refresh flow:
 *   1. Hub loads the dashboard iframe
 *   2. Hub resolves stored config when registry metadata is incomplete
 *   3. Hub POSTs to /api/refresh with dashboardId + queries
 *   4. Hub injects results into the iframe via postMessage
 */

import { applyTheme, applyNavColor, applyNavTextColor } from './modules/theme.js';
import { findById } from './modules/registry.js';
import { getParam } from './modules/router.js';
import { mountIframe } from './modules/iframe.js';
import { hideSpinner, show, hide } from './modules/ui.js';
import {
  initInfoPanel,
  openInfoPanel,
  closeInfoPanel,
  updateRefreshStatus,
} from './modules/settings-panel.js';

applyTheme();
applyNavColor();
applyNavTextColor();

function sendToIframe(type, payload) {
  const iframe = document.getElementById('dashboard-iframe');
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage({ type, payload }, '*');
}

function updateDiagnostics(patch) {
  window.__dashboardHubDiagnostics = {
    ...(window.__dashboardHubDiagnostics || {}),
    ...patch,
  };
}

async function loadStoredDashboardConfig(dashboardId) {
  if (!dashboardId) return null;
  try {
    const res = await fetch(`/api/dashboard-config?dashboardId=${encodeURIComponent(dashboardId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    updateDiagnostics({
      dashboardId,
      configLoadStatus: data?.validation?.configFound ? 'loaded' : 'missing',
      configQueryCount: data?.validation?.queryCount || 0,
      resolvedConfigPath: data?.resolvedConfigPath || null,
    });
    return data?.config || null;
  } catch {
    updateDiagnostics({ dashboardId, configLoadStatus: 'failed' });
    return null;
  }
}

function buildDataConnection(entry, storedConfig) {
  if (entry.dataConnection) return entry.dataConnection;
  if (!storedConfig?.queries?.length) return null;

  return {
    workspaceId: storedConfig.dataSource?.workspaceId || entry.workspaceId || null,
    datasetId: storedConfig.dataSource?.datasetId || entry.datasetId || null,
    queries: storedConfig.queries
  };
}

async function executeRefresh({ entry, dataConnection, refreshBtn, refreshTs, silent = false }) {
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';
  }

  if (!silent) {
    sendToIframe('dashboardHub.showLoading');
  }

  const startTime = Date.now();

  try {
    const body = { dashboardId: entry.id };
    if (dataConnection?.queries?.length) {
      body.queries = dataConnection.queries;
    }

    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Refresh failed (HTTP ${res.status})`);
    }

    const { results, refreshedAt, diagnostics } = data;
    const hadErrors = Object.values(results).some((r) => r.error);

    sendToIframe('dashboardHub.refreshData', {
      dashboardId: entry.id,
      refreshedUtc: refreshedAt,
      queries: results,
    });

    updateRefreshStatus({
      lastRefreshUtc: refreshedAt,
      lastRefreshStatus: hadErrors ? 'failed' : 'success',
      lastRefreshDurationMs: Date.now() - startTime,
    });
    updateDiagnostics({
      lastRefreshStatus: hadErrors ? 'failed' : 'success',
      lastRefreshUtc: refreshedAt,
      postMessageSent: true,
      refreshDiagnostics: diagnostics || null,
      lastRuntimeError: hadErrors ? 'One or more queries returned an error.' : null,
    });

    if (refreshTs) {
      const ts = new Date(refreshedAt).toLocaleTimeString();
      refreshTs.textContent = `Updated ${ts}`;
      refreshTs.hidden = false;
    }
  } catch (err) {
    sendToIframe('dashboardHub.showError', { message: err.message });

    updateRefreshStatus({
      lastRefreshUtc: new Date().toISOString(),
      lastRefreshStatus: 'failed',
      lastRefreshDurationMs: Date.now() - startTime,
    });
    updateDiagnostics({
      lastRefreshStatus: 'failed',
      postMessageSent: true,
      lastRuntimeError: err.message,
    });

    if (refreshTs) {
      refreshTs.textContent = `Refresh failed: ${err.message}`;
      refreshTs.hidden = false;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Refresh Data`;
    }
  }
}

async function init() {
  const id = getParam('id');
  if (!id) {
    showNotFound();
    return;
  }

  let entry;
  try {
    entry = await findById(id);
  } catch {
    showNotFound();
    return;
  }

  if (!entry) {
    showNotFound();
    return;
  }

  const titleEl = document.getElementById('viewer-title');
  const categoryEl = document.getElementById('viewer-category');
  const newtabBtn = document.getElementById('btn-newtab');

  if (titleEl) titleEl.textContent = entry.title;
  if (categoryEl) categoryEl.textContent = entry.category || '';
  document.title = `${entry.title} - 10 Federal`;

  const staticPath = entry.filename ? `./dashboards/${entry.filename}` : null;
  let resolvedSrc = entry.blobUrl || staticPath;
  if (staticPath) {
    try {
      const probe = await fetch(staticPath, { method: 'HEAD' });
      if (probe.ok) resolvedSrc = staticPath;
    } catch {
      // Keep blob fallback.
    }
  }

  if (newtabBtn) {
    newtabBtn.href = resolvedSrc;
    newtabBtn.hidden = false;
  }

  if (entry.openInNewTab) {
    window.open(resolvedSrc, '_blank', 'noopener');
    window.location.href = 'index.html';
    return;
  }

  const mountEntry = { ...entry, _resolvedSrc: resolvedSrc };
  hideSpinner();
  show('dashboard-iframe');
  mountIframe(mountEntry);

  const storedConfig = await loadStoredDashboardConfig(entry.id);
  const dataConnection = buildDataConnection(entry, storedConfig);
  const minRefreshIntervalMs = Math.max(
    Number(storedConfig?.refresh?.minRefreshIntervalSeconds || 60) * 1000,
    0
  );

  initInfoPanel(entry);
  const infoBtn = document.getElementById('btn-info');
  if (infoBtn) {
    infoBtn.hidden = false;
    infoBtn.addEventListener('click', () => {
      const expanded = infoBtn.getAttribute('aria-expanded') === 'true';
      if (expanded) closeInfoPanel();
      else openInfoPanel();
    });
  }

  const hasDataConn = Boolean(
    dataConnection?.queries?.length ||
    entry.dataConnection ||
    entry.datasetId ||
    storedConfig?.dataSource?.datasetId
  );

  if (hasDataConn) {
    const refreshBtn = document.getElementById('btn-refresh-data');
    const refreshTs = document.getElementById('refresh-timestamp');
    let lastRefreshTime = 0;

    const runRefresh = async ({ ignoreCooldown = false, silent = false } = {}) => {
      const now = Date.now();
      if (!ignoreCooldown && now - lastRefreshTime < minRefreshIntervalMs) {
        if (refreshTs) {
          refreshTs.textContent = `Please wait ${Math.ceil(minRefreshIntervalMs / 1000)} seconds before refreshing again.`;
          refreshTs.hidden = false;
        }
        return;
      }
      lastRefreshTime = now;
      await executeRefresh({ entry, dataConnection, refreshBtn, refreshTs, silent });
    };

    if (refreshBtn) {
      refreshBtn.hidden = false;
      refreshBtn.addEventListener('click', async () => {
        await runRefresh();
      });
    }

    const iframe = document.getElementById('dashboard-iframe');
    if (iframe) {
      iframe.addEventListener('load', () => {
        updateDiagnostics({ iframeLoaded: true });
        sendToIframe('dashboardHub.showLoading');
        runRefresh({ ignoreCooldown: true, silent: false });
      }, { once: true });
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'pbi-refresh-done') return;
      if (!refreshTs) return;
      const ts = event.data.refreshedAt
        ? new Date(event.data.refreshedAt).toLocaleTimeString()
        : new Date().toLocaleTimeString();
      refreshTs.textContent = `Updated ${ts}`;
      refreshTs.hidden = false;
    });
  }
}

function showNotFound() {
  hide('spinner');
  hide('dashboard-iframe');
  show('viewer-error');
}

init();
