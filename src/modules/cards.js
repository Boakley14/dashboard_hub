/**
 * cards.js
 * Responsibility: Create and render dashboard card DOM nodes.
 * Reads from the registry; writes to the card grid element.
 */

import { viewerUrl } from './router.js';

// Maps category names to CSS class suffixes for accent color coding.
const CATEGORY_CLASS_MAP = {
  'Sales':      'sales',
  'Operations': 'operations',
  'Finance':    'finance',
  'Marketing':  'marketing',
  'HR':         'hr',
};

// Brand color swatches available in the per-card editor
const ACCENT_COLORS = [
  { label: 'Primary Red', hex: '#C52127' },
  { label: 'Deep Red',    hex: '#980000' },
  { label: 'Bright Red',  hex: '#F14F4D' },
  { label: 'Dark',        hex: '#2E2E2E' },
  { label: 'Gray',        hex: '#6B6B6B' },
  { label: 'Black',       hex: '#000000' },
];

function categoryClass(category) {
  return CATEGORY_CLASS_MAP[category] ?? 'default';
}

function _dsTypeKey(type) {
  return (type || 'other').toLowerCase().replace(/[^a-z]+/g, '-');
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch { return iso; }
}

/**
 * Create a single dashboard card as a DOM <article> element.
 * @param {Object}   entry     - Dashboard registry entry
 * @param {Object}   [opts]    - { onEdit, categories }
 * @returns {HTMLElement}
 */
