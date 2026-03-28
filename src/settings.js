/**
 * settings.js — Settings page orchestrator (settings.html)
 * Wires together: admin-form.js → publish form → /api/upload
 */

import { slugify, todayIso, readFileAsText,
         validateForm, buildEntry }  from './modules/admin-form.js';
import { loadRegistry }              from './modules/registry.js';

// ---- DOM refs ----------------------------------------------
const $ = id => document.getElementById(id);

// Publish form
const publishAlert    = $('publish-alert');
const publishProgress = $('publish-progress');
const btnPublish      = $('btn-publish');
const btnReset        = $('btn-reset');

// Form fields
const inputFile       = $('input-file');
const fileDropZone    = $('file-drop-zone');
const fileDropLabel   = $('file-drop-label');
const fileDropHint    = $('file-drop-hint');
const inputTitle      = $('input-title');
const inputId         = $('input-id');
const inputDescription = $('input-description');
const inputCategory   = $('input-category');
const inputAuthor     = $('input-author');
const inputTags       = $('input-tags');
const inputDate       = $('input-date');
const inputNewtab     = $('input-newtab');
const categoryList    = $('category-suggestions');

// Progress step
const stepUpload = $('step-upload');

// ---- State -------------------------------------------------
let selectedFile = null;

// ---- File selection ----------------------------------------
inputFile.addEventListener('change', () => {
  const file = inputFile.files[0];
  if (file) setSelectedFile(file);
});

fileDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  fileDropZone.classList.add('drag-over');
});
fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('drag-over'));
fileDropZone.addEventListener('drop', e => {
  e.preventDefault();
  fileDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

function setSelectedFile(file) {
  selectedFile = file;
  fileDropZone.classList.add('has-file');
  fileDropLabel.textContent = file.name;
  fileDropHint.textContent  = `${(file.size / 1024).toFixed(1)} KB — ready to upload`;

  if (!inputTitle.value) {
    const name   = file.name.replace(/\.html$/i, '').replace(/[-_]/g, ' ');
    const titled = name.charAt(0).toUpperCase() + name.slice(1);
    inputTitle.value = titled;
    inputId.value    = slugify(titled);
  }
}

// ---- Auto-slug title → ID ----------------------------------
inputTitle.addEventListener('input', () => {
  inputId.value = slugify(inputTitle.value);
});

// ---- Category autocomplete ---------------------------------
async function loadCategorySuggestions() {
  try {
    const registry = await loadRegistry();
    const cats = [...new Set(registry.map(d => d.category).filter(Boolean))].sort();
    categoryList.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  } catch { /* non-critical */ }
}

// ---- Progress helpers --------------------------------------
function showProgress() {
  publishProgress.hidden = false;
  stepUpload.classList.remove('active', 'done', 'failed');
  stepUpload.classList.add('active');
}

function stepDone()   { stepUpload.classList.replace('active', 'done');   }
function stepFailed() { stepUpload.classList.replace('active', 'failed'); }

// ---- Alert helpers -----------------------------------------
function showAlert(type, html) {
  const iconError   = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const iconSuccess = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  publishAlert.className = `alert alert-${type}`;
  publishAlert.innerHTML = (type === 'error' ? iconError : iconSuccess) + `<div>${html}</div>`;
  publishAlert.hidden    = false;
  publishAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert() { publishAlert.hidden = true; }

// ---- Publish form submit ------------------------------------
$('publish-form').addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert();

  const data = {
    file:         selectedFile,
    title:        inputTitle.value,
    id:           inputId.value,
    description:  inputDescription.value,
    category:     inputCategory.value,
    author:       inputAuthor.value,
    tags:         inputTags.value,
    dateAdded:    inputDate.value || todayIso(),
    openInNewTab: inputNewtab.checked
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename: selectedFile.name, content, entry })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    stepDone();
    publishProgress.hidden = true;

    showAlert('success', `
      <strong>${entry.title}</strong> published successfully!<br>
      It will appear on the hub within a few seconds.<br><br>
      <a href="index.html">← Back to Hub</a>
    `);

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
    manageList.innerHTML = registry.map(d => `
      <div class="manage-row" id="manage-row-${d.id}" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) 0;border-bottom:1px solid var(--color-border);">
        <div>
          <div style="font-size:var(--font-size-sm);font-weight:var(--font-weight-medium);color:var(--color-text-heading)">${d.title}</div>
          <div style="font-size:var(--font-size-xs);color:var(--color-text-muted)">${d.category} &mdash; ${d.filename}</div>
        </div>
        <button class="btn-danger" data-id="${d.id}" data-filename="${d.filename}" onclick="deleteDashboard(this)">Delete</button>
      </div>
    `).join('');
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, filename })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    // Remove the row from the UI
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

// ---- Init --------------------------------------------------
inputDate.value = todayIso();
loadCategorySuggestions();
loadManageList();
