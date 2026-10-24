/** @typedef {'light' | 'dark'} Theme */

const STORAGE_KEY = 'bc.theme';

/** The reference site ships a light theme by default; dark is opt-in. */
export const DEFAULT_THEME = 'light';

/** @returns {Theme} */
export function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private mode or blocked storage — fall through to the default.
  }
  return DEFAULT_THEME;
}

/** @param {Theme} theme */
export function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add(`theme-${theme}`);
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistence is a convenience, not a requirement.
  }
}
