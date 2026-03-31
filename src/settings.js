/**
 * settings.js — Settings page orchestrator (settings.html)
 * Wires: tab navigation, appearance controls, publish form, manage list
 */

import { applyTheme, applyNavColor, applyNavTextColor, toggleTheme, getTheme,
         setNavColor, getNavColor, setNavTextColor, getNavTextColor } from './modules/theme.js';
import { slugify, todayIso, readFileAsText,
         validateForm, buildEntry }           from './modules/admin-form.js';
import { loadRegistry }                       from './modules/registry.js';

// Apply appearance immediately
applyTheme();
applyNavColor();
applyNavTextColor();

// ---- DOM refs ----------------------------------------------
const $ = id => document.getElementById(id);

// ---- Tab navigation ----------------------------------------
const LS_TAB = 'hub-settings-tab';

function initTabs() {
  const tabs   = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.tab-panel');

  function activateTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => { p.hidden = p.id !== `tab-${name}`; });
    localStorage.setItem(LS_TAB, name);
  }

  tabs.forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));

  // Restore last active tab
  const saved = localStorage.getItem(LS_TAB) ?? 'manage';
  activateTab(saved);
}

// ---- Appearance: theme toggle ------------------------------
function initThemeToggle() {
  const toggle = $('theme-toggle');
  if (!toggle) return;
  toggle.checked = getTheme() === 'light';
  toggle.addEventListener('change', () => {
    toggleTheme();
  });
}

// ---- Appearance: nav bar color picker ----------------------
const DEFAULT_NAV_COLORS = ['#0a0a0a','#000000','#c52127','#980000','#1c1c1c','#2e2e2e','#0f172a','#14322a'];
const LS_NAV_COLORS_SAVED = 'hub-nav-colors-saved';

function getSavedNavColors() {
  try { return JSON.parse(localStorage.getItem(LS_NAV_COLORS_SAVED)) ?? DEFAULT_NAV_COLORS; }
  catch { return [...DEFAULT_NAV_COLORS]; }
}
function setSavedNavColors(colors) {
  localStorage.setItem(LS_NAV_COLORS_SAVED, JSON.stringify(colors));
}

function initNavColorPicker() {
  const picker    = $('nav-color-picker');
  const saveBtn   = $('btn-save-nav-color');
  const container = $('saved-nav-colors');
  if (!picker || !saveBtn || !container) return;

  picker.value = getNavColor().toLowerCase();

  function renderSwatches() {
    const colors = getSavedNavColors();
    const cur    = getNavColor().toLowerCase();
    container.innerHTML = colors.map((hex, i) => `
      <button type="button" class="saved-color-btn${hex === cur ? ' active' : ''}"
        data-hex="${hex}" data-index="${i}"
        style="background:${hex}" title="${hex}" aria-label="Color ${hex}"
      ><span class="saved-color-remove" data-index="${i}" aria-hidden="true">×</span></button>
    `).join('');

    container.querySelectorAll('.saved-color-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const removeEl = e.target.closest('.saved-color-remove');
        if (removeEl) {
          e.stopPropagation();
          const colors = getSavedNavColors();
          colors.splice(parseInt(removeEl.dataset.index), 1);
          setSavedNavColors(colors);
          renderSwatches();
          return;
        }
        picker.value = btn.dataset.hex;
        setNavColor(btn.dataset.hex);
        renderSwatches();
      });
    });
  }

  picker.addEventListener('input', () => {
    setNavColor(picker.value);
    renderSwatches();
  });

  saveBtn.addEventListener('click', () => {
    const hex    = picker.value.toLowerCase();
    const colors = getSavedNavColors();
    if (!colors.includes(hex)) { colors.push(hex); setSavedNavColors(colors); }
    renderSwatches();
    saveBtn.textContent = 'Saved!';
    setTimeout(() => { saveBtn.textContent = 'Save color'; }, 1500);
  });

  renderSwatches();
}

// ---- Appearance: nav text color picker ---------------------
const DEFAULT_NAV_TEXT_COLORS = ['#ffffff', '#f5f5f5', '#d4d4d4', '#000000', '#2e2e2e'];
const LS_NAV_TEXT_COLORS_SAVED = 'hub-nav-text-colors-saved';

