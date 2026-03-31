/**
 * app.js — Hub home page orchestrator (index.html)
 * Wires together: registry → view state → cards → navigation → UI events
 */

import { applyTheme, applyNavColor, applyNavTextColor, getFirstName } from './modules/theme.js';
import { loadRegistry, invalidateCache, RegistryLoadError } from './modules/registry.js';
import { filterDashboards, extractCategories }           from './modules/filters.js';
import { renderCards, renderCategoryCards }              from './modules/cards.js';
import { getParam, setParam }                            from './modules/router.js';
import { showSpinner, hideSpinner, showEmptyState,
         hideEmptyState, showRegistryError, show }       from './modules/ui.js';
import { initNav }                                       from './modules/nav.js';
import { loadFavorites, toggleFavorite, getCached,
         isFavorite, onFavoritesChange }                 from './modules/favorites.js';

// Apply appearance preferences immediately (before any rendering)
applyTheme();
applyNavColor();
applyNavTextColor();

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

// ---- Favorite toggle handler ------------------------------
async function handleFavoriteToggle(dashboardId) {
  await toggleFavorite(dashboardId);
  applyFilters();  // re-render cards with updated star state + Favorites folder count
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

// ---- Category card edit handler ---------------------------
function handleCategoryEdit(category, accentColor) {
  const key = `hub-cat-color-${category}`;
  if (accentColor === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, accentColor);
  }
  applyFilters();
}

// ---- Render cycle -----------------------------------------
function applyFilters() {
  const hasSearch  = activeFilters.query.trim().length > 0;
  const categories = extractCategories(registry);
  const favorites  = getCached();  // synchronous — already loaded by init()

  // Uniform opts with per-entry favorite resolution via isFavoriteFn
  const editOpts = {
    onEdit:        handleCardEdit,
    categories,
    isFavoriteFn:  (id) => favorites.has(id),
    onFavorite:    handleFavoriteToggle,
  };

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
    }, handleCategoryEdit, favorites.size);
    updateResultCount(categories.length + (favorites.size > 0 ? 1 : 0), 'category');
    updateBreadcrumb(null);
    registry.length === 0
      ? showEmptyState('No dashboards yet — publish one from Settings.')
      : hideEmptyState();

  } else {
    // Favorites virtual category — filter by favorited IDs instead of category field
    const filtered = activeCategoryView === '★ Favorites'
      ? registry.filter(d => favorites.has(d.id))
      : filterDashboards(registry, { category: activeCategoryView, tags: activeFilters.tags });

    renderCards(filtered, editOpts);
    updateResultCount(filtered.length, 'dashboard');
    updateBreadcrumb(activeCategoryView);
    filtered.length === 0
      ? showEmptyState(activeCategoryView === '★ Favorites'
          ? 'No favorites yet — click ☆ on any dashboard to save it here.'
          : 'No dashboards in this category.')
      : hideEmptyState();
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

// ---- Hub title --------------------------------------------
function initHubTitle() {
  const name = localStorage.getItem('hub-name') || 'Dashboard Hub';

  const h1 = document.getElementById('hub-title');
  if (h1) h1.textContent = name;

  // Show the name in the sidebar header too (visible in sidebar mode)
  const sidebarTitle = document.querySelector('.sidebar-title');
  if (sidebarTitle) sidebarTitle.textContent = name;

  document.title = `10 Federal — ${name}`;
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
  initHubTitle();
  initWelcome();

  try {
    // Load registry and favorites in parallel
    [registry] = await Promise.all([
      loadRegistry(),
      loadFavorites(),  // warms the cache so getCached() is synchronous during rendering
    ]);

    const urlCat = getParam('category');
    if (urlCat) { viewLevel = 'dashboards'; activeCategoryView = urlCat; }

    navController = initNav(registry, (cat) => {
      viewLevel          = 'dashboards';
      activeCategoryView = cat;
      setParam('category', cat ?? null);
      applyFilters();
    }, getCached);  // pass getCached so nav can show Favorites in sidebar

    initSearch();
    applyFilters();

    // Re-render when favorites change (e.g. from a toggle in sidebar mode)
    onFavoritesChange(() => applyFilters());

  } catch (err) {
    if (err instanceof RegistryLoadError) showRegistryError();

  } finally {
    hideSpinner();
    show('card-grid');
  }
}

init();
