/**
 * ui.js
 * Responsibility: Shared DOM helpers — spinners, fallback messages, show/hide.
 * No business logic here; just reusable UI primitives.
 */

/**
 * Show the loading spinner element (id="spinner").
 */
export function showSpinner() {
  const el = document.getElementById('spinner');
  if (el) el.hidden = false;
}

/**
 * Hide the loading spinner element (id="spinner").
 */
export function hideSpinner() {
  const el = document.getElementById('spinner');
  if (el) el.hidden = true;
}

/**
 * Show the empty-state message when no cards match a filter.
 * @param {string} message
 */
export function showEmptyState(message = 'No dashboards found.') {
  const el = document.getElementById('empty-state');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

/**
 * Hide the empty-state message.
 */
export function hideEmptyState() {
  const el = document.getElementById('empty-state');
  if (el) el.hidden = true;
}

/**
 * Show an error state when the registry API is unavailable.
 * Uses innerHTML (safe — no user input interpolated).
 */
export function showRegistryError() {
  const el = document.getElementById('empty-state');
  if (!el) return;
  el.innerHTML = `
    <strong>Could not load dashboards.</strong><br>
    The registry service is unavailable. Check Azure app settings
    (AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_SAS_TOKEN) or visit
    <a href="/api/health">/api/health</a> to diagnose.
  `;
  el.hidden = false;
}

/**
 * Render a fallback UI inside the viewer when an iframe fails to load.
 * @param {string} message   - Human-readable explanation
 * @param {string} rawUrl    - Direct URL to the dashboard file
 */
export function showFallback(message, rawUrl) {
  const container = document.getElementById('iframe-fallback');
  if (!container) return;

  container.innerHTML = `
    <div class="fallback-box">
      <svg width="48" height="48" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="#C52127" stroke-width="2"/>
        <path d="M12 8v4M12 16h.01" stroke="#C52127" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p class="fallback-msg">${message}</p>
      <a class="btn-primary" href="${rawUrl}" target="_blank" rel="noopener">
        Open in New Tab ↗
      </a>
    </div>
  `;
  container.hidden = false;
}

/**
 * Hide the iframe fallback container.
 */
export function hideFallback() {
  const el = document.getElementById('iframe-fallback');
  if (el) el.hidden = true;
}

/**
 * Show an element by removing the hidden attribute.
 * @param {string|HTMLElement} target - id string or element
 */
export function show(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el) el.hidden = false;
}

/**
 * Hide an element by setting the hidden attribute.
 * @param {string|HTMLElement} target - id string or element
 */
export function hide(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el) el.hidden = true;
}
