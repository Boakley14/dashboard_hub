/**
 * favorites.js
 * Client-side module for per-user dashboard favorites.
 *
 * Favorites are persisted in blob storage via /api/user-favorites.
 * A local in-memory + sessionStorage cache avoids redundant API calls.
 *
 * Exports:
 *   loadFavorites()          → Promise<Set<string>> — fetch from server
 *   toggleFavorite(id)       → Promise<Set<string>> — add/remove, returns updated set
 *   getCached()              → Set<string>           — synchronous cached read
 *   isFavorite(id)           → boolean
 *   onFavoritesChange(fn)    → void                  — subscribe to change events
 */

const CACHE_KEY = 'hub-favorites';
const ENDPOINT  = '/api/user-favorites';

// In-memory cache (authoritative after first load)
let _cache    = null;   // Set<string> | null
let _loaded   = false;
let _listeners = [];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load favorites from the server.
 * Subsequent calls return the in-memory cache (no extra network round-trip).
 * @returns {Promise<Set<string>>}
 */
export async function loadFavorites() {
  if (_cache !== null) return _cache;

  // Try sessionStorage first (survives soft navigations within the tab)
  const stored = sessionStorage.getItem(CACHE_KEY);
  if (stored) {
    try {
      _cache  = new Set(JSON.parse(stored));
      _loaded = true;
      return _cache;
    } catch { /* fall through */ }
  }

  try {
    const res  = await fetch(ENDPOINT, { cache: 'no-store' });
    const data = await res.json();
    _cache  = new Set(data.favorites ?? []);
    _loaded = true;
    _persist();
  } catch {
    // Network error or unauthenticated — return empty set silently
    _cache  = new Set();
    _loaded = true;
  }

  return _cache;
}

/**
 * Add or remove a dashboard from favorites.
 * Optimistically updates the local cache, then syncs to the server.
 * @param {string} dashboardId
 * @returns {Promise<Set<string>>}  Updated favorites set
 */
export async function toggleFavorite(dashboardId) {
  await loadFavorites();   // ensure cache is warm

  const action = _cache.has(dashboardId) ? 'remove' : 'add';

  // Optimistic update
  if (action === 'add')    _cache.add(dashboardId);
  if (action === 'remove') _cache.delete(dashboardId);
  _persist();
  _notify();

  try {
    const res  = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, dashboardId }),
    });
    const data = await res.json();
    if (res.ok && data.favorites) {
      _cache = new Set(data.favorites);
      _persist();
      _notify();
    }
  } catch {
    // Server sync failed — the optimistic local state is already set.
    // It will sync on next full page load.
  }

  return _cache;
}

/**
 * Synchronous read of the current cached favorites set.
 * Returns an empty Set if favorites haven't been loaded yet.
 * @returns {Set<string>}
 */
export function getCached() {
  if (_cache !== null) return _cache;
  // Try sessionStorage before a full load completes
  const stored = sessionStorage.getItem(CACHE_KEY);
  if (stored) {
    try { return new Set(JSON.parse(stored)); } catch { /**/ }
  }
  return new Set();
}

/**
 * Returns true if the given dashboard ID is in the user's favorites.
 * @param {string} dashboardId
 * @returns {boolean}
 */
export function isFavorite(dashboardId) {
  return getCached().has(dashboardId);
}

/**
 * Subscribe to favorites change events (called after every toggle).
 * @param {function} fn  - Called with the updated Set<string>
 * @returns {function}   - Unsubscribe function
 */
export function onFavoritesChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/** Invalidate cache — force a fresh fetch on next loadFavorites() call. */
export function invalidateFavoritesCache() {
  _cache  = null;
  _loaded = false;
  sessionStorage.removeItem(CACHE_KEY);
}

// ── Internal ────────────────────────────────────────────────────────────────

function _persist() {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify([..._cache])); } catch { /* quota */ }
}

function _notify() {
  const snap = new Set(_cache);
  _listeners.forEach(fn => { try { fn(snap); } catch { /**/ } });
}