export function createCard(entry, opts = {}) {
  const { onEdit, categories = [] } = opts;

  const article = document.createElement('article');
  article.className = 'dashboard-card';
  article.dataset.id = entry.id;
  article.dataset.category = entry.category || '';

  // Accent strip: use per-entry accentColor if set, otherwise category class
  const accentStyle = entry.accentColor
    ? ` style="background:${entry.accentColor}"`
    : '';
  const accentClass = entry.accentColor
    ? 'card-accent'
    : `card-accent cat-${categoryClass(entry.category)}`;

  const tagsHtml = (entry.tags || [])
    .slice(0, 3)
    .map(tag => `<span class="card-tag">${tag}</span>`)
    .join('');

  const editBtnHtml = onEdit
    ? `<button class="card-edit-btn" type="button" title="Edit card" aria-label="Edit ${entry.title}">⋮</button>`
    : '';
  const infoBtnHtml = (entry.dataSources?.length || entry.powerBiDatasetId)
    ? `<button class="card-info-btn" type="button" title="View data sources" aria-label="View data sources for ${entry.title}">ⓘ</button>`
    : '';

  article.innerHTML = `
    <div class="${accentClass}"${accentStyle} aria-hidden="true"></div>
    <div class="card-body">
      <div class="card-header-row">
        <span class="card-category-badge">${entry.category || 'Uncategorized'}</span>
        <div class="card-header-actions">
          ${entry.openInNewTab ? '<span class="card-newtab-badge" title="Opens in new tab">↗ New Tab</span>' : ''}
          ${infoBtnHtml}
          ${editBtnHtml}
        </div>
      </div>
      <h2 class="card-title">${entry.title}</h2>
      <p class="card-description">${entry.description || ''}</p>
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
      <div class="card-footer">
        <span class="card-author">${entry.author || ''}</span>
        <span class="card-date">${formatDate(entry.dateAdded)}</span>
      </div>
    </div>
  `;

  // ---- Data source info -----------------------------------
  if (entry.dataSources?.length || entry.powerBiDatasetId) {
    article.querySelector('.card-info-btn').addEventListener('click', e => {
      e.stopPropagation();
      _openDataSourceInfoModal(entry);
    });
  }

  // ---- Edit modal -----------------------------------------
  if (onEdit) {
    article.querySelector('.card-edit-btn').addEventListener('click', e => {
      e.stopPropagation();
      _openDashboardModal(entry, categories, onEdit);
    });
  }

  // ---- Navigate on click (not on edit button) -------------
  article.addEventListener('click', e => {
    if (e.target.closest('.card-edit-btn')) return;
    if (entry.openInNewTab) {
      window.open(`./dashboards/${entry.filename}`, '_blank', 'noopener');
    } else {
      window.location.href = viewerUrl(entry.id);
    }
  });

  article.setAttribute('tabindex', '0');
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Open ${entry.title}`);
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); article.click(); }
  });

  return article;
}

// ---- Shared modal system -----------------------------------

let _activeModal = null;

function _closeModal() {
  _activeModal?.remove();
  _activeModal = null;
}

function _openModal({ title, subtitle, bodyHtml, onMount, wide = false }) {
  _closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  overlay.innerHTML = `
    <div class="card-modal${wide ? ' card-modal--wide' : ''}" role="dialog" aria-modal="true">
      <div class="card-modal-header">
        <div class="card-modal-heading">
          <span class="card-modal-title">${title}</span>
          ${subtitle ? `<span class="card-modal-subtitle">${subtitle}</span>` : ''}
        </div>
        <button type="button" class="card-modal-close" aria-label="Close">✕</button>
      </div>
      <div class="card-modal-body">${bodyHtml}</div>
    </div>
  `;

  overlay.addEventListener('click', e => { if (e.target === overlay) _closeModal(); });
  overlay.querySelector('.card-modal-close').addEventListener('click', _closeModal);

  const onEsc = e => { if (e.key === 'Escape') { _closeModal(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  document.body.appendChild(overlay);
  _activeModal = overlay;

  onMount(overlay.querySelector('.card-modal'));
}

function _swatchesHtml(activeHex) {
  return ACCENT_COLORS.map(({ label, hex }) =>
    `<button type="button" class="color-swatch${hex === activeHex ? ' active' : ''}"
      data-hex="${hex}" title="${label}" style="background:${hex}" aria-label="${label}"></button>`
  ).join('');
}

function _wireColorPicker(modal) {
  let pending = modal.querySelector('.card-color-picker').value;
  const picker = modal.querySelector('.card-color-picker');

  picker.addEventListener('input', () => {
    pending = picker.value;
    modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  });

  modal.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      pending = sw.dataset.hex;
      picker.value = pending;
      modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
  });

  return { getPending: () => pending };
}

// ---- Data source info modal (read-only + live PBI schema) ----------
function _openDataSourceInfoModal(entry) {
  const sources  = entry.dataSources || [];
  const hasPbi   = !!(entry.powerBiDatasetId && entry.powerBiWorkspaceId);
  const cacheKey = hasPbi ? `pbi-schema-${entry.powerBiDatasetId}` : null;

  // Manually defined metadata
  const metaHtml = sources.map(ds => `
    <div class="ds-source">
      <div class="ds-source-header">
        <span class="ds-type-badge ds-type-${_dsTypeKey(ds.type)}">${ds.type || 'Other'}</span>
        <span class="ds-name">${ds.name}</span>
      </div>
      ${ds.connection ? `<div class="ds-field"><span class="ds-field-label">Connection</span><span class="ds-field-value">${ds.connection}</span></div>` : ''}
      ${ds.tables    ? `<div class="ds-field"><span class="ds-field-label">Tables / Fields</span><span class="ds-field-value ds-tables">${ds.tables}</span></div>` : ''}
      ${ds.notes     ? `<div class="ds-field"><span class="ds-field-label">Notes</span><span class="ds-field-value">${ds.notes}</span></div>` : ''}
    </div>
  `).join('');

  // Live Power BI schema section
  const schemaHtml = hasPbi ? `
    <div class="ds-schema-section">
      <div class="ds-schema-header">
        <span class="ds-schema-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
          </svg>
          Dataset Schema
        </span>
        <button type="button" class="btn-ds-refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          <span class="btn-ds-refresh-label">Load Schema</span>
        </button>
      </div>
      <div class="ds-schema-body">
        <p class="ds-schema-hint">Click "Load Schema" to fetch live table and column info from Power BI.</p>
      </div>
    </div>
  ` : '';

  const bodyHtml = (metaHtml + schemaHtml) ||
    '<p class="ds-empty">No data source information available.</p>';

  _openModal({
    title:    entry.title,
    subtitle: 'Data Sources',
    bodyHtml,
    wide:     true,
    onMount(modal) {
      if (!hasPbi) return;

      const refreshBtn = modal.querySelector('.btn-ds-refresh');
      const refreshLbl = modal.querySelector('.btn-ds-refresh-label');
      const schemaBody = modal.querySelector('.ds-schema-body');

      function renderSchema(data) {
        const tables = data.tables || [];
        if (!tables.length) {
          schemaBody.innerHTML = '<p class="ds-schema-hint">No tables returned.</p>';
          return;
        }
        const stamp = new Date(data.fetchedAt).toLocaleString(undefined,
          { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        schemaBody.innerHTML =
          `<p class="ds-schema-stamp">Loaded ${stamp} · ${tables.length} table${tables.length !== 1 ? 's' : ''}</p>` +
          tables.map(t => {
            const colRows = (t.columns  || []).map(c =>
              `<div class="ds-col"><span class="ds-col-name">${c.name}</span><span class="ds-col-type">${c.dataType}</span></div>`
            ).join('');
            const msrRows = (t.measures || []).map(m =>
              `<div class="ds-col"><span class="ds-col-name">${m.name}</span><span class="ds-col-type ds-col-measure">measure</span></div>`
            ).join('');
            const total = (t.columns?.length || 0) + (t.measures?.length || 0);
            return `
              <details class="ds-table" open>
                <summary class="ds-table-summary">
                  <span class="ds-table-name">${t.name}</span>
                  <span class="ds-table-count">${total} field${total !== 1 ? 's' : ''}</span>
                </summary>
                <div class="ds-col-list">${colRows}${msrRows}</div>
              </details>`;
          }).join('');
        refreshLbl.textContent = '↻ Refresh';
      }

      async function fetchSchema() {
        refreshBtn.disabled = true;
        refreshLbl.textContent = 'Loading…';
        schemaBody.innerHTML = '<p class="ds-schema-loading"><span class="ds-spinner"></span>Fetching from Power BI…</p>';
        try {
          const res = await fetch(
            `/api/pbi-schema?workspaceId=${entry.powerBiWorkspaceId}&datasetId=${entry.powerBiDatasetId}`
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || res.statusText);
          }
          const data = await res.json();
          sessionStorage.setItem(cacheKey, JSON.stringify(data));
          renderSchema(data);
        } catch (err) {
          schemaBody.innerHTML = `<p class="ds-schema-error">⚠ Could not load schema: ${err.message}</p>`;
          refreshLbl.textContent = 'Retry';
        } finally {
          refreshBtn.disabled = false;
        }
      }

      // Auto-render cached schema; otherwise wait for user to click
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try { renderSchema(JSON.parse(cached)); } catch { /* corrupt — prompt user to load */ }
      }

      refreshBtn.addEventListener('click', fetchSchema);
    },
  });
}

// ---- Dashboard card modal ----------------------------------
function _openDashboardModal(entry, categories, onEdit) {
  const initialColor  = entry.accentColor ?? _categoryHex(entry.category);
  let pendingCategory = entry.category || '';

  const catOptions = categories.map(c =>
    `<option value="${c}"${c === entry.category ? ' selected' : ''}>${c}</option>`
  ).join('');

  const bodyHtml = `
    <div class="card-edit-row">
      <label class="card-edit-label">Category</label>
      <select class="card-edit-category">${catOptions}</select>
    </div>
    <div class="card-edit-row">
      <label class="card-edit-label">Accent color</label>
      <div class="card-color-row">
        <input type="color" class="card-color-picker" value="${initialColor}">
        <div class="color-swatches">${_swatchesHtml(initialColor)}</div>
      </div>
    </div>
    <div class="pbi-link-section">
      <div class="pbi-link-header">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
          <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
        </svg>
        Power BI Dataset
      </div>
      <div class="card-edit-row pbi-link-row">
        <label class="card-edit-label pbi-link-label">Workspace ID</label>
        <input type="text" class="pbi-input pbi-workspace-input"
          value="${entry.powerBiWorkspaceId || ''}"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          spellcheck="false" autocomplete="off">
      </div>
      <div class="card-edit-row pbi-link-row">
        <label class="card-edit-label pbi-link-label">Dataset ID</label>
        <input type="text" class="pbi-input pbi-dataset-input"
          value="${entry.powerBiDatasetId || ''}"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          spellcheck="false" autocomplete="off">
      </div>
      <p class="pbi-link-hint">Linking a dataset enables the ⓘ schema viewer on this card.</p>
    </div>
    <div class="card-modal-footer">
      <button type="button" class="btn-card-save">Save</button>
      <button type="button" class="btn-card-delete">Delete</button>
      <button type="button" class="btn-card-cancel">Cancel</button>
    </div>
  `;

  _openModal({
    title: entry.title,
    subtitle: entry.category,
    bodyHtml,
    wide: true,
    onMount(modal) {
      const { getPending } = _wireColorPicker(modal);
      modal.querySelector('.card-edit-category')
           .addEventListener('change', e => { pendingCategory = e.target.value; });

      modal.querySelector('.btn-card-save').addEventListener('click', async () => {
        const updates = {};
        if (pendingCategory !== entry.category) updates.category = pendingCategory;
        const pa = getPending();
        if (pa !== (entry.accentColor ?? null)) updates.accentColor = pa;

        const wsId  = modal.querySelector('.pbi-workspace-input').value.trim();
        const dsId  = modal.querySelector('.pbi-dataset-input').value.trim();
        if (wsId  !== (entry.powerBiWorkspaceId || '')) updates.powerBiWorkspaceId = wsId  || null;
        if (dsId  !== (entry.powerBiDatasetId   || '')) updates.powerBiDatasetId   = dsId  || null;

        _closeModal();
        if (Object.keys(updates).length > 0) await onEdit(entry, 'save', updates);
      });

      modal.querySelector('.btn-card-delete').addEventListener('click', async () => {
        _closeModal();
        await onEdit(entry, 'delete', null);
      });

      modal.querySelector('.btn-card-cancel').addEventListener('click', _closeModal);
    }
  });
}

/** Resolve the hex that a category class maps to, for swatch pre-selection. */
function _categoryHex(category) {
  const map = {
    'Sales': '#C52127', 'Marketing': '#F14F4D',
    'Finance': '#980000', 'Operations': '#2E2E2E', 'HR': '#6B6B6B'
  };
  return map[category] ?? '#C52127';
}

/**
 * Render a filtered list of dashboard entries into the card grid.
 * @param {Array}  entries
 * @param {Object} [opts]   - { onEdit, categories }
 */
export function renderCards(entries, opts = {}) {
  const grid = document.getElementById('card-grid');
  if (!grid) return;
  grid.innerHTML = '';
  entries.forEach(entry => grid.appendChild(createCard(entry, opts)));
}

// ---- Category accent color (localStorage, no API needed) ---
function getCatAccent(category) {
  return localStorage.getItem(`hub-cat-color-${category}`) ?? null;
}

/**
 * Render category "folder" cards — one card per category.
 */
export function renderCategoryCards(categories, registry, onCategoryClick, onCategoryEdit) {
  const grid = document.getElementById('card-grid');
  if (!grid) return;
  grid.innerHTML = '';
  categories.forEach(cat => {
    const count = registry.filter(d => d.category === cat).length;
    grid.appendChild(createCategoryCard(cat, count, onCategoryClick, onCategoryEdit));
  });
}

function createCategoryCard(category, count, onClick, onEdit) {
  const article = document.createElement('article');
  article.className = 'dashboard-card category-card';
  article.dataset.category = category;

  const catAccent   = getCatAccent(category);
  const accentStyle = catAccent ? ` style="background:${catAccent}"` : '';
  const accentClass = catAccent ? 'card-accent' : `card-accent cat-${categoryClass(category)}`;
  const editBtnHtml = onEdit
    ? `<button class="card-edit-btn" type="button" title="Edit card" aria-label="Edit ${category}">⋮</button>`
    : '';

  article.innerHTML = `
    <div class="${accentClass}"${accentStyle} aria-hidden="true"></div>
    <div class="card-body">
      <div class="card-header-row">
        <span class="card-category-badge">${category}</span>
        <div class="card-header-actions">
          ${editBtnHtml}
        </div>
      </div>
      <h2 class="card-title">${category}</h2>
      <p class="card-description">${count} dashboard${count !== 1 ? 's' : ''}</p>
    </div>
  `;

  if (onEdit) {
    article.querySelector('.card-edit-btn').addEventListener('click', e => {
      e.stopPropagation();
      _openCategoryModal(category, getCatAccent(category), onEdit);
    });
  }

  article.setAttribute('tabindex', '0');
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Browse ${category} — ${count} dashboard${count !== 1 ? 's' : ''}`);

  article.addEventListener('click', e => {
    if (e.target.closest('.card-edit-btn')) return;
    onClick(category);
  });
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); article.click(); }
  });

  return article;
}

// ---- Category card modal -----------------------------------
function _openCategoryModal(category, currentAccent, onEdit) {
  const initialColor = currentAccent ?? _categoryHex(category);

  const bodyHtml = `
    <div class="card-edit-row">
      <label class="card-edit-label">Accent color</label>
      <div class="card-color-row">
        <input type="color" class="card-color-picker" value="${initialColor}">
        <div class="color-swatches">${_swatchesHtml(initialColor)}</div>
      </div>
    </div>
    <div class="card-modal-footer">
      <button type="button" class="btn-card-save">Save</button>
      <button type="button" class="btn-card-reset">Reset</button>
      <button type="button" class="btn-card-cancel">Cancel</button>
    </div>
  `;

  _openModal({
    title: category,
    subtitle: 'Category',
    bodyHtml,
    onMount(modal) {
      const { getPending } = _wireColorPicker(modal);

      modal.querySelector('.btn-card-save').addEventListener('click', () => {
        _closeModal(); onEdit(category, getPending());
      });
      modal.querySelector('.btn-card-reset').addEventListener('click', () => {
        _closeModal(); onEdit(category, null);
      });
      modal.querySelector('.btn-card-cancel').addEventListener('click', _closeModal);
    }
  });
}
