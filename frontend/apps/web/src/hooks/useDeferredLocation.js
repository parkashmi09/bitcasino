import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ROUTE_TRANSITION_MS } from '@/components/layout/RouteProgress';

/**
 * The route the tree should actually be drawing.
 *
 * Every navigation in this app commits to the router the same frame it is
 * clicked — it is a single bundle, there is nothing to wait on. But the
 * reference's loading bar is there to say "somewhere else is coming", so the
 * page it is expected to preface has to arrive only when that bar is done:
 *
 *   click -> the current page stays put -> the bar runs to completion ->
 *            the destination commits and paints
 *
 * This hook hands `App` a location that LAGS the real one by exactly the bar's
 * run (`ROUTE_TRANSITION_MS`), and `App` renders `<Routes location={…}>` with
 * it. React Router feeds that value to everything under the routes — `Outlet`,
 * `NavLink`, `useLocation`, `useParams` — so the sidebar's highlights and the
 * guards all agree about the page that is actually visible, and only flip when
 * it does. Components outside `Routes` (`RouteProgress`) still read the real
 * location and react at the click.
 *
 * A second navigation mid-run restarts the wait: the pending swap is torn
 * down and the bar restarts too, so the destination is always the latest
 * target and never an earlier click that was superseded.
 *
 * The first paint of a session is a hard load — there is no bar, so there is
 * nothing to wait for; the location is seeded as it already is and never
 * deferred.
 */
export function useDeferredLocation() {
  const realLocation = useLocation();
  const [display, setDisplay] = useState(realLocation);
  const committedKey = useRef(`${realLocation.pathname}${realLocation.search}`);

  useEffect(() => {
    const key = `${realLocation.pathname}${realLocation.search}`;
    if (committedKey.current === key) return undefined;

    const id = window.setTimeout(() => {
      setDisplay(realLocation);
      committedKey.current = key;
    }, ROUTE_TRANSITION_MS);

    return () => window.clearTimeout(id);
  }, [realLocation]);

  return display;
}