import { useQuery } from '@tanstack/react-query';
import { EVENTS, RATE_LIMIT_WINDOW_MS, SocketError, request } from '@/lib/socket';
import { queryKeys } from '@/queries/keys';

/**
 * The live surfaces: everyone's recent bets, the biggest recent wins, and the
 * platform's announcements.
 *
 * All four events are **public** — a signed-out visitor sends them on the
 * anonymous connection the transport already keeps open for exactly this.
 *
 * @see docs/10-backend-integration.md, Phase 8.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * WHY THESE ARE SOCKET EVENTS AND NOT HTTP READS
 *
 * `GET /casino/bet-history/live` answers the same feed over HTTP and this
 * layer does not call it, which needs saying because Phase 8's own plan
 * names both.
 *
 * The socket rows carry the PLAYER — `{name, avatar, game, coin, amount,
 * profit, at}`. The HTTP rows do not: that route answers `{reference, game,
 * currency, amount, profit, outcome}` and deliberately exposes no identity,
 * because it is reachable by anyone with a URL and no connection to speak of.
 * A wins ticker without a name on it is a list of numbers, and the reference
 * site's own ticker is built around the name.
 *
 * So the two are not the same read in two transports. They are a public feed
 * and a more public one, and this is the surface that wants the first.
 *
 * The cost is honest and worth writing down: a signed-out visitor loading the
 * home page now opens a socket to user-service, which before Phase 8 they did
 * not. One connection, shared by every live surface on the page.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How often each feed re-reads.
 *
 * These are POLLS over a socket, not a subscription — `LAST_BETS` is
 * request/reply, and the platform pushes nothing on it. The interval is
 * therefore a real choice rather than a fallback, and 20 seconds is the one
 * the ticker was already using over HTTP: fast enough that a round played in
 * another tab shows up while the player is still looking at the page, slow
 * enough to sit an order of magnitude under the public bucket's 40-per-10s.
 */
const FEED_POLL_MS = 20_000;

/** Announcements change when an operator writes one. Minutes, not seconds. */
const NOTICE_POLL_MS = 5 * 60_000;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * A RATE-LIMITED POLL MUST NOT KEEP ITS INTERVAL.
 *
 * The socket limiter is per connection, per event, on a fixed 10-second
 * window, and it counts REFUSED messages too. A 20-second poll cannot reach
 * it on its own — but several live surfaces on one page, a reconnect storm,
 * or a tab that has been backgrounded and resumed all can, and once a poll is
 * inside the window every tick it fires extends the window it is trying to
 * escape.
 *
 * So a refusal widens the interval to the full window length rather than
 * retrying on schedule. It is the smallest wait that is guaranteed to land in
 * a fresh window, which is the most a `SOCKET_RATE_LIMITED` frame can tell us
 * — unlike the HTTP 429, it carries no `Retry-After` (see `SocketError`).
 *
 * `refetchInterval` is given the QUERY, so it re-decides after every tick:
 * the moment one succeeds the interval drops back to normal on its own.
 * ═══════════════════════════════════════════════════════════════════════
 */
function backOffWhenLimited(normalMs) {
  return (query) => {
    const error = query?.state?.error;
    if (error instanceof SocketError && error.isRateLimited) {
      return Math.max(normalMs, RATE_LIMIT_WINDOW_MS);
    }
    return normalMs;
  };
}

/**
 * A row of the bet feed, normalised.
 *
 * ## Money stays a string
 *
 * `amount` and `profit` are decimal strings off `NUMERIC(30,8)` columns. They
 * are carried through untouched and formatted by `walletBalance` at the point
 * of render; nothing here calls `Number` on either, because a stake of
 * `10.00000000` and a profit of `23.30000000` are exact and a float is not.
 *
 * ## `profit` is signed, and the sign is the whole classification
 *
 * The feed is every settled round, losses included — the server does not
 * filter and should not, since `LAST_BETS_BY_GAME` on a game page wants the
 * losses too. `won` is derived from the leading `-` rather than from
 * arithmetic, for the same reason as above.
 *
 * ## There is no id
 *
 * A row has no primary key of its own; `at` is the closest thing, and two
 * rounds settled in the same millisecond share it — which really happens,
 * because the seeded demo rounds were written in a loop. The key therefore
 * combines the timestamp with the position, which is stable for as long as a
 * given response is on screen and is all a list key needs to be.
 */
