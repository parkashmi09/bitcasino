import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiWithMeta } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { EVENTS, play } from '@/lib/socket';
import { queryKeys } from '@/queries/keys';
import { refreshBalances } from '@/hooks/useWallet';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Launching a game, and playing an in-house one.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TWO PATHS ARE NOT VARIATIONS ON EACH OTHER.
 *
 * An **aggregator** game is an HTTP call that returns a provider URL, which
 * goes in an iframe. This app never sees the round: the provider debits and
 * credits the wallet through the seamless callback, and the only thing we
 * hold is the launch response.
 *
 * An **in-house original** is a socket round against casino-service. The
 * stake, the result and the payout are one transaction on our own tables, and
 * every one of them is visible to this client — which is why a round can
 * report the new balance in its own reply rather than refetching for it.
 *
 * They share a page and nothing else. Treating one as a special case of the
 * other is how a "launch" abstraction ends up with a `mode` parameter that
 * means something different in each branch.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * @see docs/10-backend-integration.md, Phase 5.
 */

/**
 * The in-house games this client can actually play, keyed by the `event` the
 * catalogue row carries in `parameters.event`.
 *
 * **Twenty games are implemented on the backend; one is wired here.** The
 * catalogue's `parameters.inHouse` says a game is an original, not that this
 * client knows how to draw it — Mines needs a grid and a cash-out step, Crash
 * needs the broadcast phase events, Blackjack needs a hand. Limbo is the
 * simplest shape the module has (one message in, one settled round back) and
 * it establishes the pattern the other nineteen follow.
 *
 * A game not in this table renders as "not wired up yet" rather than as a
 * broken button, and adding one is: an entry here, its wire name in
 * `socketEvents.js`, and a panel. Nothing in the transport changes.
 */
export const IN_HOUSE_EVENTS = Object.freeze({
  limbo: EVENTS.PLAY_LIMBO,
});

/** Whether this client can play a given catalogue game. */
export function isPlayable(game) {
  return Boolean(game?.inHouse && IN_HOUSE_EVENTS[game.event]);
}

/**
 * Open an aggregator game and get its launch URL.
 *
 * `mode` picks the route: `'real'` opens a wallet-backed session, `'fun'` the
 * provider's demo. Both answer `201 {url}`.
 *
 * ## The refusal is the expected outcome here, and it is not an error state
 *
 * With `GIS_MERCHANT_ID`/`GIS_MERCHANT_KEY` unset the service answers
 * `503 GIS_NOT_CONFIGURED` before it calls anything upstream. That is a
 * deployment fact, not a fault: the page says the provider is not configured
 * and stays useful. `UPSTREAM_FAILED` / `UPSTREAM_REJECTED` (502) mean the
 * credentials ARE set and the provider said no, which is a different sentence
 * to the player — `ProviderFrame` tells them apart by `error.code`.
 *
 * `retry: false` on both: a 503 from a missing environment variable will not
 * become a 200 on the second attempt, and a launch writes a session row.
 */
export function useLaunchGame() {
  return useMutation({
    mutationFn: ({ mode, gameUuid, playerName, currency, device = 'desktop', language }) =>
      mode === 'fun'
        ? api(ENDPOINTS.gisLaunchDemo, {
            method: 'POST',
            body: compactBody({ gameUuid, device, language }),
          })
        : api(ENDPOINTS.gisLaunch, {
            method: 'POST',
            /**
             * `playerName` and `currency` are required by the validator and it
             * is `.strict()` — an extra key is a 422, not a silent drop. The
             * player ID is NOT sent: it comes from the token, which is what
             * closed legacy's hole of playing someone else's balance.
             */
            body: compactBody({ gameUuid, playerName, currency, device, language }),
          }),
    retry: false,
  });
}

/**
 * Play one round of an in-house original.
 *
 * The reply is the settled round — `{command: 'busted', result, hash, profit,
 * balance, win, gid}` — because the engine settles inside the same handler
 * that took the stake. Legacy emitted twice with a 50ms timer between; both
 * halves are one message here and the client paces its own animation.
 *
 * ## What happens to the money, and why a failure is safe to retry
 *
 * `placeBet` debits with a guarded `UPDATE … WHERE coin >= stake`, so Postgres
 * decides affordability at the moment of the write — two simultaneous rounds
 * cannot both pass it. If anything after that throws, the engine refunds the
 * stake before the error is sent. So an error reaching this hook means either
 * the stake never moved or it moved back, and pressing the button again is
 * always safe. That is not true of `useSubmitWithdrawal`, which is why this
 * one does not carry the same warnings.
 *
 * ## `balance` comes back with the round, but the header still refetches
 *
 * The reply's `balance` is authoritative for the coin that was played and it
 * repaints the panel immediately, with no round trip. The wallet reads are
 * refreshed anyway because they hold every OTHER currency too, and because
 * `bets` now has a row the history is showing a stale count of.
 *
 * **`refreshBalances()` is not redundant with the invalidation beside it.**
 * The header chip's `useBalances` is a hand-rolled `useEffect` fetch, not a
 * React Query hook, so it holds nothing in the cache and
 * `invalidateQueries(['balances'])` matches no entry and does nothing —
 * silently, because an invalidation that hits zero queries is not an error.
 * Found in the browser: the panel repainted with the new balance while the
 * chip two inches above it kept the old one.
 */
export function usePlayRound(event) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (payload) => {
      if (!event) {
        // A caller asking to play a game with no wire name is a bug in the
        // table above, not a refusal to surface to the player.
        throw new Error('No in-house event for this game');
      }
      return play(event, payload);
    },
    /**
     * `retry: false` even though a retry would be safe. A round is a bet: if
     * the reply is lost, the round still happened, and playing it again
     * without the player asking is a second stake they did not place.
     */
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.play.all });
      client.invalidateQueries({ queryKey: ['wallet'] });
      refreshBalances();
    },
  });
}

/**
 * The player's own settled rounds, newest first.
 *
 * **Page-based** (`page`/`limit`), and the validator is `.strict()` — sending
 * `offset` here is a 422 rather than a default, and a 422 on a list renders as
 * an empty history, which looks exactly like a player who has never played.
 * `source: 'inhouse'` narrows it to the `bets` table, which is what a game
 * panel wants: the provider rows would be movements from a different game.
 *
 * `apiWithMeta` rather than `api`, because the total is in `meta.pagination`
 * and a list route never carries it in `data`.
 */
export function useBetHistory({ limit = 10, page = 1, source, enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.play.bets({ limit, page, source }),
    queryFn: ({ signal }) =>
      apiWithMeta(ENDPOINTS.betHistory, {
        query: { page, limit, ...(source ? { source } : {}) },
        signal,
      }),
    enabled: enabled && status === 'authenticated',
    /**
     * Zero. Every round invalidates this, and a stale time would let a player
     * watch a round settle in the panel above and not appear in the list below
     * it.
     */
    staleTime: 0,
  });
}

/** Drop undefined keys — every one of these validators is `.strict()`. */
function compactBody(body) {
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}
