/**
 * router.js
 * Responsibility: URL query string read/write helpers.
 * Wraps URLSearchParams so the rest of the app never touches it directly.
 */

/**
 * Get a query parameter value from the current URL.
 * @param {string} key
 * @returns {string|null}
 */
export function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * Set a query parameter, pushing to browser history.
 * @param {string} key
 * @param {string|null} value  Pass null to remove the param.
 */
export function setParam(key, value) {
  const params = new URLSearchParams(window.location.search);
  if (value === null || value === '') {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
  window.history.replaceState(null, '', newUrl);
}

/**
 * Build a URL string for the viewer page for a given dashboard id.
 * @param {string} id
 * @returns {string}
 */
export function viewerUrl(id) {
  return `viewer.html?id=${encodeURIComponent(id)}`;
}
