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

  // ---- Edit panel (injected after main content) ----------
  if (onEdit) {
    const panel = _buildEditPanel(entry, categories, onEdit, article);
    article.appendChild(panel);

    const editBtn = article.querySelector('.card-edit-btn');
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = panel.hidden === false;
      panel.hidden = open;
      article.classList.toggle('card--editing', !open);
    });
  }

  // ---- Navigate on click (not on edit button or panel) ---
  article.addEventListener('click', e => {
    if (e.target.closest('.card-edit-btn, .card-edit-panel')) return;
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

/**
 * Build the inline edit panel for a card.
 */
function _buildEditPanel(entry, categories, onEdit, article) {
  const panel = document.createElement('div');
  panel.className = 'card-edit-panel';
  panel.hidden = true;

  // Current accent color (from entry or resolved from category)
  let pendingAccent   = entry.accentColor || null;
  let pendingCategory = entry.category || '';

  // Category options
  const catOptions = categories.map(c =>
    `<option value="${c}"${c === entry.category ? ' selected' : ''}>${c}</option>`
  ).join('');

  // Color swatches
  const swatchesHtml = ACCENT_COLORS.map(({ label, hex }) => {
    const isActive = (pendingAccent ?? _categoryHex(entry.category)) === hex;
    return `<button type="button" class="color-swatch${isActive ? ' active' : ''}"
      data-hex="${hex}" title="${label}" style="background:${hex}" aria-label="${label}"></button>`;
  }).join('');

  const initialColor = pendingAccent ?? _categoryHex(entry.category);

  panel.innerHTML = `
    <div class="card-edit-row">
      <label class="card-edit-label">Category</label>
      <select class="card-edit-category">${catOptions}</select>
    </div>
    <div class="card-edit-row">
      <label class="card-edit-label">Accent color</label>
      <div class="card-color-row">
        <input type="color" class="card-color-picker" value="${initialColor}">
        <div class="color-swatches">${swatchesHtml}</div>
      </div>
    </div>
    <div class="card-edit-actions">
      <button type="button" class="btn-card-save">Save</button>
      <button type="button" class="btn-card-delete">Delete</button>
      <button type="button" class="btn-card-cancel">Cancel</button>
    </div>
  `;

  const colorPicker = panel.querySelector('.card-color-picker');
  colorPicker.addEventListener('input', () => {
    pendingAccent = colorPicker.value;
    panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  });

  // Swatch clicks
  panel.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', e => {
      e.stopPropagation();
      pendingAccent = sw.dataset.hex;
      colorPicker.value = pendingAccent;
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
  });

  // Category change
  const catSelect = panel.querySelector('.card-edit-category');
  catSelect.addEventListener('change', () => { pendingCategory = catSelect.value; });

  // Save
  panel.querySelector('.btn-card-save').addEventListener('click', async e => {
    e.stopPropagation();
    const updates = {};
    if (pendingCategory !== entry.category) updates.category = pendingCategory;
    if (pendingAccent !== (entry.accentColor || null)) updates.accentColor = pendingAccent;
    if (Object.keys(updates).length === 0) { panel.hidden = true; article.classList.remove('card--editing'); return; }
    await onEdit(entry, 'save', updates);
  });

  // Delete
  panel.querySelector('.btn-card-delete').addEventListener('click', async e => {
    e.stopPropagation();
    await onEdit(entry, 'delete', null);
  });

  // Cancel
  panel.querySelector('.btn-card-cancel').addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = true;
    article.classList.remove('card--editing');
  });

  return panel;
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
    const panel = _buildCategoryEditPanel(category, catAccent, onEdit, article);
    article.appendChild(panel);

    const editBtn = article.querySelector('.card-edit-btn');
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !panel.hidden;
      panel.hidden = open;
      article.classList.toggle('card--editing', !open);
    });
  }

  article.setAttribute('tabindex', '0');
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Browse ${category} — ${count} dashboard${count !== 1 ? 's' : ''}`);

  article.addEventListener('click', e => {
    if (e.target.closest('.card-edit-btn, .card-edit-panel')) return;
    onClick(category);
  });
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); article.click(); }
  });

  return article;
}

function _buildCategoryEditPanel(category, currentAccent, onEdit, article) {
  const panel = document.createElement('div');
  panel.className = 'card-edit-panel';
  panel.hidden = true;

  let pendingAccent = currentAccent;

  const initialColor = pendingAccent ?? _categoryHex(category);

  const swatchesHtml = ACCENT_COLORS.map(({ label, hex }) => {
    const isActive = hex === initialColor;
    return `<button type="button" class="color-swatch${isActive ? ' active' : ''}"
      data-hex="${hex}" title="${label}" style="background:${hex}" aria-label="${label}"></button>`;
  }).join('');

  panel.innerHTML = `
    <div class="card-edit-row">
      <label class="card-edit-label">Accent color</label>
      <div class="card-color-row">
        <input type="color" class="card-color-picker" value="${initialColor}">
        <div class="color-swatches">${swatchesHtml}</div>
      </div>
    </div>
    <div class="card-edit-actions">
      <button type="button" class="btn-card-save">Save</button>
      <button type="button" class="btn-card-reset">Reset</button>
      <button type="button" class="btn-card-cancel">Cancel</button>
    </div>
  `;

  const colorPicker = panel.querySelector('.card-color-picker');
  colorPicker.addEventListener('input', () => {
    pendingAccent = colorPicker.value;
    panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  });

  panel.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', e => {
      e.stopPropagation();
      pendingAccent = sw.dataset.hex;
      colorPicker.value = pendingAccent;
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
  });

  panel.querySelector('.btn-card-save').addEventListener('click', e => {
    e.stopPropagation();
    onEdit(category, pendingAccent);
  });

  panel.querySelector('.btn-card-reset').addEventListener('click', e => {
    e.stopPropagation();
    onEdit(category, null);
  });

  panel.querySelector('.btn-card-cancel').addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = true;
    article.classList.remove('card--editing');
  });

  return panel;
}
