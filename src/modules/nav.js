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
 */
function renderCategoryList(categories, onCategorySelect) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';

  if (!categories.length) {
    _sidebarEmpty(nav, 'No categories yet.');
    return;
  }

  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item';
    btn.type = 'button';
    btn.dataset.cat = cat;

    const dot = document.createElement('span');
    dot.className = 'sidebar-item-dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'sidebar-item-label';
    label.textContent = cat;

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      nav.querySelectorAll('.sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.cat === cat);
      });
      onCategorySelect(cat);
    });

    nav.appendChild(btn);
  });
}

/**
 * Sidebar mode: render expandable category sections.
 * Each category header expands to reveal dashboard items.
 * Clicking a dashboard item loads it in the inline viewer.
 */
function renderExpandableCategories(registry) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';

  if (!registry.length) {
    _sidebarEmpty(nav, 'No dashboards published yet.');
    return;
  }

  // Group by category
  const groups = {};
  registry.forEach(entry => {
    const cat = entry.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(entry);
  });

  Object.keys(groups).sort().forEach(cat => {
    const entries = groups[cat];

    // Wrapper
    const group = document.createElement('div');
    group.className = 'category-group';

    // Category header button (toggles expansion)
    const header = document.createElement('button');
    header.className = 'sidebar-item sidebar-item--category';
    header.type = 'button';
    header.setAttribute('aria-expanded', 'false');

    const chevron = document.createElement('span');
    chevron.className = 'sidebar-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    const labelEl = document.createElement('span');
    labelEl.className = 'sidebar-item-label';
    labelEl.textContent = cat;

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

    // Dashboard items (hidden until category is expanded)
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'category-group-items';

    entries.forEach(entry => {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item sidebar-item--dashboard';
      btn.type = 'button';
      btn.dataset.id = entry.id;

      const dot = document.createElement('span');
      dot.className = 'sidebar-item-dot';
      dot.setAttribute('aria-hidden', 'true');

      const lbl = document.createElement('span');
      lbl.className = 'sidebar-item-label';
      lbl.textContent = entry.title;

      btn.appendChild(dot);
      btn.appendChild(lbl);

      btn.addEventListener('click', () => {
        // Mark active
        nav.querySelectorAll('.sidebar-item--dashboard').forEach(el => {
          el.classList.toggle('active', el.dataset.id === entry.id);
        });
        loadInlineViewer(entry);
      });

      itemsWrap.appendChild(btn);
    });

    group.appendChild(header);
    group.appendChild(itemsWrap);
    nav.appendChild(group);
  });
}

function _sidebarEmpty(nav, msg) {
  const p = document.createElement('p');
  p.style.cssText = 'padding:var(--space-4) var(--space-3);color:var(--color-text-muted);font-size:var(--font-size-xs)';
  p.textContent = msg;
  nav.appendChild(p);
}

// ---- Public API --------------------------------------------

/**
 * @param {Object[]} registry       - Full dashboard registry
 * @param {function} onCategorySelect - Callback for card mode: receives category string
 * @returns {{ setActiveCategory: function }}
 */
export function initNav(registry, onCategorySelect) {
  let layout    = storedLayout();
  let collapsed = storedCollapsed();

  const categories = extractCategories(registry);

  // Initial render based on layout
  if (layout === 'sidebar') {
    renderExpandableCategories(registry);
    showInlinePrompt();
  } else {
    renderCategoryList(categories, onCategorySelect);
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
        renderExpandableCategories(registry);
        showInlinePrompt();
      } else {
        renderCategoryList(categories, onCategorySelect);
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
