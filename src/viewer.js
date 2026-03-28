/**
 * viewer.js — Dashboard viewer page orchestrator (viewer.html)
 * Wires together: router → registry → iframe / fallback
 */

import { applyTheme, applyNavColor } from './modules/theme.js';
import { findById }                  from './modules/registry.js';
import { getParam }                  from './modules/router.js';
import { mountIframe }               from './modules/iframe.js';
import { hideSpinner, show, hide }   from './modules/ui.js';

applyTheme();
applyNavColor();

async function init() {
  const id = getParam('id');

  // No id in URL → show error
  if (!id) {
    showNotFound();
    return;
  }

  let entry;
  try {
    entry = await findById(id);
  } catch {
    // Registry could not be loaded — treat as not found
    showNotFound();
    return;
  }

  // id not in registry → show error
  if (!entry) {
    showNotFound();
    return;
  }

  // Populate the viewer bar
  const titleEl    = document.getElementById('viewer-title');
  const categoryEl = document.getElementById('viewer-category');
  const newtabBtn  = document.getElementById('btn-newtab');

  if (titleEl)    titleEl.textContent = entry.title;
  if (categoryEl) categoryEl.textContent = entry.category || '';

  // Update browser tab title
  document.title = `${entry.title} — 10 Federal`;

  // "Open in new tab" button always available in the bar
  const rawSrc = entry.blobUrl || `./dashboards/${entry.filename}`;
  if (newtabBtn) {
    newtabBtn.href = rawSrc;
    newtabBtn.hidden = false;
  }

  // If the dashboard is flagged to open in a new tab → do it and go back
  if (entry.openInNewTab) {
    window.open(rawSrc, '_blank', 'noopener');
    // Return to hub after opening
    window.location.href = 'index.html';
    return;
  }

  // Mount iframe
  hideSpinner();
  show('dashboard-iframe');
  mountIframe(entry);
}

function showNotFound() {
  hide('spinner');
  hide('dashboard-iframe');
  show('viewer-error');
}

init();
