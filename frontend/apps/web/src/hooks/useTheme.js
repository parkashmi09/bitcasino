import { useCallback, useEffect, useState } from 'react';
import { applyTheme, readStoredTheme } from '@/lib/theme';

export function useTheme() {
  const [theme, setTheme] = useState(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, setTheme, toggle };
}
