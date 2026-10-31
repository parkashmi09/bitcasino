import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Reset scroll on navigation; the browser otherwise keeps the old offset. */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
