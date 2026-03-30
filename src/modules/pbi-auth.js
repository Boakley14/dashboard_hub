/**
 * pbi-auth.js
 * Entra ID / MSAL.js authentication module for Power BI data access.
 *
 * Handles the full user authentication lifecycle for Power BI:
 *   - Lazy-loads MSAL.js from CDN (only when first needed)
 *   - Fetches tenant/client config from /api/config (no hardcoded IDs)
 *   - Acquires Power BI access tokens on behalf of the signed-in user
 *   - Silent token refresh; popup fallback if interaction required
 *   - RLS is enforced by Power BI itself — users see only their data
 *
 * Usage:
 *   import { getPbiToken, getSignedInUser, signIn, signOut } from './pbi-auth.js';
 *
 *   const token = await getPbiToken();  // acquires / refreshes automatically
 *   const user  = await getSignedInUser();  // { username, name } or null
 *
 * The getPbiToken() result is passed as a Bearer token to /api/pbi-data.
 * The API function extracts it and uses it directly against the Power BI
 * REST API — no service principal secret is needed for user-initiated queries.
 */

const MSAL_CDN  = 'https://alcdn.msauth.net/browser/2.39.0/js/msal-browser.min.js';
const PBI_SCOPE = 'https://analysis.windows.net/powerbi/api/.default';

let _msalInstance = null;
let _config       = null;

// ── Config ─────────────────────────────────────────────────────────────────

async function _loadConfig() {
  if (_config) return _config;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Config endpoint returned ' + res.status);
    _config = await res.json();
  } catch (err) {
    throw new Error('Could not load auth config from /api/config: ' + err.message);
  }
  return _config;
}

// ── MSAL initialisation ────────────────────────────────────────────────────

async function _ensureMsal() {
  if (_msalInstance) return _msalInstance;

  const cfg = await _loadConfig();

  // Lazy-load MSAL.js from CDN if not already on the page
  if (!window.msal) {
    await new Promise((resolve, reject) => {
      const s    = document.createElement('script');
      s.src      = MSAL_CDN;
      s.onload   = resolve;
      s.onerror  = () => reject(new Error('Failed to load MSAL.js from CDN'));
      document.head.appendChild(s);
    });
  }

  _msalInstance = new window.msal.PublicClientApplication({
    auth: {
      clientId:    cfg.clientId,
      authority:   `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: {
      cacheLocation:        'sessionStorage',
      storeAuthStateInCookie: false,
    },
  });

  await _msalInstance.initialize();

  // Consume any redirect response (only fires after a loginRedirect)
  await _msalInstance.handleRedirectPromise().catch(() => {});

  return _msalInstance;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Acquire a Power BI access token for the signed-in user.
 * Uses silent token refresh from cache; falls back to a login popup
 * if no account is found or the token has expired.
 *
 * @returns {Promise<string>} Bearer token string
 */
export async function getPbiToken() {
  const msal    = await _ensureMsal();
  const account = msal.getAllAccounts()[0];

  const request = { scopes: [PBI_SCOPE], account };

  try {
    const result = await msal.acquireTokenSilent(request);
    return result.accessToken;
  } catch {
    // Silent failed — need user interaction (first login or expired session)
    const result = await msal.acquireTokenPopup({ scopes: [PBI_SCOPE] });
    return result.accessToken;
  }
}

/**
 * Return the currently signed-in user, or null if not authenticated.
 * Does NOT trigger a login — call signIn() explicitly for that.
 *
 * @returns {Promise<{ username: string, name: string } | null>}
 */
export async function getSignedInUser() {
  try {
    const msal     = await _ensureMsal();
    const accounts = msal.getAllAccounts();
    if (!accounts.length) return null;
    const a = accounts[0];
    return { username: a.username, name: a.name ?? a.username };
  } catch {
    return null;
  }
}

/**
 * Prompt the user to sign in with their Microsoft / Entra ID account.
 * Opens a popup window; resolves when sign-in is complete.
 *
 * @returns {Promise<{ username: string, name: string }>}
 */
export async function signIn() {
  const msal   = await _ensureMsal();
  const result = await msal.loginPopup({ scopes: [PBI_SCOPE] });
  return { username: result.account.username, name: result.account.name ?? result.account.username };
}

/**
 * Sign the current user out and clear all cached tokens.
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  const msal    = await _ensureMsal();
  const account = msal.getAllAccounts()[0];
  if (account) {
    await msal.logoutPopup({ account });
  }
  _msalInstance = null;  // force re-init on next use
}

/**
 * Check whether a user is currently signed in without triggering any network
 * requests or UI. Useful for conditionally rendering sign-in buttons.
 *
 * @returns {Promise<boolean>}
 */
export async function isSignedIn() {
  try {
    const msal = await _ensureMsal();
    return msal.getAllAccounts().length > 0;
  } catch {
    return false;
  }
}
