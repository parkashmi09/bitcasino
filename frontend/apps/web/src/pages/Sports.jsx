import { Component, lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/guards';
import { launchSportsbook } from '@/lib/sportsbookLaunch';
import { queryKeys } from '@/queries/keys';
import { QueryError } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSiteConfig, useSportsbookSettings } from '@/queries/siteConfig';
import ExchangeLobby from '@/pages/Exchange/Lobby';
import ExchangeMyBets from '@/pages/Exchange/MyBets';
import ExchangeStatement from '@/pages/Exchange/Statement';
import SportsInrDialog from '@/pages/Exchange/SportsInrDialog';

const ExchangeMatch = lazy(() => import('@/pages/Exchange/Match/index.jsx'));

/**
 * `/sports/*` — the owner's two sports products, each switched on its own:
 *   exchange only  `/sports/*` is the native exchange;
 *   sportsbook only `/sports/*` is the provider's sportsbook in an iframe (`lib/sportsbookLaunch.js`:
 *                  Slotegrator, else LuckySports);
 *   both           `/sports/*` is the exchange and `/sports/book` the sportsbook.
 *
 * Signed out → `RequireAuth` sends the player to log in and back, like `/games/recent`.
 * One launch per sign-in: the key carries the player and never goes stale, so leaving and
 * coming back reuses the open book instead of starting a new upstream session.
 */
export function Sports() {
  // The gate (lib/gates.js) lets this page mount only when one of the two flags is on.
  const { config } = useSiteConfig();
  const book = config.raw?.sportsbook === true;
  const exchange = config.raw?.sportsexchange === true;
  const bookPage = (
    <RequireAuth>
      <Book />
    </RequireAuth>
  );
  if (book && !exchange) return bookPage;
  if (!book) return <Exchange />;
  return (
    <Routes>
      <Route path="book/*" element={bookPage} />
      <Route path="*" element={<Exchange />} />
    </Routes>
  );
}

/**
 * The native sports EXCHANGE (hash-game-exchange pages/Exchange, its App.jsx routing): lobby,
 * match page (lazy), My Bets and Statement (sign-in needed), any other `/sports/*` = the lobby.
 */
function Exchange() {
  const { pathname } = useLocation();
  return (
    <>
      <SportsInrDialog />
      <Routes>
        <Route index element={<ExchangeLobby />} />
        <Route path="live" element={<Navigate to="/sports?sport=inplay" replace />} />
        <Route
          path="match/:sid/:gmid"
          element={
            <LazyRouteBoundary key={pathname}>
              <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                <ExchangeMatch />
              </Suspense>
            </LazyRouteBoundary>
          }
        />
        <Route path="my-bets" element={<RequireAuth><ExchangeMyBets /></RequireAuth>} />
        <Route path="statement" element={<RequireAuth><ExchangeStatement /></RequireAuth>} />
        <Route path="*" element={<ExchangeLobby />} />
      </Routes>
    </>
  );
}

/* A failed lazy chunk (a deploy replaced it) shows a retry rather than blanking the page. */
class LazyRouteBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <QueryError error={this.state.error} onRetry={() => window.location.reload()} title="Could not open this match" />;
    }
    return this.props.children;
  }
}

// The content column under the 64px header: less the mobile bottom nav below `md`, the top gap above.
const FRAME = 'h-[calc(100svh-9rem)] min-h-[480px] w-full rounded-lg md:h-[calc(100svh-6.5rem)]';

function Book() {
  const { user } = useAuth();
  const settings = useSportsbookSettings();
  const book = useQuery({
    queryKey: [...queryKeys.play.sportsbook(user?.id ?? null), settings.gameUid],
    queryFn: () => launchSportsbook('INR', settings.gameUid),
    // Wait for the owner's game, or the default would open first.
    enabled: !settings.isPending,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  if (book.isPending) return <Skeleton className={FRAME} />;
  if (book.isError || !book.data?.url) {
    return <QueryError error={book.error} onRetry={book.refetch} title="Could not open the sportsbook" />;
  }
  return (
    <iframe
      src={book.data.url}
      title="Sportsbook"
      className={`${FRAME} border-0 bg-goku`}
      allow="fullscreen; autoplay; clipboard-write"
      /* The book is another origin, so `allow-same-origin` only keeps ITS storage working (bet
         slip, login); it still cannot read this document. */
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
    />
  );
}
