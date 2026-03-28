/**
 * nav.js — Navigation layout manager
 * Responsibility: manage sidebar vs. pill layout toggle and sidebar collapse state.
 *
 * Layout modes:
 *   'card'    — default; filter pills visible, no sidebar
 *   'sidebar' — collapsible left-hand category sidebar; pills hidden
 *
 * Preferences are stored in localStorage and restored on page load.
 *
 * Exports: initNav(categories, onCategorySelect)
 */

const LS_LAYOUT    = 'hub-layout';            // stored value: 'card' | 'sidebar'
const LS_COLLAPSED = 'hub-sidebar-collapsed'; // stored value: 'true' | 'false'

// ---- Preference helpers ------------------------------------

function storedLayout() {
  return localStorage.getItem(LS_LAYOUT) === 'sidebar' ? 'sidebar' : 'card';
}

function storedCollapsed() {
  return localStorage.getItem(LS_COLLAPSED) === 'true';
}

// ---- DOM helpers -------------------------------------------

/**
 * Apply layout class to body and swap toggle button icons.
 * @param {'card'|'sidebar'} layout
 */
function applyLayout(layout) {
  document.body.classList.toggle('layout-sidebar', layout === 'sidebar');

  // Swap icons: show sidebar icon when in card mode (to invite switching),
  // show card icon when in sidebar mode (to invite switching back).
  const iconSidebar = document.getElementById('layout-icon-sidebar');
  const iconCard    = document.getElementById('layout-icon-card');
  if (iconSidebar) iconSidebar.hidden = layout === 'sidebar';
  if (iconCard)    iconCard.hidden    = layout !== 'sidebar';
}

/**
 * Apply collapsed class to sidebar element and update aria label.
 * @param {boolean} collapsed
 */
function applyCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('sidebar--collapsed', collapsed);

  const btn = document.getElementById('sidebar-collapse-btn');
  if (btn) {
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
}

// ---- Sidebar item rendering --------------------------------

/**
 * Create a single sidebar nav item button.
 * @param {string}   label     — display text and data-cat value
 * @param {boolean}  isActive  — whether this item is currently selected
 * @param {function} onClick   — called when the item is clicked
 * @returns {HTMLButtonElement}
 */
function createSidebarItem(label, isActive, onClick) {
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
    // Update active class on all sidebar items immediately
    document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(el => {
      el.classList.toggle('active', el.dataset.cat === label);
    });
    onClick();
  });

  return btn;
}

/**
 * Render (or re-render) the sidebar category list.
 * @param {string[]}     categories     — from extractCategories()
 * @param {string|null}  activeCategory — currently selected category (null = All)
 * @param {function}     onSelect       — callback(category: string|null)
 */
function renderSidebarItems(categories, activeCategory, onSelect) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  nav.innerHTML = '';

  // "All" item
  nav.appendChild(
    createSidebarItem('All', activeCategory === null, () => onSelect(null))
  );

  // One item per category
  categories.forEach(cat => {
    nav.appendChild(
      createSidebarItem(cat, activeCategory === cat, () => onSelect(cat))
    );
  });
}

// ---- Public API --------------------------------------------

/**
 * Initialize the navigation module.
 * Call this after the registry has loaded and extractCategories() has run.
 *
 * @param {string[]} categories       — category list from extractCategories()
 * @param {function} onCategorySelect — callback: receives category string or null ("All")
 * @returns {{ setActiveCategory: function }} — controller to sync active state from outside
 */
export function initNav(categories, onCategorySelect) {
  let layout    = storedLayout();
  let collapsed = storedCollapsed();

  // Render initial sidebar items (no active category — "All")
  renderSidebarItems(categories, null, onCategorySelect);

  // Apply persisted preferences on load
  applyLayout(layout);
  applyCollapsed(collapsed);

  // ---- Layout toggle button (top nav bar) ------------------
  const layoutBtn = document.getElementById('layout-toggle-btn');
  if (layoutBtn) {
    layoutBtn.addEventListener('click', () => {
      layout = layout === 'card' ? 'sidebar' : 'card';
      localStorage.setItem(LS_LAYOUT, layout);
      applyLayout(layout);
    });
  }

  // ---- Sidebar collapse button (inside sidebar) ------------
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      localStorage.setItem(LS_COLLAPSED, String(collapsed));
      applyCollapsed(collapsed);
    });
  }

  // ---- Return controller for bidirectional sync ------------
  return {
    /**
     * Highlight the given category in the sidebar.
     * Called by app.js when a filter pill is clicked, so both nav
     * surfaces stay in sync.
     * @param {string|null} cat — null means "All"
     */
    setActiveCategory(cat) {
      const label = cat ?? 'All';
      document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.cat === label);
      });
    }
  };
}
