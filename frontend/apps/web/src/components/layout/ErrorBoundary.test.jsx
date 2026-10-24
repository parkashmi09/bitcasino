import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ErrorBoundary, RouteErrorBoundary } from './ErrorBoundary';
import { ApiError } from '@/lib/api';

/**
 * The boundary, and the one property that is easy to omit and impossible to
 * notice: that it RESETS.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A BOUNDARY THAT HAS CAUGHT STAYS CAUGHT
 *
 * React never clears a boundary's error state on its own. Wrap a router's
 * outlet in one and forget that, and a single broken page poisons the rest of
 * the session: the player presses `Home`, the URL changes, the route under
 * the boundary changes — and the apology stays on screen, because the
 * boundary above it is still holding an error from a page they have left.
 *
 * It looks like a site-wide outage and it is one page. `RouteErrorBoundary`
 * re-keys on the pathname so the boundary remounts, which is the whole reason
 * that wrapper exists rather than callers using `ErrorBoundary` directly —
 * and it is exactly the kind of thing that gets "simplified" away by someone
 * who sees two components doing one job.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** A component that throws on demand, controlled from outside the render. */
let shouldThrow = true;

function Boom() {
  if (shouldThrow) throw new Error('render exploded');
  return <p>the page rendered</p>;
}

function ApiBoom() {
  throw new ApiError({ code: 'SERVER_ERROR', status: 500, details: { requestId: 'req-42' } });
}

beforeEach(() => {
  shouldThrow = true;
  /**
   * React logs every caught error to `console.error` itself, on top of the
   * boundary's own call. Left alone, a passing run prints several stack
   * traces and reads like a failing one.
   */
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  /**
   * Explicit, because this project does not run Vitest with `globals: true`.
   *
   * Testing Library auto-registers its cleanup against a global `afterEach`
   * and finds none here, so every `render` would stack another container in
   * `document.body` — and a query that matches one element per container
   * fails with "found multiple" on the second test that renders the same
   * thing. It presents as a broken assertion in a passing component.
   */
  cleanup();
  vi.restoreAllMocks();
});

describe('a render that throws', () => {
  it('is caught, and says the rest of the site still works', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/something went wrong on this page/i)).toBeTruthy();
  });

  it('surfaces the request id when the thrown thing carries one', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <ApiBoom />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('req-42')).toBeTruthy();
  });

  it('offers a way out that is not the browser back button', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /lobby/i })).toBeTruthy();
  });

  it('logs the failure rather than swallowing it', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    // There is no reporting service on this deployment; the console is the
    // only record, and a boundary that hid the stack would make the one class
    // of bug that reaches it the hardest to diagnose.
    expect(console.error).toHaveBeenCalled();
  });

  it('lets the page through when nothing throws', () => {
    shouldThrow = false;

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('the page rendered')).toBeTruthy();
  });
});

describe('navigating away from a page that threw', () => {
  it('clears the boundary, because the route is keyed on the pathname', () => {
    shouldThrow = true;

    const tree = (path) => (
      <MemoryRouter initialEntries={[path]}>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Boom />} />
            <Route path="/" element={<p>the lobby</p>} />
          </Routes>
        </RouteErrorBoundary>
      </MemoryRouter>
    );

    const { unmount } = render(tree('/broken'));
    expect(screen.getByText(/something went wrong on this page/i)).toBeTruthy();
    unmount();

    // A second location. Without the `key` the boundary would still be holding
    // the first page's error and this would render the apology again.
    render(tree('/'));
    expect(screen.getByText('the lobby')).toBeTruthy();
  });
});
