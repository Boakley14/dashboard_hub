/**
 * nav.js — Navigation layout manager
 *
 * Card mode   (default): sidebar hidden; filter pills shown; card grid shown.
 * Sidebar mode:          sidebar shown; filter pills hidden; card grid hidden;
 *                        clicking a dashboard loads it in the inline viewer.
 *
 * Layout preference and sidebar collapse state are persisted in localStorage.
 *
 * Exports: initNav(registry, onCategorySelect)
 */

const LS_LAYOUT    = 'hub-layout';            // 'card' | 'sidebar'
const LS_COLLAPSED = 'hub-sidebar-collapsed'; // 'true' | 'false'

// ---- Preference helpers ------------------------------------

function storedLayout() {
  return localStorage.getItem(LS_LAYOUT) === 'sidebar' ? 'sidebar' : 'card';
}

function storedCollapsed() {
  return localStorage.getItem(LS_COLLAPSED) === 'true';
}

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

/**
 * Show the "select a dashboard" prompt and hide the iframe.
 */
function showInlinePrompt() {
  const prompt  = document.getElementById('inline-viewer-prompt');
  const bar     = document.getElementById('inline-viewer-bar');
  const iframe  = document.getElementById('inline-iframe');
  const fallback = document.getElementById('inline-fallback');

  if (prompt)   prompt.hidden  = false;
  if (bar)      bar.hidden     = true;
  if (iframe)   { iframe.hidden = true; iframe.src = ''; }
  if (fallback) fallback.hidden = true;
}

/**
 * Load a dashboard entry into the inline iframe.
 * @param {Object} entry - Dashboard registry entry
 */
function loadInlineViewer(entry) {
  const prompt   = document.getElementById('inline-viewer-prompt');
  const bar      = document.getElementById('inline-viewer-bar');
  const titleEl  = document.getElementById('inline-viewer-title');
  const catEl    = document.getElementById('inline-viewer-category');
  const newtab   = document.getElementById('inline-viewer-newtab');
  const iframe   = document.getElementById('inline-iframe');
  const fallback = document.getElementById('inline-fallback');

  const src = entry.blobUrl || `./dashboards/${entry.filename}`;

  if (prompt) prompt.hidden = true;
  if (fallback) { fallback.hidden = true; fallback.innerHTML = ''; }

  // Populate the bar
  if (titleEl) titleEl.textContent = entry.title;
  if (catEl)   catEl.textContent   = entry.category || '';
  if (newtab)  { newtab.href = src; newtab.hidden = false; }
  if (bar)     bar.hidden = false;

  // Mount the iframe
  if (!iframe) return;
  iframe.hidden = false;
  iframe.setAttribute('sandbox', [
    'allow-scripts', 'allow-same-origin', 'allow-forms',
    'allow-popups', 'allow-downloads', 'allow-modals'
  ].join(' '));
  iframe.setAttribute('title', entry.title);

  iframe.onload = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc || (!doc.body && !doc.head)) {
        _inlineError(iframe, fallback, entry, src);
      }
      // SecurityError = cross-origin success — do nothing
    } catch (e) {
      if (e.name !== 'SecurityError') {
        _inlineError(iframe, fallback, entry, src);
      }
    }
  };

  iframe.onerror = () => _inlineError(iframe, fallback, entry, src);
  iframe.src = src;
}

function _inlineError(iframe, fallback, entry, src) {
  if (iframe)  { iframe.hidden = true; iframe.src = ''; }
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

/**
 * Clear the inline viewer when switching back to card mode.
 */
function clearInlineViewer() {
  const iframe = document.getElementById('inline-iframe');
  if (iframe) { iframe.src = ''; iframe.hidden = true; }
  showInlinePrompt();
}

// ---- Sidebar content rendering -----------------------------

/**
 * In card mode: render category list (each click filters the card grid).
 */
function renderCategoryList(categories, activeCategory, onCategorySelect) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';

  nav.appendChild(createCatItem('All', activeCategory === null, () => onCategorySelect(null)));
  categories.forEach(cat => {
    nav.appendChild(createCatItem(cat, activeCategory === cat, () => onCategorySelect(cat)));
  });
}

