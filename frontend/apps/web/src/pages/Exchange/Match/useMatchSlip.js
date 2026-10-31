import React from 'react';
import {
  buildBetValue,
  isOddsEditable,
  prevalidateBet,
  isRacingSid,
  beginBetSubmit,
  endBetSubmit,
  betMarketKey,
  buildPlaceRequest,
  classifyMarket,
  calculateRunnerPL,
  calcPL,
  showsZeroProfit,
  getOddsFieldMode,
  ODDS_FIELD,
  namesOwnLine,
  stepOdds,
  stepKhadoLine,
  computeCashoutClick,
  BET_TOAST,
  stakeLimits,
  makeStakeCurrency,
} from '../../../utils/exchange';
import {
  placeBet,
  savePendingBet,
  clearPendingBet,
  announceBetPlaced,
  getSportsBufferSeconds,
} from '../../../services/exchange';
import { toast } from '@/lib/toast';
import { isRaceBettingOpen, RACE_WINDOW_TOAST } from '../../../utils/exchange/placeBetRules';
import { fetchBalanceRest } from '../../../services/exchange/balanceSocket';
import { bestPrice, bookFor } from './shape';

/* ─── The match page's one open bet slip ──────────────────────────────────────────────────
 *
 * TENEXCH GameDetails.handleBetClick + usePlaceBetPanel, reduced to what the kit's controlled
 * BetSlipInline needs, with every decision delegated to utils/exchange:
 *
 *   click → buildBetValue → slip under the runner → stake / odds edits
 *   Place → prevalidateBet → beginBetSubmit → buildPlaceRequest → savePendingBet → placeBet
 *         (the SERVER holds the owner's buffer; the slip shows its seconds as a countdown)
 *   ok    → close, toast BET_PLACED, clearPendingBet, announceBetPlaced (exposure + open bets refresh)
 *   error → TENEXCH usePlaceBetPanel: close the slip FIRST, then toast the reason (a client-side
 *           reject or the server's own message, e.g. "Bet not confirm check balance."). Leaving
 *           the slip open invited a second Place of a bet already refused. endBetSubmit always.
 *           One-click goes through the same submit, so it toasts the same way.
 *
 * Differences from a plain click that the reference makes and this keeps:
 *   - line markets (fancy2): the field shows the touched rung but the bet executes at that
 *     side's LIVE main quote, read again at submit (feed sides inverted: No = feed back).
 *   - khado: the field is a run line the punter names (stepKhadoLine), sent as-is, never "edited".
 *   - Match Odds (gtype match): the stepper edits the price → manual path (isEdited, E vs X).
 *   - cashout: prefilled hedge stake, price locked, no min-stake floor (TENEXCH minStake 0 for a
 *     cashout — the computed hedge can be 99.02 on a min-100 market), never one-click.
 */

const lc = (v) => String(v || '').toLowerCase();

/** Feed side a slip's price lives on. Line markets invert it (TENEXCH feedSideFor). */
function feedSide(slip) {
  const lay = slip.bv.betType === 'lay' || slip.bv.betType === 'no';
  const inverted = slip.kind === 'line';
  return (inverted ? !lay : lay) ? 'lay' : 'back';
}

function liveSection(markets, slip) {
  const m = (markets || []).find((x) => String(x.mid) === String(slip.bv.market_id));
  return m?.section?.find((s) => String(s.sid) === String(slip.bv.selectionId)) || null;
}

/** The price this bet would be placed at right now. */
export function placementOdds(slip, markets) {
  if (!slip) return 0;
  if (slip.kind === 'line') {
    const live = bestPrice(liveSection(markets, slip), feedSide(slip));
    return Number(live) || Number(slip.bv.odds) || 0;
  }
  return Number(slip.display) || 0;
}

/** Manual-edit flag exactly as usePlaceBetPanel decides it (cashout / own line / locked never edit). */
function isEditedSlip(slip) {
  if (!slip || slip.bv.is_cashout || !slip.modified) return false;
  if (namesOwnLine(slip.bv.gtype, slip.bv.marketType, slip.bv.mname)) return false;
  if (!isOddsEditable(slip.bv)) return false;
  return Math.abs(Number(slip.display) - Number(slip.bv.odds)) > 0.001;
}

