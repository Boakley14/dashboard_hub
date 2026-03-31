/**
 * nav.js — Navigation layout manager
 *
 * Card mode   (default): sidebar hidden; category folder cards shown in grid.
 * Sidebar mode:          collapsible left sidebar with expandable category
 *                        sections; clicking a dashboard loads it inline.
 *
 * Both modes share two-level navigation: categories → dashboards within category.
 *
 * Preferences stored in localStorage.
 * Exports: initNav(registry, onCategorySelect)
 */

const LS_LAYOUT    = 'hub-layout';            // 'card' | 'sidebar'
const LS_COLLAPSED = 'hub-sidebar-collapsed'; // 'true' | 'false'

// ---- Preference helpers ------------------------------------
function storedLayout()    { return localStorage.getItem(LS_LAYOUT) === 'sidebar' ? 'sidebar' : 'card'; }
function storedCollapsed() { return localStorage.getItem(LS_COLLAPSED) === 'true'; }

// ---- Layout / collapse DOM helpers -------------------------
function applyLayout(layout) {
  document.body.classList.toggle('layout-sidebar', layout === 'sidebar');
  const iconSidebar = document.getElementById('layout-icon-sidebar');
  const iconCard    = document.getElementById('layout-icon-card');
  if (iconSidebar) iconSidebar.hidden = layout === 'sidebar';
  if (iconCard)    iconCard.hidden    = layout !== 'sidebar';
}

function applyCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('sidebar--collapsed', collapsed);
  const btn = document.getElementById('sidebar-collapse-btn');
  if (btn) btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

// ---- Inline viewer helpers ---------------------------------
function showInlinePrompt() {
  const prompt   = document.getElementById('inline-viewer-prompt');
  const bar      = document.getElementById('inline-viewer-bar');
  const iframe   = document.getElementById('inline-iframe');
  const fallback = document.getElementById('inline-fallback');
  if (prompt)   prompt.hidden   = false;
  if (bar)      bar.hidden      = true;
  if (iframe)   { iframe.hidden = true; iframe.src = ''; }
  if (fallback) fallback.hidden = true;
}

function loadInlineViewer(entry) {
  const prompt   = document.getElementById('inline-viewer-prompt');
  const bar      = document.getElementById('inline-viewer-bar');
  const titleEl  = document.getElementById('inline-viewer-title');
  const catEl    = document.getElementById('inline-viewer-category');
  const newtab   = document.getElementById('inline-viewer-newtab');
  const iframe   = document.getElementById('inline-iframe');
  const fallback = document.getElementById('inline-fallback');

  const src = entry.blobUrl || `./dashboards/${entry.filename}`;

  if (prompt)   prompt.hidden   = true;
  if (fallback) { fallback.hidden = true; fallback.innerHTML = ''; }
  if (titleEl)  titleEl.textContent = entry.title;
  if (catEl)    catEl.textContent   = entry.category || '';
  if (newtab)   { newtab.href = src; newtab.hidden = false; }
  if (bar)      bar.hidden = false;

  if (!iframe) return;
  iframe.hidden = false;
  iframe.setAttribute('sandbox', [
    'allow-scripts', 'allow-same-origin', 'allow-forms',
    'allow-popups', 'allow-downloads', 'allow-modals'
  ].join(' '));
  iframe.setAttribute('title', entry.title);
  iframe.onload = () => { /* cross-origin blob — trust onload */ };
  iframe.onerror = () => _inlineError(iframe, fallback, entry, src);
  iframe.src = src;
}

function _inlineError(iframe, fallback, entry, src) {
  if (iframe)   { iframe.hidden = true; iframe.src = ''; }
  if (fallback) {
    fallback.innerHTML = `
      <div style="text-align:center">
        <p style="color:var(--color-text-muted);margin-bottom:var(--space-4)">
          <strong>${entry.title}</strong> couldn't be displayed in the embedded viewer.
        </p>
        <a href="${src}" target="_blank" rel="noopener"
           style="background:var(--color-primary);color:#fff;padding:var(--space-2) var(--space-5);
                  border-radius:var(--border-radius-md);font-size:var(--font-size-sm);text-decoration:none">
          Open in New Tab ↗
        </a>
      </div>`;
    fallback.hidden = false;
  }
}

function clearInlineViewer() {
  const iframe = document.getElementById('inline-iframe');
  if (iframe) { iframe.src = ''; iframe.hidden = true; }
  showInlinePrompt();
}

// ---- Sidebar rendering -------------------------------------

/**
 * Card mode: render flat category list — clicking a category calls
 * onCategorySelect so app.js can drill into it via the card grid.
 * @param {string[]} categories
 * @param {function} onCategorySelect
 * @param {Set<string>} [favorites]  - If non-empty, prepend a Favorites item
 */
function renderCategoryList(categories, onCategorySelect, favorites = new Set()) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';

  if (!categories.length && !favorites.size) {
    _sidebarEmpty(nav, 'No categories yet.');
    return;
  }

  const addItem = (cat, icon) => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item';
    btn.type = 'button';
    btn.dataset.cat = cat;

    const dot = document.createElement('span');
    dot.className = icon ? 'sidebar-item-star' : 'sidebar-item-dot';
    dot.setAttribute('aria-hidden', 'true');
    if (icon) dot.textContent = icon;

    const label = document.createElement('span');
    label.className = 'sidebar-item-label';
    label.textContent = cat === '★ Favorites' ? 'Favorites' : cat;

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      nav.querySelectorAll('.sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.cat === cat);
      });
      onCategorySelect(cat);
    });

    nav.appendChild(btn);
  };

  // Favorites at the top when user has any
  if (favorites.size > 0) addItem('★ Favorites', '★');

  categories.forEach(cat => addItem(cat, null));
}

