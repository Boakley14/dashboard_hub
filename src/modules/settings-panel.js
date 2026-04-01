/**
 * settings-panel.js
 * Dashboard Info panel and Data Preview modal (Features 4, 5, 6, 7).
 *
 * Exports:
 *   initInfoPanel(entry)       — populate panel with registry entry metadata
 *   openInfoPanel()            — show the slide-in panel
 *   closeInfoPanel()           — hide the panel
 *   updateRefreshStatus(meta)  — update the refresh status section
 */

// ── Info Panel ─────────────────────────────────────────────────────────

let _entry      = null;
let _config     = null;
let _metadata   = null;

export function initInfoPanel(entry) {
  _entry = entry;

  // Basic details
  _setText('ip-title',    entry.title       || '—');
  _setText('ip-author',   entry.author      || '—');
  _setText('ip-date',     entry.dateAdded   || '—');
  _setText('ip-category', entry.category    || '—');
  _setText('ip-tags',     (entry.tags || []).join(', ') || '—');

  // Data connection section
  const hasDC = entry.dataConnection || entry.datasetId;
  _show('ip-connection-section', Boolean(hasDC));

  if (hasDC) {
    const ws = entry.dataConnection?.workspaceId || entry.workspaceId || '—';
    const ds = entry.dataConnection?.datasetId   || entry.datasetId   || '—';
    const qs = entry.dataConnection?.queries     || [];

    _setText('ip-workspace', ws);
    _setText('ip-dataset',   ds);
    _setText('ip-queries',
      qs.length
        ? qs.map(q => q.queryName || q.id).join(', ')
        : (entry.queryCount ? `${entry.queryCount} queries` : '—')
    );
    _setText('ip-refresh-mode', 'Centralized (Hub executes queries)');
    _show('ip-refresh-section', true);
    _show('ip-actions-section', true);

    // Populate preview query selector
    const sel = document.getElementById('preview-query-sel');
    if (sel) {
      sel.innerHTML = '';
      const queryNames = qs.length
        ? qs.map(q => q.queryName || q.id)
        : ['metric-trend'];
      queryNames.forEach(qn => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = qn;
        sel.appendChild(opt);
      });
    }
  }

  // Wire inspector section
  const inspectorSection = document.getElementById('ip-inspector-section');
  if (inspectorSection) inspectorSection.hidden = false;

  // Load stored config + metadata
  _loadConfigAndMeta(entry.id || entry.dashboardId);

  // Wire close button
  document.getElementById('ip-close')?.addEventListener('click', closeInfoPanel);
  document.getElementById('info-backdrop')?.addEventListener('click', closeInfoPanel);

  // Wire inspector toggle
  document.getElementById('ip-inspector-toggle')?.addEventListener('click', _toggleInspector);

  // Wire preview button
  document.getElementById('ip-preview-btn')?.addEventListener('click', openPreviewModal);

  // Wire preview modal close
  document.getElementById('preview-close')?.addEventListener('click', closePreviewModal);
  document.getElementById('preview-refresh-btn')?.addEventListener('click', _runPreview);

  // Close preview on backdrop click
  document.getElementById('preview-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closePreviewModal();
  });

  // Wire query selector change
  document.getElementById('preview-query-sel')?.addEventListener('change', _runPreview);
}

export function openInfoPanel() {
  const panel    = document.getElementById('info-panel');
  const backdrop = document.getElementById('info-backdrop');
  const btn      = document.getElementById('btn-info');
  if (panel)    { panel.hidden    = false; }
  if (backdrop) { backdrop.hidden = false; }
  if (btn)      { btn.setAttribute('aria-expanded', 'true'); }
}

export function closeInfoPanel() {
  const panel    = document.getElementById('info-panel');
  const backdrop = document.getElementById('info-backdrop');
  const btn      = document.getElementById('btn-info');
  if (panel)    { panel.hidden    = true; }
  if (backdrop) { backdrop.hidden = true; }
  if (btn)      { btn.setAttribute('aria-expanded', 'false'); }
}

