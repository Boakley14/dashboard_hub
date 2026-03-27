/**
 * settings.js — Settings page orchestrator (settings.html)
 * Wires together: github.js + admin-form.js → connection UI + publish form
 */

import { loadConfig, saveConfig, isConnected, verifyPat,
         uploadDashboard, appendRegistryEntry }  from './modules/github.js';
import { slugify, todayIso, readFileAsText,
         validateForm, buildEntry }              from './modules/admin-form.js';
import { loadRegistry }                         from './modules/registry.js';

// ---- DOM refs ----------------------------------------------
const $ = id => document.getElementById(id);

// Connection
const inputPat          = $('input-pat');
const btnConnect        = $('btn-connect');
const btnDisconnect     = $('btn-disconnect');
const connectionStatus  = $('connection-status');
const connectionText    = $('connection-status-text');
const patForm           = $('pat-form');

// Nav status
const statusDot         = $('status-dot');
const statusLabel       = $('status-label');

// Publish form
const publishForm       = $('publish-form');
const publishLocked     = $('publish-locked');
const publishAlert      = $('publish-alert');
const publishProgress   = $('publish-progress');
const btnPublish        = $('btn-publish');
const btnReset          = $('btn-reset');

// Form fields
const inputFile         = $('input-file');
const fileDropZone      = $('file-drop-zone');
const fileDropLabel     = $('file-drop-label');
const fileDropHint      = $('file-drop-hint');
const fileDropIcon      = $('file-drop-icon');
const inputTitle        = $('input-title');
const inputId           = $('input-id');
const inputDescription  = $('input-description');
const inputCategory     = $('input-category');
const inputAuthor       = $('input-author');
const inputTags         = $('input-tags');
const inputDate         = $('input-date');
const inputNewtab       = $('input-newtab');
const categoryList      = $('category-suggestions');

// Progress steps
const stepUpload   = $('step-upload');
const stepRegistry = $('step-registry');

// ---- State -------------------------------------------------
let selectedFile = null;

// ---- Nav connection status ---------------------------------
function updateNavStatus(connected, username = '') {
  statusDot.className   = 'status-dot ' + (connected ? 'connected' : 'disconnected');
  statusLabel.textContent = connected ? `Connected as ${username}` : 'Not connected';
}

// ---- Connection section ------------------------------------
function showConnected(username) {
  connectionStatus.className = 'connection-status connected';
  connectionStatus.innerHTML = `
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span>Connected as <strong>${username}</strong> — ready to publish dashboards.</span>`;

  patForm.hidden       = true;
  btnDisconnect.hidden = false;
  updateNavStatus(true, username);

  // Unlock publish form
  publishLocked.hidden = true;
  btnPublish.disabled  = false;
}

function showDisconnected(message = 'Not connected — enter your GitHub token below to publish dashboards.') {
  connectionStatus.className    = 'connection-status disconnected';
  connectionStatus.innerHTML    = `
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span>${message}</span>`;

  patForm.hidden       = false;
  btnDisconnect.hidden = true;
  updateNavStatus(false);

  // Lock publish form
  publishLocked.hidden = false;
  btnPublish.disabled  = true;
}

// ---- Connect button ----------------------------------------
btnConnect.addEventListener('click', async () => {
  const pat = inputPat.value.trim();
  if (!pat) { inputPat.focus(); return; }

  btnConnect.disabled    = true;
  btnConnect.textContent = 'Verifying…';

  try {
    const user = await verifyPat(pat);
    saveConfig({ pat });
    showConnected(user.login);
    inputPat.value = '';
  } catch (err) {
    showDisconnected(`Connection failed: ${err.message}`);
  } finally {
    btnConnect.disabled    = false;
    btnConnect.innerHTML   = `
      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Verify &amp; Connect`;
  }
});

// ---- Disconnect button -------------------------------------
btnDisconnect.addEventListener('click', () => {
  saveConfig({ pat: '' });
  showDisconnected();
});

// Enter key in PAT field
inputPat.addEventListener('keydown', e => { if (e.key === 'Enter') btnConnect.click(); });

// ---- File upload -------------------------------------------
inputFile.addEventListener('change', () => {
  const file = inputFile.files[0];
  if (!file) return;
  setSelectedFile(file);
});

