/**
 * app.js — Hub home page orchestrator (index.html)
 * Wires together: registry → view state → cards → navigation → UI events
 *
 * Two-level card navigation:
 *   Level 1 — category folder cards (default)
 *   Level 2 — dashboard cards within a selected category
 *
 * Search always shows flat dashboard results across all categories.
 */

import { loadRegistry, RegistryLoadError }           from './modules/registry.js';
import { filterDashboards, extractCategories }        from './modules/filters.js';
import { renderCards, renderCategoryCards }           from './modules/cards.js';
import { getParam, setParam }                         from './modules/router.js';
import { showSpinner, hideSpinner, showEmptyState,
         hideEmptyState, showRegistryError, show }    from './modules/ui.js';
import { initNav }                                    from './modules/nav.js';

// ---- State ------------------------------------------------
let registry           = [];
let navController      = null;
let viewLevel          = 'categories'; // 'categories' | 'dashboards'
let activeCategoryView = null;         // category name when viewLevel === 'dashboards'
let activeFilters      = {
  query: '',
  tags:  new Set()
};

// ---- Debounce helper --------------------------------------
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ---- Breadcrumb -------------------------------------------
function updateBreadcrumb(category) {
  const el = document.getElementById('breadcrumb');
  if (!el) return;

  if (!category) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  el.hidden = false;
  el.innerHTML = `
    <button class="breadcrumb-back" type="button">← All Categories</button>
    <span class="breadcrumb-sep">/</span>
    <span class="breadcrumb-current">${category}</span>
  `;

  el.querySelector('.breadcrumb-back').addEventListener('click', () => {
    viewLevel          = 'categories';
    activeCategoryView = null;
    setParam('category', null);
    navController?.setActiveCategory(null);
    applyFilters();
  });
}

// ---- Result count -----------------------------------------
function updateResultCount(count, noun) {
  const el = document.getElementById('result-count');
  if (el) el.textContent = `${count} ${noun}${count !== 1 ? 's' : ''}`;
}

// ---- Render cycle -----------------------------------------
function applyFilters() {
  const hasSearch = activeFilters.query.trim().length > 0;

  if (hasSearch) {
    // Search overrides view level — show flat results across all categories
    const filtered = filterDashboards(registry, activeFilters);
    renderCards(filtered);
    updateResultCount(filtered.length, 'dashboard');
    updateBreadcrumb(null);
    if (filtered.length === 0) {
      showEmptyState('No dashboards match your search.');
    } else {
      hideEmptyState();
    }
    return;
  }

  if (viewLevel === 'categories') {
    const categories = extractCategories(registry);
    renderCategoryCards(categories, registry, (cat) => {
      viewLevel          = 'dashboards';
      activeCategoryView = cat;
      setParam('category', cat);
      navController?.setActiveCategory(cat);
      updateBreadcrumb(cat);
      applyFilters();
    });
    updateResultCount(categories.length, 'category');
    updateBreadcrumb(null);
    if (registry.length === 0) {
      showEmptyState('No dashboards yet — publish one from Settings.');
    } else {
      hideEmptyState();
    }

  } else {
    // Drill-down: dashboard cards for the selected category
    const filtered = filterDashboards(registry, { category: activeCategoryView, tags: activeFilters.tags });
    renderCards(filtered);
    updateResultCount(filtered.length, 'dashboard');
    updateBreadcrumb(activeCategoryView);
    if (filtered.length === 0) {
      showEmptyState('No dashboards in this category.');
    } else {
      hideEmptyState();
    }
  }
}

// ---- Search input -----------------------------------------
function initSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  const urlQuery = getParam('q');
  if (urlQuery) { input.value = urlQuery; activeFilters.query = urlQuery; }

  input.addEventListener('input', debounce(e => {
    activeFilters.query = e.target.value;
    setParam('q', e.target.value || null);
    applyFilters();
  }, 200));
}

// ---- Bootstrap --------------------------------------------
async function init() {
  showSpinner();

  try {
    registry = await loadRegistry();

    // Pre-apply deep-link category from URL (drill straight into it)
    const urlCat = getParam('category');
    if (urlCat) {
      viewLevel          = 'dashboards';
      activeCategoryView = urlCat;
    }

    // Initialize navigation sidebar + layout toggle
    navController = initNav(registry, (cat) => {
      // Called by sidebar when a category is selected (card mode)
      viewLevel          = 'dashboards';
      activeCategoryView = cat;
      setParam('category', cat ?? null);
      applyFilters();
    });

    initSearch();
    applyFilters();

  } catch (err) {
    if (err instanceof RegistryLoadError) {
      showRegistryError();
    }

  } finally {
    hideSpinner();
    show('card-grid');
  }
}

init();
