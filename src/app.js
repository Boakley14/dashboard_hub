/**
 * app.js — Hub home page orchestrator (index.html)
 * Wires together: registry → view state → cards → navigation → UI events
 */

import { applyTheme, applyNavColor, getFirstName }      from './modules/theme.js';
import { loadRegistry, invalidateCache, RegistryLoadError } from './modules/registry.js';
import { filterDashboards, extractCategories }           from './modules/filters.js';
import { renderCards, renderCategoryCards }              from './modules/cards.js';
import { getParam, setParam }                            from './modules/router.js';
import { showSpinner, hideSpinner, showEmptyState,
         hideEmptyState, showRegistryError, show }       from './modules/ui.js';
import { initNav }                                       from './modules/nav.js';

// Apply appearance preferences immediately (before any rendering)
applyTheme();
applyNavColor();

// ---- State ------------------------------------------------
let registry           = [];
let navController      = null;
let viewLevel          = 'categories'; // 'categories' | 'dashboards'
let activeCategoryView = null;
let activeFilters      = { query: '', tags: new Set() };

// ---- Debounce helper --------------------------------------
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ---- Breadcrumb -------------------------------------------
function updateBreadcrumb(category) {
  const el = document.getElementById('breadcrumb');
  if (!el) return;

  if (!category) { el.hidden = true; el.innerHTML = ''; return; }

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

// ---- Card edit handler ------------------------------------
async function handleCardEdit(entry, action, updates) {
  if (action === 'delete') {
    if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, filename: entry.filename })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);
      invalidateCache();
      registry = await loadRegistry();
      applyFilters();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
    return;
  }

  if (action === 'save') {
    try {
      const res = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, updates })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);
      invalidateCache();
      registry = await loadRegistry();
      applyFilters();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }
}

// ---- Render cycle -----------------------------------------
function applyFilters() {
  const hasSearch = activeFilters.query.trim().length > 0;
  const categories = extractCategories(registry);
  const editOpts   = { onEdit: handleCardEdit, categories };

  if (hasSearch) {
    const filtered = filterDashboards(registry, activeFilters);
    renderCards(filtered, editOpts);
    updateResultCount(filtered.length, 'dashboard');
    updateBreadcrumb(null);
    filtered.length === 0 ? showEmptyState('No dashboards match your search.') : hideEmptyState();
    return;
  }

  if (viewLevel === 'categories') {
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
    registry.length === 0
      ? showEmptyState('No dashboards yet — publish one from Settings.')
      : hideEmptyState();

  } else {
    const filtered = filterDashboards(registry, { category: activeCategoryView, tags: activeFilters.tags });
    renderCards(filtered, editOpts);
    updateResultCount(filtered.length, 'dashboard');
    updateBreadcrumb(activeCategoryView);
    filtered.length === 0 ? showEmptyState('No dashboards in this category.') : hideEmptyState();
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

// ---- Welcome greeting -------------------------------------
function initWelcome() {
  getFirstName().then(name => {
    const el = document.getElementById('nav-welcome');
    if (el && name) el.textContent = `Welcome, ${name}!`;
  });
}

// ---- Bootstrap --------------------------------------------
async function init() {
  showSpinner();
  initWelcome();

  try {
    registry = await loadRegistry();

    const urlCat = getParam('category');
    if (urlCat) { viewLevel = 'dashboards'; activeCategoryView = urlCat; }

    navController = initNav(registry, (cat) => {
      viewLevel          = 'dashboards';
      activeCategoryView = cat;
      setParam('category', cat ?? null);
      applyFilters();
    });

    initSearch();
    applyFilters();

  } catch (err) {
    if (err instanceof RegistryLoadError) showRegistryError();

  } finally {
    hideSpinner();
    show('card-grid');
  }
}

init();
