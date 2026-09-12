import { useEffect, useState } from 'react';

/**
 * A value that trails the one given, settling `delay` ms after it stops
 * changing.
 *
 * For the search field. Without it every keystroke is a request: typing
 * "blackjack" is nine, of which eight are already stale when they land, and
 * the catalogue routes are rate limited. Debouncing the TERM rather than the
 * request is what lets React Query keep doing its own job — the settled term
 * is part of the query key, so a term typed before is served from cache with
 * no request at all.
 *
 * 250ms is under the ~300ms at which a pause starts to read as lag, and long
 * enough that ordinary typing produces one request per word rather than per
 * letter.
 *
 * @template T
 * @param {T} value
 * @param {number} [delay]
 * @returns {T}
 */
export function useDebounced(value, delay = 250) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delay);
    // Clearing on every change is the debounce: the timer only ever fires for
    // the last value in a burst.
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return settled;
}
