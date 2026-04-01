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

  // Use pre-resolved src from viewer.js (static SWA path preferred over blobUrl)
  const src = entry._resolvedSrc || entry.blobUrl || `./dashboards/${entry.filename}`;

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
 *
 * All dashboards are served from Azure Blob Storage, which is cross-origin
 * relative to this SWA. The browser blocks contentDocument access across
 * origins, making it impossible to inspect whether the iframe loaded real
 * content or a 403 error page. We trust that onload = a response was
 * received and show the iframe as-is. Genuine network failures (DNS failure,
 * connection refused) fire onerror instead and still show the fallback UI.
 *
 * If dashboards appear blank: ensure the blob container has public read
 * access (Azure Portal → Storage account → Containers → dashboards →
 * Change access level → "Blob").
 */
function _handleLoad(/* iframe, entry, src */) {
  // Nothing to do — iframe is already visible, content renders on its own.
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
