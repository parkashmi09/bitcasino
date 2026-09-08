import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

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

/** Account routes. Sends a signed-out visitor to log in, and back afterwards. */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return null;
  if (status === 'anonymous') {
    // `state.from` is what `Login` returns to, so a deep link survives the
    // detour instead of dumping the player on the home page.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/** `/login` and `/register`: there is nothing to sign into when already in. */
export function RedirectIfAuthenticated({ children }) {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}
