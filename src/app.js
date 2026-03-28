/**
 * app.js — Hub home page orchestrator (index.html)
 * Wires together: registry → filters → cards → navigation → UI events
 */

import { loadRegistry, RegistryLoadError }        from './modules/registry.js';
import { filterDashboards, extractCategories }     from './modules/filters.js';
import { renderCards }                             from './modules/cards.js';
import { getParam, setParam }                      from './modules/router.js';
import { showSpinner, hideSpinner, showEmptyState,
         hideEmptyState, showRegistryError, show } from './modules/ui.js';
import { initNav }                                 from './modules/nav.js';

// ---- State ------------------------------------------------
let registry      = [];
let navController = null;
let activeFilters = {
  query:    '',
  category: null,
  tags:     new Set()
};

// ---- Debounce helper --------------------------------------
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ---- Render cycle -----------------------------------------
function applyFilters() {
  const filtered = filterDashboards(registry, activeFilters);

  renderCards(filtered);
  updateResultCount(filtered.length);

  if (filtered.length === 0) {
    const msg = registry.length === 0
      ? 'No dashboards yet — publish one from Settings.'
      : 'No dashboards match your search.';
    showEmptyState(msg);
  } else {
    hideEmptyState();
  }
}

// ---- Filter bar (category pills) --------------------------
function buildFilterBar(categories) {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;

  // Remove any existing pills (but keep the label)
  bar.querySelectorAll('.pill').forEach(p => p.remove());

  // "All" pill
  const allPill = createPill('All', !activeFilters.category);
  allPill.addEventListener('click', () => {
    activeFilters.category = null;
    setParam('category', null);
    updateActivePill(bar, 'All');
    navController?.setActiveCategory(null);
    applyFilters();
  });
  bar.appendChild(allPill);

  // One pill per category
  categories.forEach(cat => {
    const pill = createPill(cat, activeFilters.category === cat);
    pill.addEventListener('click', () => {
      activeFilters.category = cat;
      setParam('category', cat);
      updateActivePill(bar, cat);
      navController?.setActiveCategory(cat);
      applyFilters();
    });
    bar.appendChild(pill);
  });
}

function createPill(label, isActive) {
  const btn = document.createElement('button');
  btn.className = 'pill' + (isActive ? ' active' : '');
  btn.textContent = label;
  btn.dataset.cat = label;
  btn.type = 'button';
  return btn;
}

function updateActivePill(bar, activeLabel) {
  bar.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.cat === activeLabel);
  });
}

// ---- Result count -----------------------------------------
function updateResultCount(count) {
  const el = document.getElementById('result-count');
  if (el) el.textContent = `${count} dashboard${count !== 1 ? 's' : ''}`;
}

// ---- Search input -----------------------------------------
function initSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  // Pre-fill if URL has a query
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

    // Pre-apply deep-link category filter from URL
    const urlCat = getParam('category');
    if (urlCat) activeFilters.category = urlCat;

    const categories = extractCategories(registry);
    buildFilterBar(categories);

    // Initialize navigation module (sidebar + layout toggle).
    // Pass the full registry so the sidebar can list individual dashboards.
    const bar = document.getElementById('filter-bar');
    navController = initNav(registry, (cat) => {
      activeFilters.category = cat;
      setParam('category', cat ?? null);
      if (bar) updateActivePill(bar, cat ?? 'All');
      applyFilters();
    });

    // Sync sidebar to URL-preloaded category (card mode only)
    if (navController && activeFilters.category) {
      navController.setActiveCategory(activeFilters.category);
    }

    initSearch();
    applyFilters();

  } catch (err) {
    if (err instanceof RegistryLoadError) {
      showRegistryError();
    }
    // Unexpected non-registry errors: logged to console, finally still runs

  } finally {
    // Always hide spinner and show grid, even if something above threw
    hideSpinner();
    show('card-grid');
  }
}

init();