export function updateRefreshStatus(meta) {
  if (!meta) return;
  _metadata = meta;

  const timeEl     = document.getElementById('ip-refresh-time');
  const statusEl   = document.getElementById('ip-refresh-status');
  const durationEl = document.getElementById('ip-refresh-duration');

  if (timeEl && meta.lastRefreshUtc) {
    const d = new Date(meta.lastRefreshUtc);
    timeEl.textContent = d.toLocaleString();
  } else if (timeEl) {
    timeEl.textContent = 'Never';
  }

  if (statusEl && meta.lastRefreshStatus) {
    const badge = _statusBadge(meta.lastRefreshStatus);
    statusEl.innerHTML = badge;
  }

  if (durationEl && meta.lastRefreshDurationMs != null) {
    durationEl.textContent = meta.lastRefreshDurationMs < 1000
      ? `${meta.lastRefreshDurationMs} ms`
      : `${(meta.lastRefreshDurationMs / 1000).toFixed(1)} s`;
  }
}

// ── Preview Modal ──────────────────────────────────────────────────────

export function openPreviewModal() {
  const modal = document.getElementById('preview-modal');
  if (modal) { modal.hidden = false; }
  _runPreview();
}

export function closePreviewModal() {
  const modal = document.getElementById('preview-modal');
  if (modal) { modal.hidden = true; }
}

async function _runPreview() {
  const sel       = document.getElementById('preview-query-sel');
  const queryName = sel?.value;
  if (!queryName) return;

  const dashboardId = _entry?.id || _entry?.dashboardId || '';
  const statusEl    = document.getElementById('preview-status');
  const loadingEl   = document.getElementById('preview-loading');
  const gridEl      = document.getElementById('preview-grid');
  const emptyEl     = document.getElementById('preview-empty');

  if (statusEl)  statusEl.textContent = '';
  if (statusEl)  statusEl.className   = 'preview-status';
  if (loadingEl) loadingEl.hidden = false;
  if (gridEl)    gridEl.innerHTML = '';
  if (emptyEl)   emptyEl.hidden   = true;

  try {
    const params = new URLSearchParams({ queryName });
    if (dashboardId) params.set('dashboardId', dashboardId);

    const res  = await fetch(`/api/preview?${params}`);
    const data = await res.json();

    if (loadingEl) loadingEl.hidden = true;

    if (!res.ok) {
      if (statusEl) {
        statusEl.textContent = `Error: ${data.error || res.statusText}`;
        statusEl.className   = 'preview-status err';
      }
      return;
    }

    const { rows, columns, count, totalRows, limited } = data;

    if (!rows || !rows.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (statusEl) {
      statusEl.textContent = limited
        ? `Showing ${count} of ${totalRows} rows (preview limit)`
        : `${count} row${count !== 1 ? 's' : ''}`;
    }

    // Build grid table
    const table = document.createElement('table');
    const thead  = document.createElement('thead');
    const tbody  = document.createElement('tbody');

    const hrow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col;
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);

    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td  = document.createElement('td');
        const val = row[col];
        td.textContent = val == null ? '' : typeof val === 'number' ? val.toLocaleString() : String(val);
        if (typeof val === 'number') td.className = 'num';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    if (gridEl) gridEl.appendChild(table);

  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    if (statusEl) {
      statusEl.textContent = `Failed to fetch preview: ${err.message}`;
      statusEl.className   = 'preview-status err';
    }
  }
}

// ── Private helpers ────────────────────────────────────────────────────

async function _loadConfigAndMeta(dashboardId) {
  if (!dashboardId) return;
  try {
    const res  = await fetch(`/api/dashboard-config?dashboardId=${encodeURIComponent(dashboardId)}`);
    if (!res.ok) return;
    const { config, metadata } = await res.json();

    _config   = config;
    _metadata = metadata;

    if (metadata) updateRefreshStatus(metadata);

    // Populate inspector
    const inspectorEl = document.getElementById('ip-inspector-json');
    if (inspectorEl && config) {
      inspectorEl.textContent = JSON.stringify(config, null, 2);
    } else if (inspectorEl) {
      inspectorEl.textContent = '(No hub config stored for this dashboard)';
    }
  } catch { /* non-fatal */ }
}

function _toggleInspector() {
  const el  = document.getElementById('ip-inspector-json');
  const btn = document.getElementById('ip-inspector-toggle');
  if (!el || !btn) return;
  const isHidden = el.hidden;
  el.hidden      = !isHidden;
  btn.textContent = isHidden ? 'Hide' : 'Show';
}

function _statusBadge(status) {
  const map = {
    success: ['ip-badge-success', 'Success'],
    error:   ['ip-badge-error',   'Error'],
    partial: ['ip-badge-partial', 'Partial'],
  };
  const [cls, label] = map[status] || ['ip-badge-pending', status || 'Unknown'];
  return `<span class="ip-badge ${cls}">${label}</span>`;
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _show(id, visible) {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}
