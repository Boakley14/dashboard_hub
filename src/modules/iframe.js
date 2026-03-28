/**
 * iframe.js
 * Responsibility: Mount a dashboard into an iframe, handle load errors,
 * and provide a graceful fallback when embedding isn't possible.
 */

import { showFallback, hideFallback, show, hide } from './ui.js';

/**
 * Mount a dashboard entry into the viewer iframe.
 * If entry.openInNewTab is true, opens the file directly (caller should handle this
 * before calling mountIframe).
 *
 * @param {Object} entry - Dashboard registry entry
 */
export function mountIframe(entry) {
  const iframe = document.getElementById('dashboard-iframe');
  if (!iframe) return;

  const src = entry.blobUrl || `./dashboards/${entry.filename}`;

  // Reset state
  hideFallback();
  hide('iframe-error');
  show(iframe);

  iframe.setAttribute('sandbox', [
    'allow-scripts',
    'allow-same-origin',
    'allow-forms',
    'allow-popups',
    'allow-downloads',
    'allow-modals'
  ].join(' '));

  iframe.setAttribute('title', entry.title);
  iframe.setAttribute('loading', 'eager');

  // Set load / error handlers before setting src
  iframe.onload = () => _handleLoad(iframe, entry, src);
  iframe.onerror = () => _handleError(iframe, entry, src);

  iframe.src = src;
}

/**
 * Called when the iframe fires its load event.
 * Verifies the content is actually accessible (catches silent embed failures).
 */
function _handleLoad(iframe, entry, src) {
  try {
    const doc = iframe.contentDocument;
    if (!doc || (!doc.body && !doc.head)) {
      // Loaded but empty — treat as failure
      _handleError(iframe, entry, src);
    }
    // Otherwise: same-origin content loaded fine — nothing more to do
  } catch (e) {
    if (e.name === 'SecurityError') {
      // SecurityError means the iframe is cross-origin (e.g. Azure Blob Storage).
      // This is EXPECTED and means the content loaded successfully — the browser
      // simply prevents us from reading its DOM. Do NOT treat as an error.
      return;
    }
    // Any other error type is a genuine load failure
    _handleError(iframe, entry, src);
  }
}

/**
 * Called when the iframe fails to load, or when content is inaccessible.
 * Hides the iframe and shows the fallback UI with a direct link.
 */
function _handleError(iframe, entry, src) {
  hide(iframe);
  showFallback(
    `<strong>${entry.title}</strong> couldn't be displayed in the embedded viewer.<br>
     This sometimes happens when the dashboard uses features that require a direct browser window.`,
    src
  );
}