/** Profit / liability the slip prints — TENEXCH calcPL + displayProfit everywhere: a LAY wins the
 *  stake and risks stake × (odds − 1) (Addaplay printed the liability as the profit too), line
 *  pays evens, session rows / oddeven / a horse racecard print 0. Market type as TENEXCH
 *  classifyMarket reads it (gtype first), so every match1 market prices as a percent. */
export function slipFigures(slip, stake, odds) {
  if (!slip) return { profit: 0, liability: 0 };
  const { bv } = slip;
  const g = lc(bv.gtype);
  const fancyFamily = ['fancy', 'fancy1', 'fancy2', 'khado', 'meter', 'normal', 'oddeven'].includes(g);
  const mt = fancyFamily ? 'FANCY' : g === 'cricketcasino' ? 'CRICKET_CASINO' : classifyMarket(bv);
  const stakeNum = Number(stake) || 0;
  const horse = String(bv.sid) === '10';
  const zero = showsZeroProfit(bv.mname, mt, bv.gtype, { isHorseRacing: horse });
  // Session fancy (YES 55 @ 100): `odds` is the run line; it pays on the rate, bv.size.
  // YES wins stake x size/100 and risks the stake, NO the other way round (server placeBet).
  // The PROFIT shown is TENEXCH's: a fixed 0 on Normal / Ball By Ball / Over By Over (user,
  // 2026-10-21, overriding c6aab7ae); the liability stays the real amount the server blocks.
  if (g === 'fancy' && slip.kind !== 'line' && Number(bv.size) > 0) {
    const atRate = Math.round(stakeNum * Number(bv.size)) / 100;
    const yes = bv.betType === 'yes' || bv.betType === 'back';
    return { profit: zero ? 0 : yes ? atRate : stakeNum, liability: yes ? stakeNum : atRate };
  }
  const { profit, loss } = calcPL(stake, odds, bv.betType, mt);
  const shown = slip.kind === 'line' ? stakeNum : zero ? 0 : profit;
  return { profit: shown, liability: loss };
}

/** Per-runner projection for the open slip's market: current book + this bet — TENEXCH
 *  GameDetails `runnerPL`: every market classifyMarket calls MATCH_ODDS (all gtype 'match',
 *  racecards included), BOOKMAKER (match1, percent) or CRICKET_CASINO (the Number grids);
 *  never a fancy. Same maths as the server's exposure walk (calculateRunnerPL). */
export function projectedBook(slip, stake, odds, market, book) {
  if (!slip || String(market?.mid) !== String(slip.bv.market_id)) return null;
  const mt = classifyMarket(market);
  if (mt !== 'MATCH_ODDS' && mt !== 'BOOKMAKER' && mt !== 'CRICKET_CASINO') return null;
  const names = (market.section || []).map((s) => s.nat || '');
  const side = slip.bv.betType === 'yes' ? 'back' : slip.bv.betType === 'no' ? 'lay' : slip.bv.betType;
  const pending = calculateRunnerPL({ stake, odds, betType: side, teamName: slip.bv.runnerName, marketType: mt }, names);
  if (!Object.keys(pending).length) return null;
  const out = {};
  for (const name of names) out[name] = Number(((bookFor(book, market.mid, name) ?? 0) + (pending[name] || 0)).toFixed(2));
  return out;
}

/** Money this bet needs from the wallet — TENEXCH usePlaceBetPanel Step 0a. On a runner-book market
 *  (MO / BM / cricket-casino) it is the worst-case loss after the bet minus the worst before, so a lay
 *  that hedges a back can need less than its stake; on every other market it is the stake. */
export function moneyNeeded(slip, stake, odds, market, book) {
  const after = projectedBook(slip, stake, odds, market, book);
  if (!after) return Number(stake) || 0;
  const worst = (vals) => Math.max(0, -Math.min(0, ...vals));
  const before = Object.keys(after).map((name) => bookFor(book, market.mid, name) ?? 0);
  return Number((worst(Object.values(after)) - worst(before)).toFixed(2));
}

