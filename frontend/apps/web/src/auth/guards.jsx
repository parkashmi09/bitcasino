import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { safeNext } from './safeNext';

/**
 * Route guards.
 *
 * Both wait out `status === 'loading'` rather than deciding on it. After a
 * reload that state lasts one refresh round trip, and redirecting during it
 * would bounce a signed-in player off their own account page and a signed-out
 * one straight past the login form.
 *
 * The hold renders nothing on purpose: the route-progress bar is already on
 * screen for the navigation that got here, so a second spinner would be two
 * loading indicators for one wait.
 */

/**
 * Navigate once, off the location the guard MOUNTED on.
 *
 * `App.jsx` renders `Routes` off a deferred location, so a guard stays on
 * screen for `ROUTE_TRANSITION_MS` after its own redirect and keeps
 * re-rendering against the NEW location. A render-time `<Navigate>` re-fires
 * on each of those renders (its `state` is a fresh object every time) — that
 * was the "Maximum update depth exceeded" loop on every guarded route — and
 * its `from` had already become `/login`, so the deep link was lost too.
 */
function useRedirectOnce(when, target) {
  const navigate = useNavigate();
  const sent = useRef(false);
  useEffect(() => {
    if (!when || sent.current) return;
    sent.current = true;
    navigate(target.to, { replace: true, state: target.state });
  }, [when, target, navigate]);
}

/** Account routes. Sends a signed-out visitor to log in, and back afterwards. */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const [from] = useState(useLocation());
  const next = safeNext(from);

  // `?next=` and `state.from` both: `Login` returns to either, and the query
  // survives a reload of the login page where history state may not.
  useRedirectOnce(status === 'anonymous', {
    to: `/login?next=${encodeURIComponent(next)}`,
    state: { from },
  });

  if (status !== 'authenticated') return null;
  return children;
}

/** `/login` and `/register`: there is nothing to sign into when already in. */
export function RedirectIfAuthenticated({ children }) {
  const { status } = useAuth();
  const [location] = useState(useLocation());

  useRedirectOnce(status === 'authenticated', {
    to: safeNext(location.state?.from ?? new URLSearchParams(location.search).get('next')),
  });

  if (status !== 'anonymous') return null;
  return children;
}
