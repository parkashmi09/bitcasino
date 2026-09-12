import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';

/**
 * The last line of defence: a render that threw.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS NOT WHERE FAILED REQUESTS GO.
 *
 * A read that fails is a STATE — `QueryState.jsx` draws it, with a retry and
 * the request id, next to the rest of a page that still works. Routing a 500
 * through here instead would replace a working header, sidebar and footer
 * with a full-page apology, which is strictly worse for the player and hides
 * which part actually broke.
 *
 * What lands here is the other kind: a component that threw while rendering.
 * A field that was an object where the code expected a string, an adapter
 * given a shape it does not handle, a `.map` on something that turned out to
 * be null. Without a boundary React unmounts the WHOLE tree on one of those —
 * the page goes white, with the reason only in the console — and on a site
 * where the header carries the balance and the deposit button, a blank page
 * is indistinguishable from an outage.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ## Why it is a class
 *
 * `componentDidCatch` and `getDerivedStateFromError` have no hook equivalent.
 * React 19 has not changed that; the function-component error boundary does
 * not exist. This is the one class component in the app and the reason is that
 * there is no other way to write it.
 *
 * ## Why it resets on navigation
 *
 * A boundary that has caught stays caught until its state is cleared, so
 * without this a single broken page poisons every route the player visits
 * afterwards — they press `Home`, the URL changes, and the same apology stays
 * on screen. `RouteErrorBoundary` below feeds the current pathname in as a
 * `key`, which is React's own idiom for "this is a different instance now":
 * the boundary remounts, its caught state is gone, and the new route renders.
 * Resetting in an effect instead would need the boundary to know about the
 * router, which is what the key avoids.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    /**
     * `console.error`, deliberately, and nothing else.
     *
     * There is no error-reporting service wired to this deployment, and a
     * boundary that swallowed the stack silently would make the one class of
     * bug that reaches it the hardest to diagnose. When a reporter is added
     * this is the single call site that changes.
     */
    console.error('Render failed', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <RenderFailed error={this.state.error} onReset={() => this.setState({ error: null })} />;
  }
}

/**
 * What a caught render looks like.
 *
 * `requestId` is surfaced when there is one — an `ApiError` thrown during
 * render rather than caught by a query carries the same id the backend logged,
 * and it is the one string worth quoting. `QueryError` renders it the same
 * way and for the same reason.
 *
 * Two ways out, because they fail differently: `Try again` re-renders the same
 * route, which is enough when the cause was transient state, and the home link
 * is a full navigation for when it is not.
 */
function RenderFailed({ error, onReset }) {
  const requestId = error?.requestId ?? null;

  return (
    <div role="alert" className="grid min-h-[50vh] place-items-center px-6 py-16 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-gohan text-trunks">
          <Icon name="warning" size={24} />
        </span>

        <h1 className="font-secondary text-xl font-medium text-bulma">
          Something went wrong on this page
        </h1>
        <p className="text-sm text-trunks">
          The rest of the site is still working. Try this page again, or go back to the
          lobby.
        </p>

        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-i-sm bg-beerus px-3 py-1.5 text-sm font-medium text-bulma transition-colors hover:bg-trunks/20"
          >
            Try again
          </button>
          <Link
            to="/"
            className="rounded-i-sm bg-piccolo px-3 py-1.5 text-sm font-medium text-goten transition-opacity hover:opacity-90"
          >
            Go to the lobby
          </Link>
        </div>

        {requestId ? (
          <p className="select-all font-mono text-[10px] leading-4 text-trunks/70">
            {requestId}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The boundary, re-keyed on the route.
 *
 * Wrap the routed content in this rather than in `ErrorBoundary` directly —
 * see the note above on why a boundary that never resets turns one broken page
 * into a broken site.
 */
export function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}
