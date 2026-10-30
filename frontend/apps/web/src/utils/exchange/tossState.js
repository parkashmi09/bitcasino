/* Ported from TENEXCH frontend/src/utils/tossState.js, unchanged. TENEXCH (no Addaplay equivalent). */

// ─── Has the toss happened? ──────────────────────────────────────────────────
// The feed carries NO toss field. Nothing in `all-data`,
// `/user/v1/sports-gamedetailPrivate` or the score socket says it
// (checked 2026-09-12: their only state fields are iplay / gscode / status /
// scard / gtv / iscc, and the score payload is spnnation*/score*/runrate*/
// spnmessage/activenation*/balls/isfinished/dayno).
//
// So the toss is read off the SHAPE of the market list from
// `POST /user/cricket/get-match-private-data`, which is the only place it shows:
//
//   BEFORE the toss  the `fancy1` market carries "<TEAM> Will Win Toss" rows
//                    with a live price, and advance fancy is written for BOTH
//                    sides ("6 over run GAW W adv" AND "6 over run TKR W adv")
//                    — nobody knows yet who bats first.
//   AFTER the toss   those toss rows are gone, first-innings fancy names ONE
//                    side only ("6 over run TKR adv", "1.3 over run TKR"), and
//                    Over By Over / Ball By Ball markets appear.
//
// Measured on 2026-09-12 (CPL GAW v TKR, gmid 500320709, 15 min before its
// 4:30 AM start): no fancy1, 17 markets, Over By Over + Ball By Ball present,
// 3 "adv" rows all naming TKR, 0 naming GAW → toss done, TKR batting first.
// Control, same minute: 7 upcoming matches (3:00 PM … next day) all had 2 live
// toss rows → pending.
//
// Why the extra conditions and not just "no toss rows": a stale fixture
// (England v Pakistan dated 9 Sept), a junk row (dated 2020) and the e-cricket
// "(e)" matches also carry no fancy1, with 1–4 markets and no Over By Over /
// adv rows. On those the naive check answered "toss done". Verified: the rule
// below answers false for all four.
//
// It reports the toss, NOT the start of play: a match can be past its toss with
// `iplay` still false (that is exactly the 500320709 case above).

const TOSS_ROW_RE = /will\s+win\s+toss/i;
const OVER_BY_OVER_RE = /over\s+by\s+over|ball\s+by\s+ball/i;

// "6 over run TKR adv" → "TKR" · "20 over Khado run TKR adv - 30" → "TKR"
// "6 over run GAW W adv" → "GAW W" · "20 over run TKR 2 adv" → "TKR"
// "6 over run bhav TKR adv" → "TKR"
// The trailing digit is a market variant ("TKR 2 adv"), not part of the name,
// and `bhav` marks the rate-style twin of the same line — both must be skipped
// or the row contributes a second, bogus "BHAV TKR" name and the side reads as
// unknown. (Seen live 04:39 on gmid 500320709, which quotes both variants.)
const ADV_ROW_RE = /^(?:only\s+)?[\d.]+\s*over\s+(?:khado\s+)?run\s+(?:bhav\s+)?(.+?)\s*(?:\d+\s*)?adv\b/i;

const rowsOf = (market) => (Array.isArray(market?.section) ? market.section : []);
const nameOf = (row) => String(row?.nat ?? '').trim();
const hasLivePrice = (row) =>
  (Array.isArray(row?.odds) ? row.odds : []).some((o) => Number(o?.odds) > 0);

/** Live "<TEAM> Will Win Toss" rows — the toss market is still on offer. */
export function tossMarketRows(markets) {
  return (Array.isArray(markets) ? markets : [])
    .flatMap(rowsOf)
    .filter((row) => TOSS_ROW_RE.test(nameOf(row)));
}

/**
 * The side batting first, as the feed's own short name ("TKR"), or null.
 *
 * Read from the advance-fancy rows: after the toss every first-innings row
 * names the batting side, so one distinct name means it is settled. Two (the
 * pre-toss state, both sides quoted) or none means unknown.
 */
export function battingFirstSide(markets) {
  const names = new Set();
  for (const market of (Array.isArray(markets) ? markets : [])) {
    for (const row of rowsOf(market)) {
      const m = ADV_ROW_RE.exec(nameOf(row));
      if (m) names.add(m[1].trim().toUpperCase());
    }
  }
  return names.size === 1 ? [...names][0] : null;
}

/**
 * Has the toss happened for this cricket match?
 *
 * @param {Array} markets  the market list from get-match-private-data
 * @returns {boolean} true only when the feed positively shows a post-toss shape
 */
export function isTossDone(markets) {
  const list = Array.isArray(markets) ? markets : [];
  if (list.length === 0) return false;                    // nothing to read yet

  // The toss market is still priced → not yet.
  if (tossMarketRows(list).some(hasLivePrice)) return false;

  // Post-toss shape: per-over / per-ball markets exist, or the first-innings
  // fancy has settled on one side.
  const hasBallMarkets = list.some((m) => OVER_BY_OVER_RE.test(String(m?.mname ?? '')));
  return hasBallMarkets || battingFirstSide(list) !== null;
}

export default { isTossDone, tossMarketRows, battingFirstSide };
