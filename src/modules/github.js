/**
 * github.js
 * Responsibility: GitHub Contents API wrapper.
 * Handles uploading files and patching dashboards.json via the GitHub API.
 * PAT is stored in localStorage — never sent anywhere except api.github.com.
 */

const STORAGE_KEY = '10fed_hub_github';
const API_BASE    = 'https://api.github.com';

// ---- Config (stored in localStorage) ----------------------

const DEFAULT_CONFIG = {
  owner:  'Boakley14',
  repo:   'dashboard_hub',
  branch: 'main',
  pat:    ''
};

/**
 * Load saved GitHub config from localStorage.
 * @returns {{ owner, repo, branch, pat }}
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save GitHub config to localStorage.
 * @param {{ owner?, repo?, branch?, pat? }} config
 */
export function saveConfig(config) {
  const current = loadConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }));
}

/**
 * Returns true if a PAT is stored and looks valid (40-char classic or fine-grained).
 */
export function isConnected() {
  const { pat } = loadConfig();
  return typeof pat === 'string' && pat.length >= 40;
}

// ---- GitHub API helpers ------------------------------------

function headers(pat) {
  return {
    'Authorization': `Bearer ${pat}`,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':  'application/json'
  };
}

/**
 * GET a file from the repo. Returns { content (decoded string), sha } or null.
 * @param {string} path  - repo-relative path, e.g. "dashboards/dashboards.json"
 */
export async function getFile(path) {
  const { owner, repo, branch, pat } = loadConfig();
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, { headers: headers(pat) });

  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }

  const data = await res.json();
  // GitHub returns base64-encoded content with possible newlines
  const decoded = atob(data.content.replace(/\n/g, ''));
  return { content: decoded, sha: data.sha };
}

/**
 * Create or update a file in the repo.
 * @param {string} path     - repo-relative path
 * @param {string} content  - raw file content (will be base64-encoded)
 * @param {string} message  - commit message
 * @param {string} [sha]    - required when updating an existing file
 */
export async function putFile(path, content, message, sha) {
  const { owner, repo, branch, pat } = loadConfig();
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;

  // Encode content to base64 (handles Unicode via TextEncoder)
  const encoded = btoa(
    new Uint8Array(new TextEncoder().encode(content))
      .reduce((s, b) => s + String.fromCharCode(b), '')
  );

  const body = { message, content: encoded, branch };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method:  'PUT',
    headers: headers(pat),
    body:    JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }

  return res.json();
}

/**
 * Verify the stored PAT by calling the /user endpoint.
 * @returns {{ login: string }} GitHub user info
 */
export async function verifyPat(pat) {
  const res = await fetch(`${API_BASE}/user`, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  if (!res.ok) throw new Error('Invalid token or insufficient permissions.');
  return res.json();
}

// ---- High-level publishing helpers -------------------------

/**
 * Upload a .html dashboard file to dashboards/{filename}.
 * @param {string} filename - e.g. "my-dashboard.html"
 * @param {string} content  - raw HTML string
 */
export async function uploadDashboard(filename, content) {
  const path = `dashboards/${filename}`;

  // Check if file already exists (get its SHA for update)
  const existing = await getFile(path);
  const sha = existing ? existing.sha : undefined;

  await putFile(
    path,
    content,
    `Add dashboard: ${filename}`,
    sha
  );
}

/**
 * Append a new entry to dashboards/dashboards.json.
 * Reads the current file, parses it, appends, and writes back.
 * @param {Object} entry - Dashboard registry entry object
 */
export async function appendRegistryEntry(entry) {
  const path     = 'dashboards/dashboards.json';
  const existing = await getFile(path);

  let registry = [];
  let sha;

  if (existing) {
    registry = JSON.parse(existing.content);
    sha      = existing.sha;
  }

  // Remove any existing entry with the same id (idempotent re-publish)
  registry = registry.filter(d => d.id !== entry.id);
  registry.push(entry);

  await putFile(
    path,
    JSON.stringify(registry, null, 2) + '\n',
    `Register dashboard: ${entry.title}`,
    sha
  );
}
