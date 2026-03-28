/**
 * cards.js
 * Responsibility: Create and render dashboard card DOM nodes.
 * Reads from the registry; writes to the card grid element.
 */

import { viewerUrl } from './router.js';

// Maps category names to CSS class suffixes for placeholder color coding.
// Must align with --cat-* variables in tokens.css.
const CATEGORY_CLASS_MAP = {
  'Sales':      'sales',
  'Operations': 'operations',
  'Finance':    'finance',
  'Marketing':  'marketing',
  'HR':         'hr',
};

/**
 * Returns a CSS class name for a given category string.
 * Falls back to 'default' for unknown categories.
 * @param {string} category
 * @returns {string}
 */
function categoryClass(category) {
  return CATEGORY_CLASS_MAP[category] ?? 'default';
}

/**
 * Format an ISO date string (YYYY-MM-DD) to a readable label.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch {
    return iso;
  }
}

/**
 * Create a single dashboard card as a DOM <article> element.
 * @param {Object} entry - Dashboard registry entry
 * @returns {HTMLElement}
 */
export function createCard(entry) {
  const article = document.createElement('article');
  article.className = 'dashboard-card';
  article.dataset.id = entry.id;
  article.dataset.category = entry.category || '';

  // Thumbnail: real image or CSS placeholder
  const thumbHtml = entry.thumbnail
    ? `<img class="card-thumb" src="${entry.thumbnail}" alt="${entry.title} preview" loading="lazy">`
    : `<div class="card-thumb card-thumb--placeholder cat-${categoryClass(entry.category)}" aria-hidden="true">
         <span class="card-thumb-label">${(entry.category || 'Dashboard').toUpperCase()}</span>
       </div>`;

  // Tags
  const tagsHtml = (entry.tags || [])
    .slice(0, 4) // Show max 4 tags on card
    .map(tag => `<span class="card-tag">${tag}</span>`)
    .join('');

  article.innerHTML = `
    ${thumbHtml}
    <div class="card-body">
      <div class="card-meta-top">
        <span class="card-category">${entry.category || 'Uncategorized'}</span>
        ${entry.openInNewTab ? '<span class="card-badge-newtab" title="Opens in new tab">↗</span>' : ''}
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

  // Navigate to viewer on click
  article.addEventListener('click', () => {
    if (entry.openInNewTab) {
      window.open(`./dashboards/${entry.filename}`, '_blank', 'noopener');
    } else {
      window.location.href = viewerUrl(entry.id);
    }
  });

  // Keyboard accessibility
  article.setAttribute('tabindex', '0');
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Open ${entry.title}`);
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      article.click();
    }
  });

  return article;
}

/**
 * Render a filtered list of dashboard entries into the card grid.
 * Replaces all existing cards in the grid.
 * @param {Array} entries - Filtered array of dashboard registry entries
 */
export function renderCards(entries) {
  const grid = document.getElementById('card-grid');
  if (!grid) return;
  grid.innerHTML = '';
  entries.forEach(entry => grid.appendChild(createCard(entry)));
}

/**
 * Render category "folder" cards — one card per category.
 * Clicking a card calls onCategoryClick(categoryName).
 *
 * @param {string[]} categories     - Sorted array of unique category names
 * @param {Object[]} registry       - Full dashboard registry (for counts)
 * @param {function} onCategoryClick - Called with the category string on click
 */
export function renderCategoryCards(categories, registry, onCategoryClick) {
  const grid = document.getElementById('card-grid');
  if (!grid) return;
  grid.innerHTML = '';
  categories.forEach(cat => {
    const count = registry.filter(d => d.category === cat).length;
    grid.appendChild(createCategoryCard(cat, count, onCategoryClick));
  });
}

/**
 * Create a single category folder card.
 * @param {string}   category  - Category name
 * @param {number}   count     - Number of dashboards in this category
 * @param {function} onClick   - Called with category name on click
 * @returns {HTMLElement}
 */
function createCategoryCard(category, count, onClick) {
  const article = document.createElement('article');
  article.className = 'dashboard-card category-card';
  article.dataset.category = category;

  article.innerHTML = `
    <div class="card-thumb card-thumb--placeholder cat-${categoryClass(category)}" aria-hidden="true">
      <span class="card-thumb-label">${category.toUpperCase()}</span>
    </div>
    <div class="card-body">
      <div class="card-meta-top">
        <span class="card-category">${category}</span>
        <svg class="category-card-arrow" width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2 class="card-title">${category}</h2>
      <p class="card-description">${count} dashboard${count !== 1 ? 's' : ''}</p>
    </div>
  `;

  article.setAttribute('tabindex', '0');
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Browse ${category} — ${count} dashboard${count !== 1 ? 's' : ''}`);

  article.addEventListener('click', () => onClick(category));
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); article.click(); }
  });

  return article;
}
