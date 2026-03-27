/**
 * registry.js
 * Responsibility: Load and cache the dashboards.json registry.
 * Single fetch call — all other modules import from here.
 */

let _cache = null;

/**
 * Loads the dashboard registry from dashboards/dashboards.json.
 * Returns cached result on subsequent calls.
 * @returns {Promise<Array>} Array of dashboard entry objects
 */
export async function loadRegistry() {
  if (_cache) return _cache;

  try {
    const res = await fetch('./dashboards/dashboards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cache = await res.json();
    return _cache;
  } catch (err) {
    console.error('[registry] Failed to load dashboards.json:', err);
    // Return empty array so the app degrades gracefully
    return [];
  }
}

/**
 * Find a single dashboard entry by its id slug.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function findById(id) {
  const registry = await loadRegistry();
  return registry.find(d => d.id === id) ?? null;
}

/**
 * Returns all unique category strings from the registry.
 * @returns {Promise<string[]>}
 */
export async function getCategories() {
  const registry = await loadRegistry();
  const cats = registry.map(d => d.category).filter(Boolean);
  return [...new Set(cats)].sort();
}