function getSavedNavTextColors() {
  try { return JSON.parse(localStorage.getItem(LS_NAV_TEXT_COLORS_SAVED)) ?? DEFAULT_NAV_TEXT_COLORS; }
  catch { return [...DEFAULT_NAV_TEXT_COLORS]; }
}
function setSavedNavTextColors(colors) {
  localStorage.setItem(LS_NAV_TEXT_COLORS_SAVED, JSON.stringify(colors));
}

function initNavTextColorPicker() {
  const picker    = $('nav-text-picker');
  const saveBtn   = $('btn-save-nav-text-color');
  const container = $('saved-nav-text-colors');
  if (!picker || !saveBtn || !container) return;

  picker.value = getNavTextColor().toLowerCase();

  function renderSwatches() {
    const colors = getSavedNavTextColors();
    const cur    = getNavTextColor().toLowerCase();
    container.innerHTML = colors.map((hex, i) => `
      <button type="button" class="saved-color-btn${hex === cur ? ' active' : ''}"
        data-hex="${hex}" data-index="${i}"
        style="background:${hex}" title="${hex}" aria-label="Color ${hex}"
      ><span class="saved-color-remove" data-index="${i}" aria-hidden="true">×</span></button>
    `).join('');

    container.querySelectorAll('.saved-color-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const removeEl = e.target.closest('.saved-color-remove');
        if (removeEl) {
          e.stopPropagation();
          const colors = getSavedNavTextColors();
          colors.splice(parseInt(removeEl.dataset.index), 1);
          setSavedNavTextColors(colors);
          renderSwatches();
          return;
        }
        picker.value = btn.dataset.hex;
        setNavTextColor(btn.dataset.hex);
        renderSwatches();
      });
    });
  }

  picker.addEventListener('input', () => {
    setNavTextColor(picker.value);
    renderSwatches();
  });

  saveBtn.addEventListener('click', () => {
    const hex    = picker.value.toLowerCase();
    const colors = getSavedNavTextColors();
    if (!colors.includes(hex)) { colors.push(hex); setSavedNavTextColors(colors); }
    renderSwatches();
    saveBtn.textContent = 'Saved!';
    setTimeout(() => { saveBtn.textContent = 'Save color'; }, 1500);
  });

  renderSwatches();
}

// ---- Publish form ------------------------------------------
const publishAlert    = $('publish-alert');
const publishProgress = $('publish-progress');
const btnPublish      = $('btn-publish');
const btnReset        = $('btn-reset');

const inputFile        = $('input-file');
const fileDropZone     = $('file-drop-zone');
const fileDropLabel    = $('file-drop-label');
const fileDropHint     = $('file-drop-hint');
const inputTitle       = $('input-title');
const inputId          = $('input-id');
const inputDescription = $('input-description');
const inputCategory    = $('input-category');
const inputAuthor      = $('input-author');
const inputTags        = $('input-tags');
const inputDate        = $('input-date');
const inputNewtab      = $('input-newtab');
const categoryList     = $('category-suggestions');
const stepUpload       = $('step-upload');

let selectedFile = null;

inputFile.addEventListener('change', () => {
  if (inputFile.files[0]) setSelectedFile(inputFile.files[0]);
});

fileDropZone.addEventListener('dragover', e => { e.preventDefault(); fileDropZone.classList.add('drag-over'); });
fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('drag-over'));
fileDropZone.addEventListener('drop', e => {
  e.preventDefault();
  fileDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) setSelectedFile(e.dataTransfer.files[0]);
});

function setSelectedFile(file) {
  selectedFile = file;
  fileDropZone.classList.add('has-file');
  fileDropLabel.textContent = file.name;
  fileDropHint.textContent  = `${(file.size / 1024).toFixed(1)} KB — ready to upload`;
  if (!inputTitle.value) {
    const titled = file.name.replace(/\.html$/i, '').replace(/[-_]/g, ' ');
    inputTitle.value = titled.charAt(0).toUpperCase() + titled.slice(1);
    inputId.value    = slugify(inputTitle.value);
  }
}

inputTitle.addEventListener('input', () => { inputId.value = slugify(inputTitle.value); });

async function loadCategorySuggestions() {
  try {
    const registry = await loadRegistry();
    const cats = [...new Set(registry.map(d => d.category).filter(Boolean))].sort();
    categoryList.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  } catch { /* non-critical */ }
}