// Drag & drop
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

  // Auto-fill title from filename if title is still empty
  if (!inputTitle.value) {
    const name = file.name.replace(/\.html$/i, '').replace(/[-_]/g, ' ');
    const titled = name.charAt(0).toUpperCase() + name.slice(1);
    inputTitle.value = titled;
    inputId.value    = slugify(titled);
  }
}

// ---- Auto-slug title → ID ----------------------------------
inputTitle.addEventListener('input', () => {
  inputId.value = slugify(inputTitle.value);
});

// ---- Populate category datalist from registry --------------
async function loadCategorySuggestions() {
  try {
    const registry = await loadRegistry();
    const cats = [...new Set(registry.map(d => d.category).filter(Boolean))].sort();
    categoryList.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  } catch { /* non-critical */ }
}

// ---- Progress helpers --------------------------------------
function setStep(el, state) {
  el.classList.remove('active', 'done', 'failed');
  el.classList.add(state);
}

function showProgress() {
  publishProgress.hidden = false;
  setStep(stepUpload,   'active');
  setStep(stepRegistry, '');
}

function stepDone(el)   { setStep(el, 'done');   }
function stepFailed(el) { setStep(el, 'failed');  }
function stepNext(el)   { setStep(el, 'active');  }

// ---- Alert helpers -----------------------------------------
function showAlert(type, html) {
  const iconError = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
    <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const iconSuccess = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  publishAlert.className = `alert alert-${type}`;
  publishAlert.innerHTML = (type === 'error' ? iconError : iconSuccess) + `<div>${html}</div>`;
  publishAlert.hidden    = false;
  publishAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert() { publishAlert.hidden = true; }

// ---- Publish form submit ------------------------------------
publishForm.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert();

  const data = {
    file:        selectedFile,
    title:       inputTitle.value,
    id:          inputId.value,
    description: inputDescription.value,
    category:    inputCategory.value,
    author:      inputAuthor.value,
    tags:        inputTags.value,
    dateAdded:   inputDate.value || todayIso(),
    openInNewTab: inputNewtab.checked
  };

  // Validate
  const errors = validateForm(data);
  if (errors.length) {
    showAlert('error', `<strong>Please fix the following:</strong><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`);
    return;
  }

  // Lock UI
  btnPublish.disabled = true;
  btnReset.disabled   = true;
  showProgress();

  try {
    // Step 1: Upload .html file
    const content = await readFileAsText(selectedFile);
    await uploadDashboard(selectedFile.name, content);
    stepDone(stepUpload);

    // Step 2: Update registry
    stepNext(stepRegistry);
    const entry = buildEntry(data);
    await appendRegistryEntry(entry);
    stepDone(stepRegistry);

    // Success!
    publishProgress.hidden = true;
    showAlert('success', `
      <strong>${entry.title}</strong> published successfully! 🎉<br>
      It will appear on the hub in about 60 seconds after GitHub Pages rebuilds.<br><br>
      <a href="index.html">← Back to Hub</a> &nbsp;|&nbsp;
      <a href="viewer.html?id=${entry.id}">Preview Dashboard ↗</a>
    `);

    resetForm();

  } catch (err) {
    // Mark whichever step failed
    if (!stepUpload.classList.contains('done'))   stepFailed(stepUpload);
    else                                           stepFailed(stepRegistry);

    publishProgress.hidden = true;
    showAlert('error', `<strong>Publish failed:</strong> ${err.message}<br>
      Check your GitHub token permissions and try again.`);

  } finally {
    btnPublish.disabled = false;
    btnReset.disabled   = false;
  }
});

// ---- Reset form --------------------------------------------
function resetForm() {
  publishForm.reset();
  selectedFile = null;
  fileDropZone.classList.remove('has-file', 'drag-over');
  fileDropLabel.textContent = 'Click to select or drag & drop';
  fileDropHint.textContent  = 'Accepts .html files';
  publishProgress.hidden    = true;
}

btnReset.addEventListener('click', () => { hideAlert(); resetForm(); });

// ---- Init --------------------------------------------------
async function init() {
  // Set today's date as default
  inputDate.value = todayIso();

  // Restore connection state
  if (isConnected()) {
    const { pat } = loadConfig();
    try {
      const user = await verifyPat(pat);
      showConnected(user.login);
    } catch {
      showDisconnected('Session expired — please reconnect.');
    }
  } else {
    showDisconnected();
  }

  // Load category autocomplete suggestions
  loadCategorySuggestions();
}

init();
