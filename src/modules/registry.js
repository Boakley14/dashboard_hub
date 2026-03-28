/**
 * registry.js
 * Responsibility: Load and cache the dashboards.json registry.
 * Single fetch call — all other modules import from here.
 */

/**
 * Sentinel error class so callers can distinguish a registry load
 * failure from other unexpected errors.
 */
export class RegistryLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryLoadError';
  }
}

let _cache = null;

/**
 * Loads the dashboard registry from /api/registry.
 * Returns cached result on subsequent calls.
 * Throws RegistryLoadError if the fetch fails or returns a non-OK status.
 * @returns {Promise<Array>} Array of dashboard entry objects
 */
export async function loadRegistry() {
  if (_cache) return _cache;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch('/api/registry', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new RegistryLoadError(`HTTP ${res.status}`);
    _cache = await res.json();
    return _cache;
  } catch (err) {
    console.error('[registry] Failed to load registry:', err);
    // Re-throw as RegistryLoadError so app.js can show the right UI
    throw err instanceof RegistryLoadError
      ? err
      : new RegistryLoadError(err.message);
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
