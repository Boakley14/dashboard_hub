/**
 * theme.js — Appearance preferences: dark/light mode, nav bar color, user greeting.
 * Imported by app.js, viewer.js, and settings.js.
 * Call applyTheme() + applyNavColor() at the very top of each page script.
 */

const LS_THEME     = 'hub-theme';      // 'dark' | 'light'
const LS_NAV_COLOR = 'hub-nav-color';  // hex string

// ---- Theme -----------------------------------------------

export function applyTheme() {
  const theme = localStorage.getItem(LS_THEME) ?? 'dark';
  document.body.classList.toggle('theme-light', theme === 'light');
}

export function toggleTheme() {
  const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  localStorage.setItem(LS_THEME, next);
  document.body.classList.toggle('theme-light', next === 'light');
  return next;
}

export function getTheme() {
  return localStorage.getItem(LS_THEME) ?? 'dark';
}

// ---- Nav bar color ----------------------------------------

export function applyNavColor() {
  const color = localStorage.getItem(LS_NAV_COLOR) ?? '#0A0A0A';
  document.documentElement.style.setProperty('--color-hero-bg', color);
}

export function setNavColor(hex) {
  localStorage.setItem(LS_NAV_COLOR, hex);
  document.documentElement.style.setProperty('--color-hero-bg', hex);
}

export function getNavColor() {
  return localStorage.getItem(LS_NAV_COLOR) ?? '#0A0A0A';
}

// ---- User greeting (Azure AD via /.auth/me) ---------------

export async function getFirstName() {
  try {
    const res  = await fetch('/.auth/me');
    if (!res.ok) return '';
    const data = await res.json();
    const cp   = data.clientPrincipal;
    if (!cp) return '';
    // Prefer the AAD 'name' claim (full display name), fall back to userDetails (email)
    const nameClaim = cp.claims?.find(c => c.typ === 'name');
    const full = nameClaim?.val ?? cp.userDetails ?? '';
    return full.split(' ')[0] || '';   // first word = first name
  } catch {
    return '';
  }
}