/* The rupee as this site prints it. The exchange's messages spell it "Rs." / "Rs" ("Min stake
   Rs.50"); the rest of the site says ₹. DISPLAY ONLY — nothing parses these strings. */
export const rupeeText = (text) => String(text ?? '').replace(/\bRs\.?\s?(?=[\d₹])/g, '₹');

/* TENEXCH: the server's message as-is, NETWORK_ERROR for a failed fetch, GENERIC_ERROR otherwise. */
function errorText(err) {
  if (!err) return BET_TOAST.GENERIC_ERROR;
  if (err.code === 'NETWORK' || /fetch|network/i.test(err.message || '')) return BET_TOAST.NETWORK_ERROR;
  return rupeeText(err.message) || BET_TOAST.GENERIC_ERROR;
}

/* INR identity, for a caller that passes no currency. */
const INR = makeStakeCurrency({ currencyName: 'INR', usdPrice: 1, inrUsdPrice: 1 });

/** The INR limits the slip enforces (a cashout has no minimum — see the header). */
export function slipLimitsInr(bv) {
  if (!bv) return {};
  const { min, max } = stakeLimits(bv);
  return { minInr: bv.is_cashout ? undefined : min, maxInr: max };
}

/**
 * The stake the slip shows → the INR stake placeBet sends. The slip is typed in the header
 * wallet's coin (utils/exchange/stakeCurrency.js); mssports is INR-only. A cashout's prefilled
 * hedge goes back as the exact INR it was solved in, not a rounded round trip.
 */
export function slipStakeInr(slip, stakeStr, currency = INR) {
  if (!slip) return '';
  if (currency.isInr) return String(stakeStr ?? '');
  if (slip.cashoutInr != null && String(stakeStr) === slip.cashoutShown) return String(slip.cashoutInr);
  return currency.stakeToInr(stakeStr, slipLimitsInr(slip.bv));
}

/**
 * @param {object} p
 * @param {string|number} p.sid
 * @param {string|number} p.gmid
 * @param {object|null} p.match       header ({ gmid, ename, cname, stime })
 * @param {() => object[]} p.getMarkets  the live market list (useMatchMarkets().getMarkets)
 * @param {boolean} p.signedIn
 * @param {object} [p.currency]  useExchangeCurrency(): the coin the stake is typed in
 */