function toBet(row, index) {
  const profit = String(row?.profit ?? '0');

  return {
    key: `${row?.at ?? 'unknown'}:${index}`,
    player: row?.name || 'Anonymous',
    avatar: row?.avatar ?? null,
    game: row?.game || 'Unknown game',
    // `coin`, not `currency` — this feed uses the legacy field name, and it
    // arrives lowercase (`inr`), which every formatter here wants uppercase.
    currency: String(row?.coin || 'USDT').toUpperCase(),
    amount: String(row?.amount ?? '0'),
    profit,
    won: !profit.startsWith('-') && profit !== '0',
    at: row?.at ?? null,
  };
}

function toBets(reply, field) {
  const rows = reply?.[field];
  return Array.isArray(rows) ? rows.map(toBet) : [];
}

/**
 * Everyone's most recent settled rounds, newest first.
 *
 * Legitimately empty on a deployment nobody has played yet — an empty feed is
 * a state, not a failure, and `LatestWins` renders nothing rather than an
 * empty rail.
 */
export function useLastBets({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.live.bets(),
    queryFn: () => request(EVENTS.LAST_BETS).then((reply) => toBets(reply, 'bets')),
    enabled,
    staleTime: 0,
    refetchInterval: backOffWhenLimited(FEED_POLL_MS),
    /**
     * No retry. A ticker that failed reappears on the next tick twenty
     * seconds later, and an immediate retry against a socket that just
     * refused is the fastest way into the rate limit this file backs off for.
     */
    retry: false,
  });
}

/**
 * The same feed narrowed to one in-house game.
 *
 * `game` is the ENGINE key — `limbo`, `dice`, `crash` — not a catalogue slug
 * and not a display title.
 *
 * An unknown key answers an EMPTY LIST, not a refusal: only the empty string
 * is guarded server-side (see `EVENTS.LAST_BETS_BY_GAME` for the three
 * measured shapes). That means sending a provider title's slug here produces
 * a permanently empty feed that looks exactly like a game nobody has played,
 * with nothing anywhere to say the name was wrong — so the caller decides
 * with `isPlayable` from `queries/play.js` rather than letting this find out.
 */
export function useLastBetsByGame(game, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.live.betsByGame(game),
    queryFn: () =>
      request(EVENTS.LAST_BETS_BY_GAME, { game }).then((reply) => toBets(reply, 'bets')),
    enabled: enabled && Boolean(game),
    staleTime: 0,
    refetchInterval: backOffWhenLimited(FEED_POLL_MS),
    retry: false,
  });
}

/**
 * The biggest recent wins.
 *
 * Ordered by profit, not by time, and answered under `winners` rather than
 * `bets`. It is NOT `useLastBets` sorted differently — an hour-old jackpot
 * outranks a win from a minute ago, so the two lists overlap without either
 * being derivable from the other.
 */
export function useTopWinners({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.live.topWinners(),
    queryFn: () => request(EVENTS.TOP_WINNERS).then((reply) => toBets(reply, 'winners')),
    enabled,
    staleTime: 0,
    refetchInterval: backOffWhenLimited(FEED_POLL_MS),
    retry: false,
  });
}

/**
 * The platform's announcements — the twenty newest.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * A NOTIFICATION ROW HAS NO ID, AND THAT IS A SCHEMA FACT, NOT AN OMISSION.
 *
 * `notifications` is declared `(title, content, date)` with no primary key
 * and no unique column, so there is nothing on the wire to address a single
 * notice by. The read-set in `useNotifications` needs a stable identity per
 * row anyway — otherwise `Mark all as read` cannot outlive a reload — so one
 * is DERIVED here, from the two fields that together identify a notice: its
 * date and its title.
 *
 * The consequences are real and worth stating rather than discovering. An
 * operator who edits a notice's title changes its identity, so it comes back
 * unread; two notices posted at the same instant with the same title collapse
 * to one key. Both are better than the alternative, which is a key derived
 * from the row's POSITION — that changes every time anything is posted, and
 * would mark the whole feed unread on every new announcement.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function useNotificationFeed({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.live.notifications(),
    queryFn: () =>
      request(EVENTS.NOTIFICATION).then((reply) => {
        const rows = Array.isArray(reply?.notifications) ? reply.notifications : [];
        return rows.map((row) => ({
          id: `${row?.date ?? ''}|${row?.title ?? ''}`,
          title: row?.title ?? '',
          body: row?.content ?? '',
          at: row?.date ?? null,
        }));
      }),
    enabled,
    staleTime: NOTICE_POLL_MS,
    refetchInterval: backOffWhenLimited(NOTICE_POLL_MS),
    retry: false,
  });
}

export { toBet };
