import React from 'react';
import { getMatchMarkets, readPushedMarkets } from '../../services/exchange/feed';
import { connectOddsSocket } from '../../services/exchange/oddsSocket';
import { POLL_TIMEOUT_MS } from '../../services/exchange/api';
import { fetchEventLimits, applyEventLimits } from '../../services/exchange/eventLimits';
import { applyMatchOddsLimits } from '../../utils/exchange/oddsHelpers';
import { isRateLimited, rateLimitDelay } from './usePolling';

/* ─── Live markets of one match ──────────────────────────────────────────────────────────
 *
 * Port of TENEXCH hooks/useMatchData.js (the markets half; the header is useMatchHeader):
 *
 *  - PUSHED first (TENEXCH odds push): the sports socket sends the board when it changes and a
 *    heartbeat every ~2s (services/exchange/oddsSocket.js). While a push landed < PUSH_FRESH_MS ago on
 *    a connected socket the HTTP poll is skipped; a pushed body goes through the SAME handling below.
 *    Socket down or pushes stopped → the poll below runs exactly as before (the fallback).
 *  - SELF-SCHEDULING poll every POLL_MS: a cycle starts POLL_MS after the previous one began, or
 *    at once if that already passed — never overlapping, so older odds never overwrite newer.
 *  - WATCHDOG: a cycle in flight longer than STALL_MS (request timeout + 5s) is superseded, the
 *    fix for a request that hung on a connection the OS dropped.
 *  - PAUSED while the tab is hidden; a fresh poll fires the moment it is visible again.
 *  - ONLY a 404/410 means gone (services/exchange/feed.js isGoneBody). A 5xx, 429 or timeout is
 *    the provider being unwell and leaves the board exactly as it is (`error` is set).
 *  - An identical payload is not written to state (most polls carry the same odds).
 *  - Each feed market is shaped like TENEXCH does before anything reads it: applyMatchOddsLimits
 *    (gtype 'match': pre-match → umaxbof, in-play → maxb, folded into `max`, maxb zeroed), then the
 *    owner's per-event overrides (`/bet-limits/:gmid`, refreshed every 30s, read from cache here).
 *
 * @returns {{
 *   markets: object[],        shaped feed markets (see services/exchange/feed.js Market)
 *   loading: boolean,         true until the first answer for this gmid
 *   error: Error|null,        last transient failure (board kept)
 *   noMarkets: boolean,       404/410 before any market ever loaded → dead game, leave the page
 *   roundGone: boolean,       between virtual rounds ("No Record Found") or gone after loading
 *   matchGone: boolean,       had markets, now 404/410 → the match ended while open
 *   getMarkets: () => object[] the LIVE list (ref), for a slip that must read the freshest odds
 *   refresh: () => void
 * }}
 */
/* 1s, not TENEXCH's 300ms: at 300ms one open match page alone is ~200 requests a minute, and
   with the lobby and balance polls on top the gateway's global bucket (RATE_LIMIT_MAX=300/min)
   answered 429 and froze the whole site for 60s. The user chose 1s over raising the limit
   (2026-10-13). */
const POLL_MS = 1000;
const STALL_MS = POLL_TIMEOUT_MS + 5000;
const WATCHDOG_TICK_MS = 3000;
const LIMITS_REFRESH_MS = 30000;
const PUSH_FRESH_MS = 5000;

const EMPTY = { key: null, markets: [], loaded: false, error: null, noMarkets: false, roundGone: false, matchGone: false };

