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

  article.innerHTML = `
    <div class="${accentClass}"${accentStyle} aria-hidden="true"></div>
    <div class="card-body">
      <div class="card-header-row">
        <span class="card-category-badge">${entry.category || 'Uncategorized'}</span>
        <div class="card-header-actions">
          ${entry.openInNewTab ? '<span class="card-newtab-badge" title="Opens in new tab">↗ New Tab</span>' : ''}
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

function _openModal({ title, subtitle, bodyHtml, onMount }) {
  _closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  overlay.innerHTML = `
    <div class="card-modal" role="dialog" aria-modal="true">
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
    onMount(modal) {
      const { getPending } = _wireColorPicker(modal);
      modal.querySelector('.card-edit-category')
           .addEventListener('change', e => { pendingCategory = e.target.value; });

      modal.querySelector('.btn-card-save').addEventListener('click', async () => {
        const updates = {};
        if (pendingCategory !== entry.category) updates.category = pendingCategory;
        const pa = getPending();
        if (pa !== (entry.accentColor ?? null)) updates.accentColor = pa;
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