function createCatItem(label, isActive, onClick) {
  const btn = document.createElement('button');
  btn.className = 'sidebar-item' + (isActive ? ' active' : '');
  btn.type = 'button';
  btn.dataset.cat = label;

  const dot = document.createElement('span');
  dot.className = 'sidebar-item-dot';
  dot.setAttribute('aria-hidden', 'true');

  const labelEl = document.createElement('span');
  labelEl.className = 'sidebar-item-label';
  labelEl.textContent = label;

  btn.appendChild(dot);
  btn.appendChild(labelEl);
  btn.addEventListener('click', () => {
    nav.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.toggle('active', el.dataset.cat === label);
    });
    onClick();
  });
  return btn;
}

/**
 * In sidebar mode: render dashboards grouped by category.
 * Clicking a dashboard loads it in the inline viewer.
 */
function renderDashboardList(registry) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';

  if (!registry.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-item-label';
    empty.style.cssText = 'padding:var(--space-4) var(--space-3);color:var(--color-text-muted);font-size:var(--font-size-xs)';
    empty.textContent = 'No dashboards published yet.';
    nav.appendChild(empty);
    return;
  }

  // Group by category
  const groups = {};
  const uncategorised = [];
  registry.forEach(entry => {
    const cat = entry.category || '';
    if (cat) {
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(entry);
    } else {
      uncategorised.push(entry);
    }
  });

  // Render each category group
  Object.keys(groups).sort().forEach(cat => {
    const label = document.createElement('div');
    label.className = 'sidebar-group-label';
    label.textContent = cat;
    nav.appendChild(label);

    groups[cat].forEach(entry => {
      nav.appendChild(createDashboardItem(entry, nav));
    });
  });

  // Uncategorised dashboards at the bottom
  if (uncategorised.length) {
    const label = document.createElement('div');
    label.className = 'sidebar-group-label';
    label.textContent = 'Other';
    nav.appendChild(label);
    uncategorised.forEach(entry => {
      nav.appendChild(createDashboardItem(entry, nav));
    });
  }
}

function createDashboardItem(entry, nav) {
  const btn = document.createElement('button');
  btn.className = 'sidebar-item sidebar-item--dashboard';
  btn.type = 'button';
  btn.dataset.id = entry.id;

  const dot = document.createElement('span');
  dot.className = 'sidebar-item-dot';
  dot.setAttribute('aria-hidden', 'true');

  const labelEl = document.createElement('span');
  labelEl.className = 'sidebar-item-label';
  labelEl.textContent = entry.title;

  btn.appendChild(dot);
  btn.appendChild(labelEl);

  btn.addEventListener('click', () => {
    // Highlight active item
    nav.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === entry.id);
    });
    loadInlineViewer(entry);
  });

  return btn;
}

// ---- Public API --------------------------------------------

/**
 * Initialize the navigation module.
 *
 * @param {Object[]} registry       - Full dashboard registry array
 * @param {function} onCategorySelect - Callback (card mode only): receives cat string or null
 * @returns {{ setActiveCategory: function }}
 */
export function initNav(registry, onCategorySelect) {
  let layout    = storedLayout();
  let collapsed = storedCollapsed();

  const categories = [...new Set(registry.map(d => d.category).filter(Boolean))].sort();

  // Initial render
  if (layout === 'sidebar') {
    renderDashboardList(registry);
    showInlinePrompt();
  } else {
    renderCategoryList(categories, null, onCategorySelect);
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
        renderDashboardList(registry);
        showInlinePrompt();
      } else {
        renderCategoryList(categories, null, onCategorySelect);
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

  // ---- Controller returned to app.js (card mode sync) ----
  return {
    /**
     * Sync the active category highlight in the sidebar (card mode only).
     * @param {string|null} cat
     */
    setActiveCategory(cat) {
      const label = cat ?? 'All';
      document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.cat === label);
      });
    }
  };
}
