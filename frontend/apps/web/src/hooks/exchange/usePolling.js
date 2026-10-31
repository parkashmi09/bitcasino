import React from 'react';

/* A 429 (the gateway's rate limit) is not answered by asking again on schedule — that only keeps
   the bucket full. Each consecutive 429 doubles the wait (from at least 5s, capped at 60s); the
   first success returns the loop to its own interval. */
export const RATE_LIMIT_BASE_MS = 5000;
export const RATE_LIMIT_MAX_MS = 60000;
export const isRateLimited = (error) => Number(error?.status) === 429;
export const rateLimitDelay = (intervalMs, strikes) =>
  Math.min(RATE_LIMIT_MAX_MS, Math.max(intervalMs, RATE_LIMIT_BASE_MS) * 2 ** Math.max(0, strikes - 1));

/* ─── One poll loop for every exchange read ───────────────────────────────────────────────
 *
 * Self-scheduling (the next cycle starts `intervalMs` after the previous one BEGAN, or at once
 * if the request took longer; backed off on 429, see RATE_LIMIT_*) — never setInterval, which piles overlapping requests up and lets
 * an old answer overwrite a newer one. Paused while the tab is hidden; on return it polls at once.
 * `refreshEvent` (a window event name, e.g. 'bet:placed', or a list of them) triggers an immediate poll.
 *
 * `key` identifies WHAT is being read (e.g. the gmid). Data belongs to the key it was read for,
 * so switching keys shows `data: undefined` on the very next render instead of the old match's
 * data — derived during render, no reset effect.
 *
 * @param {(signal: AbortSignal) => Promise<*>} fetcher  must be stable for a given key
 * @param {{ intervalMs?: number, enabled?: boolean, key?: string, refreshEvent?: string|string[],
 *           keepOnError?: boolean }} opts
 * @returns {{ data: *, error: Error|null, loading: boolean, refresh: () => void }}
 */
export function usePolling(fetcher, { intervalMs = 0, enabled = true, key = '', refreshEvent, keepOnError = true } = {}) {
  const [state, setState] = React.useState({ key: null, data: undefined, error: null });
  const kickRef = React.useRef(null);
  // A string, so an inline list does not restart the loop on every render.
  const refreshOn = [].concat(refreshEvent || []).join(' ');

  React.useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let timer = null;
    let gen = 0;
    let controller = null;
    let strikes = 0; // consecutive 429s

    const run = async (myGen) => {
      if (!active || myGen !== gen) return;
      const startedAt = Date.now();
      controller = new AbortController();
      try {
        const data = await fetcher(controller.signal);
        strikes = 0;
        if (active && myGen === gen) setState({ key, data, error: null });
      } catch (error) {
        strikes = isRateLimited(error) ? strikes + 1 : 0;
        if (active && myGen === gen && error?.name !== 'AbortError') {
          setState((prev) => ({
            key,
            data: keepOnError && prev.key === key ? prev.data : undefined,
            error,
          }));
        }
      } finally {
        /* A one-shot read (intervalMs 0) that met a 429 is still retried, a few times, on the backoff. */
        if (active && myGen === gen && (intervalMs > 0 || (strikes > 0 && strikes <= 4)) && !document.hidden) {
          const wait = strikes ? rateLimitDelay(intervalMs, strikes) : intervalMs;
          timer = setTimeout(() => run(myGen), Math.max(0, wait - (Date.now() - startedAt)));
        }
      }
    };

    const kick = () => {
      if (!active) return;
      clearTimeout(timer);
      controller?.abort();
      gen += 1;
      run(gen);
    };
    kickRef.current = kick;

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else kick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const events = refreshOn ? refreshOn.split(' ') : [];
    events.forEach((name) => window.addEventListener(name, kick));

    run(gen);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      kickRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      events.forEach((name) => window.removeEventListener(name, kick));
    };
  }, [fetcher, intervalMs, enabled, key, refreshOn, keepOnError]);

  const refresh = React.useCallback(() => kickRef.current?.(), []);
  const mine = state.key === key;
  return {
    data: enabled && mine ? state.data : undefined,
    error: enabled && mine ? state.error : null,
    loading: enabled && !mine,
    refresh,
  };
}

export default usePolling;