export function useMatchSlip({ sid, gmid, match, getMarkets, signedIn, currency = INR, book = null }) {
  const [slip, setSlip] = React.useState(null);
  const [stake, setStake] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [delaySeconds, setDelaySeconds] = React.useState(0);
  const tokenRef = React.useRef(0);
  const aliveRef = React.useRef(true);
  /* THE STAKE OUTLIVES A REFUSAL. The slip closes on a refusal (TENEXCH order, see the header)
     and used to take the typed stake with it, so after "Minimum bet amount is ₹50" the player
     had to type it all again. The refused stake is kept here and pre-fills the next slip they
     open (not a one-click, not a cashout — those bring their own); a placed bet clears it. */
  const keptStakeRef = React.useRef('');
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const matchInfo = React.useMemo(
    () => ({ gmid, ename: match?.ename || '', cname: match?.cname || '', stime: match?.stime || '' }),
    [gmid, match?.ename, match?.cname, match?.stime],
  );

  const close = React.useCallback(() => {
    tokenRef.current += 1;
    setSlip(null);
    setStake('');
    setError(null);
    setLoading(false);
  }, []);

  /* TENEXCH `handleClose(); bToastError(msg)` — only closes the slip this submit came from, so a
     late answer never shuts a slip the player has since opened on another price. */
  const reject = React.useCallback((token, message, stakeStr) => {
    if (stakeStr && Number(stakeStr) > 0) keptStakeRef.current = String(stakeStr);
    if (aliveRef.current && token === tokenRef.current) {
      tokenRef.current += 1;
      setSlip(null);
      setStake('');
      setError(null);
    }
    toast.error(rupeeText(message));
  }, []);

  /** The whole submit. `s` / `stakeStr` are passed in so one-click can place before state lands. */
  const submit = React.useCallback(
    async (s, stakeStr) => {
      if (!s) return;
      const token = tokenRef.current;
      const live = getMarkets();
      const odds = placementOdds(s, live);
      const isEdited = isEditedSlip(s);
      const bv = { ...s.bv };
      /* TENEXCH's order before the limits (usePlaceBetPanel Step 0a / 0a2): a racing stake over
         the max, then the WALLET (what the bet needs against the INR balance, so a funds problem is
         not answered with a limit message), then the race window — all before min/max. A cashout
         hedge is exempt from the wallet gate, as there. */
      if (!bv.is_cashout) {
        const inrFirst = slipStakeInr(s, stakeStr, currency);
        const market = live.find((m) => String(m.mid) === String(bv.market_id));
        const early = prevalidateBet({
          bv, stake: inrFirst, odds, originalOdds: s.kind === 'line' ? odds : bv.odds,
          isUserModifiedOdds: isEdited, match: matchInfo, markets: live, signedIn,
        });
        if (early?.code === 'ABOVE_MAX' && isRacingSid(bv.sid)) {
          reject(token, early.message, stakeStr);
          return;
        }
        // Unknown balance (read failed): the server's own wallet check decides.
        const wallet = await fetchBalanceRest().then((b) => b.balance, () => null);
        if (wallet != null && moneyNeeded(s, inrFirst, odds, market, book) > wallet) {
          reject(token, BET_TOAST.CHECK_BALANCE, stakeStr);
          return;
        }
        if (!isRaceBettingOpen(sid, matchInfo.stime)) {
          reject(token, RACE_WINDOW_TOAST, stakeStr);
          return;
        }
      }
      // Limits first in the player's own coin, so the message names what they typed.
      const coinErr = bv.is_cashout ? null : currency.checkStake(stakeStr, slipLimitsInr(bv));
      if (coinErr) {
        reject(token, coinErr, stakeStr);
        return;
      }
      const inrStake = slipStakeInr(s, stakeStr, currency);
      const err = prevalidateBet({
        bv,
        stake: inrStake,
        odds,
        originalOdds: s.kind === 'line' ? odds : bv.odds,
        isUserModifiedOdds: isEdited,
        match: matchInfo,
        markets: live,
        signedIn,
      });
      // A cashout's hedge stake is solved, not chosen: TENEXCH holds it to no minimum.
      if (err && !(bv.is_cashout && err.code === 'BELOW_MIN' && Number(inrStake) > 0)) {
        reject(token, err.message, stakeStr);
        return;
      }
      // Racing: only in the last 5 minutes before the off (the server says the same).
      if (!isRaceBettingOpen(sid, matchInfo.stime)) {
        reject(token, RACE_WINDOW_TOAST, stakeStr);
        return;
      }
      const key = betMarketKey(bv);
      if (!beginBetSubmit(key)) {
        reject(token, BET_TOAST.MULTIPLE_BET_NOT_ALLOWED, stakeStr);
        return;
      }
      const { payload, clientRef } = buildPlaceRequest({ bv, odds, stake: inrStake, isEdited, selectedOdds: bv.odds });
      setError(null);
      setLoading(true);
      try {
        let seconds = 0;
        try {
          seconds = await getSportsBufferSeconds(
            sid,
            { gtype: bv.gtype, mname: bv.mname, leagueName: matchInfo.cname },
            { allowGlobalFallback: Boolean(payload.server_buffer?.live_tracked) },
          );
        } catch {
          seconds = 0;
        }
        if (aliveRef.current && token === tokenRef.current) setDelaySeconds(seconds);
        savePendingBet(clientRef);
        await placeBet(payload);
        clearPendingBet(clientRef);
        // TENEXCH order: the slip closes first, then the toast.
        if (aliveRef.current && token === tokenRef.current) {
          tokenRef.current += 1;
          setSlip(null);
          setStake('');
          setError(null);
        }
        keptStakeRef.current = '';
        toast.success(BET_TOAST.BET_PLACED);
        announceBetPlaced();
      } catch (e) {
        // A network failure or a 409 (still deciding) may still book server-side — keep the ref so
        // reconcilePendingBets reports it on the next load.
        const keepPending = e?.pending || e?.code === 'NETWORK' || e?.status === 0;
        if (!keepPending) clearPendingBet(clientRef);
        reject(token, errorText(e), stakeStr);
      } finally {
        endBetSubmit(key);
        if (aliveRef.current) setLoading(false);
      }
    },
    [getMarkets, matchInfo, signedIn, sid, reject, currency, book],
  );

  /**
   * A price cell was clicked.
   * @param {object} spec { market, section, betType, odds, size, kind, rowId, kitSel, extra? }
   * @param {number} [oneClickStake]  > 0 → place at once with this stake
   */
  const open = React.useCallback(
    (spec, oneClickStake = 0) => {
      if (loading) return;
      if (!(Number(spec.odds) > 0)) return;
      const bv = {
        ...buildBetValue({
          market: spec.market,
          section: spec.section,
          betType: spec.betType,
          odds: spec.odds,
          size: spec.size,
          match: matchInfo,
          sid,
        }),
        fancy_name: spec.section?.nat || '',
        ...(spec.extra || {}),
      };
      tokenRef.current += 1;
      const next = {
        bv,
        kind: spec.kind,
        mid: spec.market.mid,
        rowId: spec.rowId,
        kitSel: spec.kitSel,
        display: String(spec.odds),
        modified: false,
        fieldMode: getOddsFieldMode(lc(bv.gtype), bv.mname),
      };
      setSlip(next);
      setError(null);
      setLoading(false);
      if (oneClickStake > 0) {
        const s = String(oneClickStake);
        setStake(s);
        submit(next, s);
      } else {
        setStake(keptStakeRef.current);
      }
    },
    [loading, matchInfo, sid, submit],
  );

  /** Cashout: never one-click; opens the hedge prefilled. Returns an error string or null. */
  const openCashout = React.useCallback(
    (market, book) => {
      if (loading) return null;
      const res = computeCashoutClick({
        market,
        marketType: market.mname,
        matchExposures: book,
        matchId: gmid,
        eventName: matchInfo.ename,
      });
      if (res.error) return res.error;
      const c = res.betValue;
      const section = (market.section || []).find((s) => String(s.sid) === String(c.selectionId)) || {};
      const base = buildBetValue({ market, section, betType: c.betType, odds: c.odds, size: c.size, match: matchInfo, sid });
      const bv = { ...base, ...c, sid: base.sid, sports: base.sports, league_name: base.league_name,
        match_title: base.match_title, match_start_time: base.match_start_time, game_type: base.game_type,
        min: undefined, max: base.max };
      tokenRef.current += 1;
      // The hedge is solved in INR (the book is INR); shown in the player's coin.
      const shown = c.cashoutStake == null ? '' : currency.isInr ? String(c.cashoutStake) : String(currency.fromInr(c.cashoutStake));
      setSlip({
        bv,
        kind: 'runner',
        mid: market.mid,
        rowId: section.sid,
        kitSel: { runnerId: section.sid, side: c.betType, level: 0 },
        display: String(c.odds),
        modified: false,
        fieldMode: ODDS_FIELD.TEXT,
        cashoutInr: c.cashoutStake ?? null,
        cashoutShown: shown,
      });
      setStake(shown);
      setError(null);
      return null;
    },
    [loading, gmid, matchInfo, sid, currency],
  );

  const setPrice = React.useCallback((v) => {
    setSlip((s) => (s ? { ...s, display: String(v), modified: true } : s));
  }, []);

  const stepPrice = React.useCallback(
    (price, dir) => {
      const own = slip && (namesOwnLine(slip.bv.gtype, slip.bv.marketType, slip.bv.mname) || slip.kind === 'line');
      return Number(own ? stepKhadoLine(String(price), dir) : stepOdds(String(price), dir));
    },
    [slip],
  );

  const place = React.useCallback(() => submit(slip, stake), [submit, slip, stake]);

  return {
    slip,
    stake,
    setStake: (v) => {
      setError(null);
      setStake(v);
    },
    loading,
    error,
    delaySeconds,
    open,
    openCashout,
    setPrice,
    stepPrice,
    place,
    close,
  };
}