/**
 * Sidebar mode: render expandable category sections.
 * Each category header expands to reveal dashboard items.
 * Clicking a dashboard item loads it in the inline viewer.
 * @param {Object[]} registry
 * @param {function} [getFavs]           - () => Set<string> of favorited IDs
 * @param {function} [onCategorySelect]  - Optional card-mode callback (unused in sidebar, kept for API consistency)
 */
function renderExpandableCategories(registry, getFavs, onCategorySelect) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';

  if (!registry.length) {
    _sidebarEmpty(nav, 'No dashboards published yet.');
    return;
  }

  const favorites = getFavs ? getFavs() : new Set();

  // Favorites section at the top (if any)
  if (favorites.size > 0) {
    const favEntries = registry.filter(e => favorites.has(e.id));
    if (favEntries.length > 0) {
      nav.appendChild(_buildExpandableGroup('★ Favorites', favEntries, true));
    }
  }

  // Group by category
  const groups = {};
  registry.forEach(entry => {
    const cat = entry.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(entry);
  });

  Object.keys(groups).sort().forEach(cat => {
    nav.appendChild(_buildExpandableGroup(cat, groups[cat], false));
  });
}

/** Build one expandable category group for sidebar mode. */
function _buildExpandableGroup(cat, entries, isFavGroup) {
  const group = document.createElement('div');
  group.className = 'category-group' + (isFavGroup ? ' category-group--favorites' : '');

  const header = document.createElement('button');
  header.className = 'sidebar-item sidebar-item--category';
  header.type = 'button';
  header.setAttribute('aria-expanded', 'false');

  const chevron = document.createElement('span');
  chevron.className = 'sidebar-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = `<svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const labelEl = document.createElement('span');
  labelEl.className = 'sidebar-item-label';
  labelEl.textContent = isFavGroup ? '★ Favorites' : cat;

  const countEl = document.createElement('span');
  countEl.className = 'sidebar-item-count';
  countEl.textContent = entries.length;

  header.appendChild(chevron);
  header.appendChild(labelEl);
  header.appendChild(countEl);

  header.addEventListener('click', () => {
    const expanded = group.classList.toggle('category-group--expanded');
    header.setAttribute('aria-expanded', String(expanded));
  });

  const itemsWrap = document.createElement('div');
  itemsWrap.className = 'category-group-items';

  entries.forEach(entry => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item sidebar-item--dashboard';
    btn.type = 'button';
    btn.dataset.id = entry.id;

    const lbl = document.createElement('span');
    lbl.className = 'sidebar-item-label';
    lbl.textContent = entry.title;

    btn.appendChild(lbl);

    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebar-nav .sidebar-item--dashboard').forEach(el => {
        el.classList.toggle('active', el.dataset.id === entry.id);
      });
      loadInlineViewer(entry);
    });

    itemsWrap.appendChild(btn);
  });

  group.appendChild(header);
  group.appendChild(itemsWrap);
  return group;
}

function _sidebarEmpty(nav, msg) {
  const p = document.createElement('p');
  p.style.cssText = 'padding:var(--space-4) var(--space-3);color:var(--color-text-muted);font-size:var(--font-size-xs)';
  p.textContent = msg;
  nav.appendChild(p);
}

// ---- Public API --------------------------------------------

/**
 * @param {Object[]} registry         - Full dashboard registry
 * @param {function} onCategorySelect - Callback for card mode: receives category string
 * @param {function} [getCachedFavs]  - Optional: () => Set<string> of favorited IDs
 * @returns {{ setActiveCategory: function }}
 */
export function initNav(registry, onCategorySelect, getCachedFavs) {
  let layout    = storedLayout();
  let collapsed = storedCollapsed();

  const categories = extractCategories(registry);
  const getFavs    = getCachedFavs ?? (() => new Set());

  // Initial render based on layout
  if (layout === 'sidebar') {
    renderExpandableCategories(registry, getFavs, onCategorySelect);
    showInlinePrompt();
  } else {
    renderCategoryList(categories, onCategorySelect, getFavs());
  }

  applyLayout(layout);
  applyCollapsed(collapsed);

  // ---- Layout toggle (top nav) ----------------------------
  const layoutBtn = document.getElementById('layout-toggle-btn');
  if (layoutBtn) {
    layoutBtn.addEventListener('click', () => {
      layout = layout === 'card' ? 'sidebar' : 'card';
      localStorage.setItem(LS_LAYOUT, layout);
      applyLayout(layout);

      if (layout === 'sidebar') {
        renderExpandableCategories(registry, getFavs, onCategorySelect);
        showInlinePrompt();
      } else {
        renderCategoryList(categories, onCategorySelect, getFavs());
        clearInlineViewer();
      }
    });
  }

  // ---- Sidebar collapse button ----------------------------
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      localStorage.setItem(LS_COLLAPSED, String(collapsed));
      applyCollapsed(collapsed);
    });
  }

  return {
    /** Highlight the active category in the sidebar (card mode). */
    setActiveCategory(cat) {
      const label = cat ?? null;
      document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(el => {
        el.classList.toggle('active', label !== null && el.dataset.cat === label);
      });
    }
  };
}

// ---- Helpers -----------------------------------------------
function extractCategories(registry) {
  return [...new Set(registry.map(d => d.category).filter(Boolean))].sort();
}