export function useMatchMarkets(gmid, sid) {
  const key = gmid && sid ? `${gmid}|${sid}` : '';
  const [state, setState] = React.useState(EMPTY);
  const marketsRef = React.useRef([]);
  const kickRef = React.useRef(null);

  React.useEffect(() => {
    if (!key) return undefined;
    let active = true;
    let gen = 0;
    let timer = null;
    let inFlightSince = null;
    let hadMarkets = false;
    let lastPayload = null;
    let lastLimitsAt = 0;
    let strikes = 0; // consecutive 429s — backs the 1s poll off (usePolling's rateLimitDelay)
    let pushConnected = false;
    let pushedAt = 0;
    const pushFresh = () => pushConnected && Date.now() - pushedAt < PUSH_FRESH_MS;
    marketsRef.current = [];

    const patch = (p) => setState((prev) => ({ ...(prev.key === key ? prev : { ...EMPTY, key }), ...p, key }));

    fetchEventLimits(gmid);
    lastLimitsAt = Date.now();

    /* One answer — polled or pushed — onto the board. */
    const apply = ({ state: st, markets }) => {
      if (st === 'ok') {
        hadMarkets = true;
        const fresh = JSON.stringify(markets);
        if (fresh !== lastPayload) {
          lastPayload = fresh;
          const shaped = applyEventLimits(markets.map((m) => applyMatchOddsLimits(m, sid)), gmid);
          marketsRef.current = shaped;
          patch({ markets: shaped, loaded: true, error: null, roundGone: false, matchGone: false });
        } else {
          patch({ loaded: true, error: null, roundGone: false, matchGone: false });
        }
      } else if (st === 'no_record') {
        patch({ loaded: true, roundGone: true });
      } else if (st === 'gone') {
        if (!hadMarkets) patch({ loaded: true, noMarkets: true });
        else patch({ loaded: true, roundGone: true, matchGone: true });
      } else {
        patch({ loaded: true });
      }
    };

    const poll = async () => {
      if (!pushFresh()) {
        try {
          const answer = await getMatchMarkets(gmid, sid);
          if (!active) return;
          apply(answer);
          strikes = 0;
        } catch (error) {
          strikes = isRateLimited(error) ? strikes + 1 : 0;
          if (active) patch({ loaded: true, error });
        }
      }
      if (active && Date.now() - lastLimitsAt > LIMITS_REFRESH_MS) {
        lastLimitsAt = Date.now();
        fetchEventLimits(gmid, { force: true });
      }
    };

    const loop = async (myGen) => {
      if (!active || myGen !== gen) return;
      const startedAt = Date.now();
      inFlightSince = startedAt;
      try {
        await poll();
      } finally {
        if (myGen === gen) inFlightSince = null;
        if (active && myGen === gen && !document.hidden) {
          const wait = strikes ? rateLimitDelay(POLL_MS, strikes) : POLL_MS;
          timer = setTimeout(() => loop(myGen), Math.max(0, wait - (Date.now() - startedAt)));
        }
      }
    };

    const kick = () => {
      if (!active) return;
      clearTimeout(timer);
      gen += 1;
      loop(gen);
    };
    kickRef.current = kick;

    const watchdog = setInterval(() => {
      if (active && inFlightSince != null && Date.now() - inFlightSince > STALL_MS) {
        inFlightSince = null;
        kick();
      }
    }, WATCHDOG_TICK_MS);

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else kick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', kick);

    const disconnectOdds = connectOddsSocket({
      gmid,
      sid,
      onOdds: (m) => {
        if (!active) return;
        pushedAt = Date.now();
        if (m.status == null) return; // heartbeat: the board is unchanged
        try {
          apply(readPushedMarkets(m.status, m.body));
        } catch (error) {
          patch({ loaded: true, error });
        }
      },
      onStatus: (up) => {
        const dropped = pushConnected && !up;
        pushConnected = up;
        if (dropped) kick(); // the push is gone: poll at once instead of waiting out PUSH_FRESH_MS
      },
    });

    loop(gen);
    return () => {
      active = false;
      disconnectOdds();
      clearTimeout(timer);
      clearInterval(watchdog);
      kickRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', kick);
    };
  }, [key, gmid, sid]);

  const getMarkets = React.useCallback(() => marketsRef.current, []);
  const refresh = React.useCallback(() => kickRef.current?.(), []);
  const s = state.key === key ? state : EMPTY;
  return {
    markets: s.markets,
    loading: Boolean(key) && !s.loaded,
    error: s.error,
    noMarkets: s.noMarkets,
    roundGone: s.roundGone,
    matchGone: s.matchGone,
    getMarkets,
    refresh,
  };
}

export default useMatchMarkets;
