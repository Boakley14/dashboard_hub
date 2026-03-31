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

/** Normalize entry fields into a consistent powerBiSources array. */
function _getPbiSources(entry) {
  if (entry.powerBiSources?.length) return entry.powerBiSources;
  // backward-compat: single-source fields
  if (entry.powerBiDatasetId && entry.powerBiWorkspaceId) {
    return [{
      id:          'legacy',
      label:       'Dataset',
      workspaceId: entry.powerBiWorkspaceId,
      datasetId:   entry.powerBiDatasetId,
    }];
  }
  return [];
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
  const liveBadgeHtml = entry.dataConnection
    ? `<span class="card-live-badge" title="Live data connection">● Live</span>`
    : '';
  // isFavoriteFn can be a function (id) => bool or a plain boolean (legacy)
  const { onFavorite } = opts;
  const isFavRaw  = opts.isFavoriteFn ? opts.isFavoriteFn(entry.id) : (opts.isFavorite ?? false);
  const isFav     = Boolean(isFavRaw);
  const favBtnHtml = onFavorite
    ? `<button class="card-fav-btn${isFav ? ' card-fav-btn--active' : ''}" type="button"
         title="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
         aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
         aria-pressed="${isFav}">
         ${isFav ? '★' : '☆'}
       </button>`
    : '';
  const _pbiSrcs       = _getPbiSources(entry);
  const _hasAutoDetect = !_pbiSrcs.length && !entry.dataSources?.length && (entry.filename || entry.blobUrl);
  const infoBtnHtml    = (_pbiSrcs.length || entry.dataSources?.length || _hasAutoDetect)
    ? `<button class="card-info-btn" type="button" title="View data sources" aria-label="View data sources for ${entry.title}">ⓘ</button>`
    : '';

  article.innerHTML = `
    <div class="${accentClass}"${accentStyle} aria-hidden="true">${liveBadgeHtml}</div>
    <div class="card-body">
      <div class="card-header-row">
        <span class="card-category-badge">${entry.category || 'Uncategorized'}</span>
        <div class="card-header-actions">
          ${entry.openInNewTab ? '<span class="card-newtab-badge" title="Opens in new tab">↗ New Tab</span>' : ''}
          ${favBtnHtml}
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

  // ---- Favorite toggle ------------------------------------
  if (onFavorite) {
    article.querySelector('.card-fav-btn').addEventListener('click', e => {
      e.stopPropagation();
      onFavorite(entry.id);
    });
  }

  // ---- Data source info -----------------------------------
  if (infoBtnHtml) {
    article.querySelector('.card-info-btn').addEventListener('click', e => {
      e.stopPropagation();
      _openDataSourceInfoModal(entry, onEdit);
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

// ---- Shared schema helpers -----------------------------------------

function _schemaTableHtml(t) {
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
}

function _wirePbiSourceBlock(block, src) {
  const cacheKey   = `pbi-schema-${src.datasetId}`;
  const refreshBtn = block.querySelector('.btn-ds-refresh');
  const refreshLbl = block.querySelector('.btn-ds-refresh-label');
  const schemaBody = block.querySelector('.ds-schema-body');

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
      tables.map(_schemaTableHtml).join('');
    refreshLbl.textContent = '↻ Refresh';
  }

  async function fetchSchema() {
    refreshBtn.disabled = true;
    refreshLbl.textContent = 'Loading…';
    schemaBody.innerHTML = '<p class="ds-schema-loading"><span class="ds-spinner"></span>Fetching from Power BI…</p>';
    try {
      const res = await fetch(`/api/pbi-schema?workspaceId=${src.workspaceId}&datasetId=${src.datasetId}`);
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

  // Auto-render from cache
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try { renderSchema(JSON.parse(cached)); } catch { /* corrupt */ }
  }

  refreshBtn.addEventListener('click', fetchSchema);
}

function _pbiSourceBlockHtml(src) {
  return `
    <div class="ds-schema-section" data-src-id="${src.id}">
      <div class="ds-schema-header">
        <span class="ds-schema-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
          </svg>
          ${src.label || 'Dataset'}
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
    </div>`;
}

// ---- Data source info modal (read-only + multi-source PBI schema) ---
function _openDataSourceInfoModal(entry, onEdit) {
  const pbiSources    = _getPbiSources(entry);
  const dsSources     = entry.dataSources || [];
  const canAutoDetect = !pbiSources.length && !dsSources.length && (entry.filename || entry.blobUrl);

  // Manually defined metadata
  const metaHtml = dsSources.map(ds => `
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

  // One schema block per linked PBI dataset
  const schemaHtml = pbiSources.map(_pbiSourceBlockHtml).join('');

  // Auto-detect placeholder — replaced after API call
  const detectHtml = canAutoDetect
    ? `<div class="ds-detect-section">
        <p class="ds-schema-loading"><span class="ds-spinner"></span>Detecting Power BI data source…</p>
       </div>`
    : '';

  const bodyHtml = (metaHtml || schemaHtml || detectHtml) ||
    '<p class="ds-empty">No data source information available.</p>';

  _openModal({
    title:    entry.title,
    subtitle: 'Data Sources',
    bodyHtml,
    wide:     true,
    onMount(modal) {
      // Wire any pre-linked PBI sources
      pbiSources.forEach(src => {
        const block = modal.querySelector(`.ds-schema-section[data-src-id="${src.id}"]`);
        if (block) _wirePbiSourceBlock(block, src);
      });

      // Auto-detect if no sources are linked yet but the card has an HTML file
      if (canAutoDetect) {
        _autoDetectAndRender(modal, entry, onEdit);
      }
    },
  });
}