function showProgress() {
  publishProgress.hidden = false;
  stepUpload.classList.remove('active', 'done', 'failed');
  stepUpload.classList.add('active');
}
function stepDone()   { stepUpload.classList.replace('active', 'done');   }
function stepFailed() { stepUpload.classList.replace('active', 'failed'); }

const iconError   = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const iconSuccess = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function showAlert(type, html) {
  publishAlert.className = `alert alert-${type}`;
  publishAlert.innerHTML = (type === 'error' ? iconError : iconSuccess) + `<div>${html}</div>`;
  publishAlert.hidden    = false;
  publishAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideAlert() { publishAlert.hidden = true; }

$('publish-form').addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert();

  const data = {
    file: selectedFile, title: inputTitle.value, id: inputId.value,
    description: inputDescription.value, category: inputCategory.value,
    author: inputAuthor.value, tags: inputTags.value,
    dateAdded: inputDate.value || todayIso(), openInNewTab: inputNewtab.checked
  };

  const errors = validateForm(data);
  if (errors.length) {
    showAlert('error', `<strong>Please fix the following:</strong><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`);
    return;
  }

  btnPublish.disabled = true;
  btnReset.disabled   = true;
  showProgress();

  try {
    const content = await readFileAsText(selectedFile);
    const entry   = buildEntry(data);

    const res = await fetch('/api/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: selectedFile.name, content, entry })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    stepDone();
    publishProgress.hidden = true;
    showAlert('success', `<strong>${entry.title}</strong> published successfully!<br>It will appear on the hub within a few seconds.<br><br><a href="index.html">← Back to Hub</a>`);
    resetForm();

  } catch (err) {
    stepFailed();
    publishProgress.hidden = true;
    showAlert('error', `<strong>Publish failed:</strong> ${err.message}`);
  } finally {
    btnPublish.disabled = false;
    btnReset.disabled   = false;
  }
});

// ---- Connection status helpers -----------------------------
function _connectionStatus(d) {
  if (d.dataConnection?.sourceId)  return { label: 'Connected', cls: 'ds-status-connected',  dot: '🟢' };
  if (d.dataConnection)            return { label: 'Inline',    cls: 'ds-status-inline',     dot: '🟡' };
  if (d.powerBiSources?.length)    return { label: 'Embedded',  cls: 'ds-status-embedded',   dot: '🔵' };
  return                                  { label: 'No data',   cls: 'ds-status-none',        dot: '⚫' };
}

// ---- Manage dashboards -------------------------------------
const manageList  = $('manage-list');
const manageAlert = $('manage-alert');

function showManageAlert(type, html) {
  manageAlert.className = `alert alert-${type}`;
  manageAlert.innerHTML = html;
  manageAlert.hidden = false;
}

async function loadManageList() {
  try {
    const registry = await loadRegistry();
    if (!registry.length) {
      manageList.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">No dashboards published yet.</p>`;
      return;
    }
    manageList.innerHTML = registry.map(d => {
      const status = _connectionStatus(d);
      return `
      <div class="manage-row" id="manage-row-${d.id}">
        <div class="manage-row-info">
          <div class="manage-row-title">${d.title}</div>
          <div class="manage-row-meta">${d.category || ''} &mdash; ${d.filename}</div>
        </div>
        <div class="manage-row-actions">
          <span class="ds-status-badge ${status.cls}" title="Data connection: ${status.label}">${status.dot} ${status.label}</span>
          <button class="btn-danger" data-id="${d.id}" data-filename="${d.filename}" onclick="deleteDashboard(this)">Delete</button>
        </div>
      </div>
    `}).join('');
  } catch {
    manageList.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">Could not load dashboard list.</p>`;
  }
}

window.deleteDashboard = async function (btn) {
  const { id, filename } = btn.dataset;
  if (!confirm(`Delete "${id}"? This cannot be undone.`)) return;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    const res = await fetch('/api/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, filename })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    document.getElementById(`manage-row-${id}`)?.remove();
    if (!manageList.querySelector('.manage-row')) {
      manageList.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">No dashboards published yet.</p>`;
    }
    showManageAlert('success', `<div><strong>${id}</strong> deleted successfully.</div>`);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    showManageAlert('error', `<div><strong>Delete failed:</strong> ${err.message}</div>`);
  }
};

