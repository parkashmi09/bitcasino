import { useLayoutEffect } from 'react';

/** Reset scroll when a new page is drawn; the browser otherwise keeps the old offset. */
export function ScrollToTop({ pathname }) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