/** Fetch /api/pbi-detect and populate the modal with the discovered schema. */
async function _autoDetectAndRender(modal, entry, onEdit) {
  const detectSection = modal.querySelector('.ds-detect-section');
  if (!detectSection) return;

  try {
    const param = entry.blobUrl
      ? `blobUrl=${encodeURIComponent(entry.blobUrl)}`
      : `filename=${encodeURIComponent(entry.filename)}`;

    const res  = await fetch(`/api/pbi-detect?${param}`);
    const data = await res.json();

    if (!res.ok) {
      detectSection.innerHTML =
        `<p class="ds-schema-error">⚠ Auto-detect failed: ${data.error || res.statusText}</p>`;
      return;
    }

    // Build a source object from the detected info
    const src = {
      id:          crypto.randomUUID?.() ?? String(Date.now()),
      label:       data.reportName || 'Auto-detected',
      workspaceId: data.datasetWorkspaceId || data.workspaceId,
      datasetId:   data.datasetId,
    };

    const saveBtnHtml = onEdit
      ? `<div class="ds-save-detected">
           <p class="ds-detect-hint">Dataset auto-detected from report file.</p>
           <button type="button" class="btn-ds-save-link">💾 Save Data Source</button>
         </div>`
      : '';

    // Inject schema block + optional save button right after the detect placeholder
    detectSection.insertAdjacentHTML('afterend', _pbiSourceBlockHtml(src) + saveBtnHtml);
    detectSection.remove();

    // Wire the new schema block
    const block = modal.querySelector(`.ds-schema-section[data-src-id="${src.id}"]`);
    if (block) {
      _wirePbiSourceBlock(block, src);
      // Auto-load schema immediately since we just detected it
      block.querySelector('.btn-ds-refresh')?.click();
    }

    // Wire save button
    if (onEdit) {
      const saveBtn = modal.querySelector('.btn-ds-save-link');
      saveBtn?.addEventListener('click', async () => {
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        try {
          await onEdit(entry, 'save', { powerBiSources: [src] });
          saveBtn.textContent = '✓ Saved';
        } catch {
          saveBtn.disabled    = false;
          saveBtn.textContent = '⚠ Save failed — retry';
        }
      });
    }

  } catch (err) {
    const detectSection2 = modal.querySelector('.ds-detect-section');
    if (detectSection2) {
      detectSection2.innerHTML =
        `<p class="ds-schema-error">⚠ Auto-detect failed: ${err.message}</p>`;
    }
  }
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
        Power BI Datasets
        <button type="button" class="btn-pbi-add">+ Add</button>
      </div>
      <div class="pbi-source-list"></div>
      <div class="pbi-add-form" hidden>
        <input type="text" class="pbi-input pbi-f-label"     placeholder="Label (e.g. Lodestar)">
        <input type="text" class="pbi-input pbi-f-workspace" placeholder="Workspace ID" spellcheck="false" autocomplete="off">
        <input type="text" class="pbi-input pbi-f-dataset"   placeholder="Dataset ID"   spellcheck="false" autocomplete="off">
        <div class="pbi-form-btns">
          <button type="button" class="btn-pbi-confirm btn-card-save">Add</button>
          <button type="button" class="btn-pbi-discard btn-card-cancel">Cancel</button>
        </div>
      </div>
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

      // ---- Multi-source PBI manager -------------------------
      let pendingSources = JSON.parse(JSON.stringify(_getPbiSources(entry)));
      const sourceList   = modal.querySelector('.pbi-source-list');
      const addForm      = modal.querySelector('.pbi-add-form');
      const addBtn       = modal.querySelector('.btn-pbi-add');

      function renderSources() {
        sourceList.innerHTML = pendingSources.length
          ? pendingSources.map((s, i) => `
              <div class="pbi-source-item">
                <span class="pbi-source-label">${s.label || 'Dataset'}</span>
                <span class="pbi-source-id">${s.datasetId.slice(0, 8)}…</span>
                <button type="button" class="ds-remove-btn" data-index="${i}" aria-label="Remove">×</button>
              </div>`).join('')
          : '<p class="pbi-no-sources">No datasets linked.</p>';

        sourceList.querySelectorAll('.ds-remove-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            pendingSources.splice(parseInt(btn.dataset.index), 1);
            renderSources();
          });
        });
      }
      renderSources();

      addBtn.addEventListener('click', () => {
        addForm.hidden = false;
        addBtn.hidden  = true;
        modal.querySelector('.pbi-f-label').focus();
      });

      modal.querySelector('.btn-pbi-discard').addEventListener('click', () => {
        addForm.hidden = true;
        addBtn.hidden  = false;
        modal.querySelector('.pbi-f-label').value     = '';
        modal.querySelector('.pbi-f-workspace').value = '';
        modal.querySelector('.pbi-f-dataset').value   = '';
      });

      modal.querySelector('.btn-pbi-confirm').addEventListener('click', () => {
        const wsId = modal.querySelector('.pbi-f-workspace').value.trim();
        const dsId = modal.querySelector('.pbi-f-dataset').value.trim();
        if (!wsId || !dsId) {
          modal.querySelector(wsId ? '.pbi-f-dataset' : '.pbi-f-workspace').focus();
          return;
        }
        pendingSources.push({
          id:          crypto.randomUUID?.() ?? String(Date.now()),
          label:       modal.querySelector('.pbi-f-label').value.trim() || 'Dataset',
          workspaceId: wsId,
          datasetId:   dsId,
        });
        addForm.hidden = true;
        addBtn.hidden  = false;
        modal.querySelector('.pbi-f-label').value     = '';
        modal.querySelector('.pbi-f-workspace').value = '';
        modal.querySelector('.pbi-f-dataset').value   = '';
        renderSources();
      });

      // ---- Save / Delete / Cancel ---------------------------
      modal.querySelector('.btn-card-save').addEventListener('click', async () => {
        const updates = {};
        if (pendingCategory !== entry.category) updates.category = pendingCategory;
        const pa = getPending();
        if (pa !== (entry.accentColor ?? null)) updates.accentColor = pa;
        if (JSON.stringify(pendingSources) !== JSON.stringify(_getPbiSources(entry))) {
          updates.powerBiSources     = pendingSources;
          updates.powerBiWorkspaceId = null;   // clear legacy fields
          updates.powerBiDatasetId   = null;
        }
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
 * Pass `favCount` > 0 to prepend a special Favorites folder card.
 */
export function renderCategoryCards(categories, registry, onCategoryClick, onCategoryEdit, favCount = 0) {
  const grid = document.getElementById('card-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Favorites folder (only shown when user has at least one favorite)
  if (favCount > 0) {
    grid.appendChild(createFavoritesCategoryCard(favCount, onCategoryClick));
  }

  categories.forEach(cat => {
    const count = registry.filter(d => d.category === cat).length;
    grid.appendChild(createCategoryCard(cat, count, onCategoryClick, onCategoryEdit));
  });
}

/** Special "★ Favorites" folder card — always first in the grid. */
function createFavoritesCategoryCard(count, onClick) {
  const article = document.createElement('article');
  article.className = 'dashboard-card category-card category-card--favorites';
  article.dataset.category = '★ Favorites';

  article.innerHTML = `
    <div class="card-accent card-accent--favorites" aria-hidden="true"></div>
    <div class="card-body">
      <div class="card-header-row">
        <span class="card-category-badge card-category-badge--favorites">Favorites</span>
      </div>
      <h2 class="card-title card-title--favorites">
        <span class="fav-folder-star" aria-hidden="true">★</span> Favorites
      </h2>
      <p class="card-description">${count} saved dashboard${count !== 1 ? 's' : ''}</p>
    </div>
  `;

  article.setAttribute('tabindex', '0');
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Favorites — ${count} saved dashboard${count !== 1 ? 's' : ''}`);
  article.addEventListener('click', () => onClick('★ Favorites'));
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); article.click(); }
  });

  return article;
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