// ---- Reset form --------------------------------------------
function resetForm() {
  $('publish-form').reset();
  selectedFile = null;
  fileDropZone.classList.remove('has-file', 'drag-over');
  fileDropLabel.textContent = 'Click to select or drag & drop';
  fileDropHint.textContent  = 'Accepts .html files';
  publishProgress.hidden    = true;
}

$('btn-reset').addEventListener('click', () => { hideAlert(); resetForm(); });

// ---- Hub name ----------------------------------------------
function initHubName() {
  const input = $('input-hub-name');
  const btn   = $('btn-save-hub-name');
  if (!input || !btn) return;
  input.value = localStorage.getItem('hub-name') ?? '';
  btn.addEventListener('click', () => {
    const name = input.value.trim();
    if (name) {
      localStorage.setItem('hub-name', name);
    } else {
      localStorage.removeItem('hub-name');
    }
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  });
}

// ---- Data Sources tab --------------------------------------
function initDataSources() {
  const dsList     = $('ds-list');
  const dsAlert    = $('ds-alert');
  const addForm    = $('ds-add-form');
  const btnShow    = $('btn-show-add-ds');
  const btnCancel1 = $('btn-cancel-add-ds');
  const btnCancel2 = $('btn-cancel-add-ds-2');
  const btnSave    = $('btn-save-ds');
  const dialog     = $('ds-preview-dialog');
  const previewTitle = $('ds-preview-title');
  const previewBody  = $('ds-preview-body');
  const btnClosePreview = $('btn-close-preview');

  if (!dsList) return;

  let _registry = [];

  function showDsAlert(type, html) {
    dsAlert.className = `alert alert-${type}`;
    dsAlert.innerHTML = html;
    dsAlert.hidden = false;
    setTimeout(() => { dsAlert.hidden = true; }, 4000);
  }

  function openAddForm() {
    addForm.hidden = false;
    btnShow.hidden = true;
    $('ds-f-name')?.focus();
  }
  function closeAddForm() {
    addForm.hidden = true;
    btnShow.hidden = false;
    ['ds-f-name','ds-f-type','ds-f-description','ds-f-workspace','ds-f-dataset'].forEach(id => {
      const el = $(id); if (el) el.value = el.defaultValue || '';
    });
    $('ds-f-type').value = 'pbi-data';
    $('ds-f-endpoint').value = '/api/pbi-data';
  }

  btnShow?.addEventListener('click', openAddForm);
  btnCancel1?.addEventListener('click', closeAddForm);
  btnCancel2?.addEventListener('click', closeAddForm);

  // Preview dialog close
  btnClosePreview?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  // ---- Load and render sources ----------------------------
  async function loadSources() {
    dsList.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">Loading…</p>`;
    try {
      const [sourcesRes, reg] = await Promise.all([
        fetch('/api/data-sources'),
        loadRegistry()
      ]);
      _registry = reg;
      if (!sourcesRes.ok) throw new Error(`HTTP ${sourcesRes.status}`);
      const sources = await sourcesRes.json();

      if (!sources.length) {
        dsList.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">No data sources registered yet. Click <strong>Add Source</strong> to get started.</p>`;
        return;
      }

      dsList.innerHTML = '';
      sources.forEach(src => dsList.appendChild(_buildSourceCard(src, reg)));

    } catch (err) {
      dsList.innerHTML = `<p style="color:var(--color-primary);font-size:var(--font-size-sm)">Failed to load data sources: ${err.message}</p>`;
    }
  }

  function _buildSourceCard(src, registry) {
    const connectedCount = registry.filter(d => d.dataConnection?.sourceId === src.id).length;
    const card = document.createElement('div');
    card.className = 'ds-source-card';
    card.innerHTML = `
      <div class="ds-source-card-header">
        <div class="ds-source-card-info">
          <span class="ds-source-card-name">${src.name}</span>
          <span class="ds-type-pill">${src.type || 'pbi-data'}</span>
        </div>
        <div class="ds-source-card-actions">
          ${src.queries?.length ? `<button type="button" class="btn-ds-preview btn-secondary-sm">Preview</button>` : ''}
          <button type="button" class="btn-ds-delete btn-danger btn-sm" data-id="${src.id}" data-name="${src.name}">Delete</button>
        </div>
      </div>
      ${src.description ? `<p class="ds-source-card-desc">${src.description}</p>` : ''}
      <div class="ds-source-card-meta">
        <span class="ds-source-meta-item">
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" stroke-width="2"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" stroke="currentColor" stroke-width="2"/></svg>
          Dataset: ${src.datasetId ? src.datasetId.slice(0,8)+'…' : 'n/a'}
        </span>
        <span class="ds-source-meta-item">
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/></svg>
          ${connectedCount} dashboard${connectedCount !== 1 ? 's' : ''} connected
        </span>
        ${src.queries?.length ? `<span class="ds-source-meta-item">${src.queries.length} quer${src.queries.length !== 1 ? 'ies' : 'y'}</span>` : ''}
      </div>
    `;

    // Preview button
    card.querySelector('.btn-ds-preview')?.addEventListener('click', () => _previewSource(src));

    // Delete button
    card.querySelector('.btn-ds-delete')?.addEventListener('click', async btn_elem => {
      const btn = card.querySelector('.btn-ds-delete');
      if (!confirm(`Delete data source "${src.name}"? Dashboards using it will lose their sourceId link.`)) return;
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        const res = await fetch('/api/data-sources', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: src.id })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        card.remove();
        showDsAlert('success', `<div><strong>${src.name}</strong> deleted.</div>`);
        if (!dsList.querySelector('.ds-source-card')) {
          dsList.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">No data sources registered yet.</p>`;
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Delete';
        showDsAlert('error', `<div><strong>Delete failed:</strong> ${err.message}</div>`);
      }
    });

    return card;
  }

  async function _previewSource(src) {
    const query = src.queries?.[0];
    if (!query) return;

    previewTitle.textContent = `${src.name} — ${query.queryName || query.id}`;
    previewBody.innerHTML = `<p style="color:var(--color-text-muted)">Loading preview…</p>`;
    dialog?.showModal();

    try {
      const params = new URLSearchParams({
        query:       query.queryName || query.id,
        workspaceId: src.workspaceId,
        datasetId:   src.datasetId,
        ...(query.params || {})
      });
      const res  = await fetch(`${src.endpoint || '/api/pbi-data'}?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const rows    = (data.rows || []).slice(0, 20);
      const columns = data.columns || (rows.length ? Object.keys(rows[0]) : []);

      if (!rows.length) {
        previewBody.innerHTML = `<p style="color:var(--color-text-muted)">No rows returned.</p>`;
        return;
      }

      previewBody.innerHTML = `
        <div class="ds-preview-table-wrap">
          <table class="ds-preview-table">
            <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(row =>
              `<tr>${columns.map(c => `<td>${row[c] ?? ''}</td>`).join('')}</tr>`
            ).join('')}</tbody>
          </table>
        </div>
        <p class="ds-preview-note">Showing up to 20 rows · Query: <code>${query.queryName || query.id}</code></p>
      `;
    } catch (err) {
      previewBody.innerHTML = `<p style="color:var(--color-primary)">⚠ Preview failed: ${err.message}</p>`;
    }
  }

  // ---- Save new source ------------------------------------
  btnSave?.addEventListener('click', async () => {
    const name        = $('ds-f-name')?.value.trim();
    const workspaceId = $('ds-f-workspace')?.value.trim();
    const datasetId   = $('ds-f-dataset')?.value.trim();

    if (!name)        { $('ds-f-name')?.focus();      return; }
    if (!workspaceId) { $('ds-f-workspace')?.focus(); return; }
    if (!datasetId)   { $('ds-f-dataset')?.focus();   return; }

    btnSave.disabled = true;
    btnSave.textContent = 'Saving…';

    try {
      const source = {
        name,
        type:        $('ds-f-type')?.value.trim()        || 'pbi-data',
        description: $('ds-f-description')?.value.trim() || '',
        workspaceId,
        datasetId,
        endpoint:    $('ds-f-endpoint')?.value.trim()    || '/api/pbi-data',
        queries:     [],
      };

      const res = await fetch('/api/data-sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      closeAddForm();
      showDsAlert('success', `<div><strong>${data.source.name}</strong> ${data.created ? 'registered' : 'updated'}.</div>`);
      await loadSources();

    } catch (err) {
      showDsAlert('error', `<div><strong>Save failed:</strong> ${err.message}</div>`);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Save Source';
    }
  });

  loadSources();
}

// ---- Init --------------------------------------------------
initTabs();
initThemeToggle();
initNavColorPicker();
initNavTextColorPicker();
initHubName();
inputDate.value = todayIso();
loadCategorySuggestions();
loadManageList();
initDataSources();
