/** @typedef {'light' | 'dark'} Theme */

// v2: `bc.theme` still holds the `dark` an owner-forced dark mode wrote for every visitor.
const STORAGE_KEY = 'bc.theme.v2';

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

/** @param {Theme} theme @param {boolean} [persist] false: show it without replacing the player's stored choice. */
export function applyTheme(theme, persist = true) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add(`theme-${theme}`);
  root.style.colorScheme = theme;
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistence is a convenience, not a requirement.
  }
}
