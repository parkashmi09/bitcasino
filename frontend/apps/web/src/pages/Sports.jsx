import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/guards';
import { launchSportsbook } from '@/lib/sportsbookLaunch';
import { queryKeys } from '@/queries/keys';
import { QueryError } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * `/sports/*` — the provider's sportsbook in an iframe (`lib/sportsbookLaunch.js`: Slotegrator,
 * else LuckySports). Only reachable while the owner has `sports` + `sportsbook` on (`lib/gates.js`).
 *
 * Signed out → `RequireAuth` sends the player to log in and back, like `/games/recent`.
 * One launch per sign-in: the key carries the player and never goes stale, so leaving and
 * coming back reuses the open book instead of starting a new upstream session.
 */
export function Sports() {
  return (
    <RequireAuth>
      <Book />
    </RequireAuth>
  );
}

// The content column under the 64px header: less the mobile bottom nav below `md`, the top gap above.
const FRAME = 'h-[calc(100svh-9rem)] min-h-[480px] w-full rounded-lg md:h-[calc(100svh-6.5rem)]';

function Book() {
  const { user } = useAuth();
  const book = useQuery({
    queryKey: queryKeys.play.sportsbook(user?.id ?? null),
    queryFn: () => launchSportsbook(),
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
