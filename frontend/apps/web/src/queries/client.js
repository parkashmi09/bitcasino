import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/**
 * The shared query client.
 *
 * Built here rather than inline in `main.jsx` so the tests can construct one
 * with the same policy, and so the retry rule below has somewhere to be
 * explained.
 */

/**
 * Statuses worth trying again.
 *
 * A 4xx will not fix itself: a 422 means we sent the wrong pagination pair, a
 * 404 means the collection slug is not one the platform serves, a 401 has
 * already been through `api.js`'s single-flight refresh and come back refused.
 * Retrying any of those three times just triples the log noise and delays the
 * error state the player needs to see.
 *
 * A 5xx, a timeout, or no answer at all is a different claim — the request was
 * fine and the server was not — so those get two more attempts.
 *
 * The rate limit is the interesting case. The catalogue routes are metered,
 * and a 429 IS worth retrying, but only with real backoff: react-query's
 * default doubling starts at 1s, and this client's cap of 30s keeps a retry
 * from landing inside the same window that refused the first one.
 */
const RETRYABLE = new Set(['NETWORK_UNAVAILABLE', 'GATEWAY_UNAVAILABLE', 'SERVER_ERROR']);

function shouldRetry(failureCount, error) {
  if (failureCount >= 2) return false;
  if (!(error instanceof ApiError)) return true;
  if (RETRYABLE.has(error.code)) return true;
  /**
   * A 429 gets ONE more attempt, not two.
   *
   * The limiter's window is a whole minute on most buckets and an hour on
   * registration, so a second and third attempt are both refused by
   * construction — they cost a round trip each, count against the same
   * bucket, and delay the error the player needs to read by however long the
   * backoff took. One attempt covers the case worth covering: a window that
   * was about to roll over anyway.
   */
  if (error.status === 429) return failureCount < 1;
  return error.status >= 500 || error.status === 0;
}

/**
 * How long to wait before the retry `shouldRetry` allowed.
 *
 * Exponential for everything except a rate limit, where the SERVER has said
 * how long its window is and guessing shorter is what turns one refusal into
 * two. `retryAfter` is seconds; a limiter that sent none falls back to the
 * curve, and both are capped at 30s so a query cannot sit invisible behind a
 * long window — past that the error state, with the wait written on it, is
 * more use than a spinner.
 */
const MAX_DELAY_MS = 30_000;

function retryDelay(attempt, error) {
  if (error instanceof ApiError && error.retryAfter != null) {
    return Math.min(error.retryAfter * 1000, MAX_DELAY_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay,
        /**
         * The catalogue changes when an operator edits it or a sync runs —
         * minutes apart, not seconds. Five minutes of freshness means moving
         * between the home page, a category and back does not refetch three
         * times, which is what makes the rails feel instant on the second
         * visit.
         *
         * Player-scoped queries that need to be tighter than this (the wallet
         * balance, most obviously) set their own `staleTime`; they are the
         * exception, so they carry the override rather than this carrying a
         * default that suits nothing.
         */
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        /**
         * Off. The reference site does not reload its rails when you come back
         * to the tab, and a catalogue that reshuffles under a player who was
         * reading it is worse than one a few minutes stale.
         */
        refetchOnWindowFocus: false,
        /**
         * On. This one is worth it: a player who dropped off the network and
         * came back is looking at a page that failed, and reconnecting is the
         * moment it can succeed.
         */
        refetchOnReconnect: true,
      },
      mutations: {
        // A mutation is not idempotent. Retrying a deposit or a bet
        // automatically is how one becomes two.
        retry: false,
      },
    },
  });
}

export { shouldRetry, retryDelay };
