/**
 * filters.js
 * Responsibility: Pure filter functions — no DOM, no side effects.
 * Takes a registry array + filter state, returns a filtered array.
 */

/**
 * Filter the dashboard registry based on active search/category/tag state.
 *
 * @param {Array}  registry           - Full array of dashboard entry objects
 * @param {Object} filters
 * @param {string} filters.query      - Free-text search string
 * @param {string|null} filters.category - Active category filter, or null for all
 * @param {Set}    filters.tags       - Set of active tag strings (empty = no tag filter)
 * @returns {Array} Filtered array of dashboard entries
 */
export function filterDashboards(registry, { query = '', category = null, tags = new Set() } = {}) {
  const q = query.trim().toLowerCase();

  return registry.filter(entry => {
    // --- Category filter ---
    if (category && entry.category !== category) return false;

    // --- Tag filter (must match ALL active tags) ---
    if (tags.size > 0) {
      const entryTags = (entry.tags || []).map(t => t.toLowerCase());
      for (const tag of tags) {
        if (!entryTags.includes(tag.toLowerCase())) return false;
      }
    }

    // --- Full-text search ---
    if (q) {
      const searchable = [
        entry.title,
        entry.description,
        entry.category,
        entry.author,
        ...(entry.tags || [])
      ].join(' ').toLowerCase();

      if (!searchable.includes(q)) return false;
    }

    return true;
  });
}

/**
 * Extract all unique categories from the registry, sorted alphabetically.
 * @param {Array} registry
 * @returns {string[]}
 */
export function extractCategories(registry) {
  const cats = registry.map(d => d.category).filter(Boolean);
  return [...new Set(cats)].sort();
}

/**
 * Extract all unique tags from the registry, sorted alphabetically.
 * @param {Array} registry
 * @returns {string[]}
 */
export function extractTags(registry) {
  const tags = registry.flatMap(d => d.tags || []).filter(Boolean);
  return [...new Set(tags)].sort();
}
