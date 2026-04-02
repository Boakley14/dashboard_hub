/**
 * admin-form.js
 * Responsibility: Settings page form — rendering, validation, slug generation,
 * file reading. No GitHub API calls here; those are in github.js.
 */

// ---- Slug / ID generation ----------------------------------

/**
 * Convert a title string to a URL-safe id slug.
 * e.g. "Q1 2026 Sales Report!" → "q1-2026-sales-report"
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

/**
 * Generate today's date string in YYYY-MM-DD format.
 * @returns {string}
 */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---- File reading ------------------------------------------

/**
 * Read an HTML File object and return its text content.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file, 'UTF-8');
  });
}

// ---- Validation --------------------------------------------

/**
 * Validate the form data object.
 * Returns an array of error message strings (empty = valid).
 * @param {Object} data
 * @returns {string[]}
 */
export function validateForm(data) {
  const errors = [];

  if (!data.file)        errors.push('Please select an .html file to upload.');
  if (!data.title?.trim())       errors.push('Title is required.');
  if (!data.id?.trim())          errors.push('Dashboard ID is required.');
  if (!data.category?.trim())    errors.push('Category is required.');
  if (!data.description?.trim()) errors.push('Description is required.');

  if (data.id && !/^[a-z0-9-]+$/.test(data.id)) {
    errors.push('Dashboard ID may only contain lowercase letters, numbers, and hyphens.');
  }

  if (data.file && !data.file.name.endsWith('.html')) {
    errors.push('Only .html files are supported.');
  }

  return errors;
}

// ---- Build registry entry from form data -------------------

/**
 * Build a dashboards.json entry object from validated form data.
 * @param {Object} data  - Validated form field values
 * @returns {Object}     - Registry entry ready to append
 */
export function buildEntry(data) {
  const tags = (data.tags || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  return {
    id:          data.id.trim(),
    dashboardId: data.id.trim(),
    title:       data.title.trim(),
    description: data.description.trim(),
    category:    data.category.trim(),
    tags,
    author:      (data.author || '').trim(),
    dateAdded:   data.dateAdded || todayIso(),
    createdUtc:  data.createdUtc || null,
    uploadedUtc: data.uploadedUtc || null,
    filename:    data.file.name,
    thumbnail:   '',
    openInNewTab: data.openInNewTab === true
  };
}
