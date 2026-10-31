'use strict';

/**
 * Server-side bet guard.
 *
 * Copied VERBATIM out of `legacy/sportsmain/helper/oddsGuard.js`. The one
 * change is where the cached book comes from: legacy called
 * `getCommonData('oddsData:<gmid>')` on the shared Redis middleware, and this
 * takes the same key off the container's cache, which the `feed:odds` job
 * writes every two seconds with a 5s TTL (`feed.jobs.js` — `ODDS_KEY`,
 * `JSON.stringify(markets)`). Same key, same payload, same TTL.
 *
 * Payload shape (array of markets):
 *   { gmid, mid, mname, gtype, status: 'OPEN'|'SUSPENDED'|...,
 *     section: [ { sid, nat, gstatus, min, max,
 *                  odds: [ { odds, size, oname: 'back1', otype: 'back' }, ... ] } ] }
 *
 * @legacy legacy/sportsmain/helper/oddsGuard.js
 */

// Anything not in here is treated as not bettable (SUSPENDED, CLOSED,
// 'Ball Running', 'Starting Soon.', ...).
const OPEN_STATUSES = new Set(['OPEN', 'ACTIVE', '']);

// Absolute tolerance for float noise only — not a price band.
const ODDS_EPSILON = Number(process.env.BET_GUARD_ODDS_EPSILON || 0.001);

// How stale a cached payload may be before we refuse the bet. The cron writes
// with a 5s TTL, so a miss already means stale; this is just the fail mode.
const ALLOW_ON_CACHE_MISS = String(process.env.BET_GUARD_ALLOW_ON_MISS || 'false') === 'true';

const isOpen = (s) => OPEN_STATUSES.has(String(s ?? '').trim().toUpperCase());

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** back / lay side the bet resolves to. Fancy yes/no ride the back/lay rows. */
function sideOf(betType) {
  const bt = norm(betType);
  if (bt === 'back' || bt === 'yes') return 'back';
  if (bt === 'lay' || bt === 'no') return 'lay';
  return null;
}

/** First (best) price row for a side: back1/lay1 before back2/lay2. */
function bestPrice(section, side) {
  const rows = (section?.odds || [])
    .filter((o) => norm(o.otype) === side)
    .sort((a, b) => norm(a.oname).localeCompare(norm(b.oname)));
  return rows[0] || null;
}

function findMarket(markets, { market_id, mname, gtype }) {
  const byMid = markets.find((m) => String(m.mid) === String(market_id));
  if (byMid) return byMid;
  // marketId is occasionally absent on older clients — fall back to name+type.
  return markets.find((m) => norm(m.mname) === norm(mname) && norm(m.gtype) === norm(gtype)) || null;
}

function findSection(market, { selection_sid, selection_name }) {
  const sections = market?.section || [];
  if (selection_sid != null && selection_sid !== '') {
    const bySid = sections.find((s) => String(s.sid) === String(selection_sid));
    if (bySid) return bySid;
  }
  return sections.find((s) => norm(s.nat) === norm(selection_name)) || null;
}

const reject = (code, message, extra) => ({ ok: false, code, message, ...extra });

/**
 * Validate a bet against the live cached odds.
 *
 * @param {object} bet
 * @param {string|number} bet.gmid            game id (payload `eventid`)
 * @param {string|number} bet.market_id       market `mid`
 * @param {string} bet.mname                  market name (fallback match)
 * @param {string} bet.gtype                  market type (fallback match)
 * @param {string|number} [bet.selection_sid] section `sid`
 * @param {string} bet.selection_name         section `nat`
 * @param {string} bet.bet_type               back | lay | yes | no
 * @param {number} bet.odds                   odds the client submitted
 * @param {number} [bet.size]                 fancy run line the client submitted
 * @param {boolean} [bet.allowWorseOdds]      accept prices that moved in the
 *                                            book's favour (unmatched bets)
 * @param {object} deps
 * @param {{get(key: string): Promise<string|null>}} deps.cache
 * @param {object} [deps.logger]
 * @returns {Promise<{ok: true, live: object} | {ok: false, code: string, message: string}>}
 */
async function verifyBetAgainstLiveOdds(bet, { cache, logger } = {}) {
  const {
    gmid, market_id, mname, gtype,
    selection_sid, selection_name,
    bet_type, odds, size,
    allowWorseOdds = false,
  } = bet;

  if (!gmid) return reject('MISSING_GMID', 'Market not identified.');

  const side = sideOf(bet_type);
  if (!side) return reject('BAD_BET_TYPE', `Unsupported bet type: ${bet_type}`);

  const submitted = num(odds);
  if (submitted === null) return reject('BAD_ODDS', 'Invalid odds.');

  let raw;
  try {
    raw = await cache.get(`oddsData:${gmid}`);
  } catch (err) {
    logger?.error({ err: err.message, gmid }, '[betGuard] cache read failed');
    raw = null;
  }

  if (!raw) {
    if (ALLOW_ON_CACHE_MISS) {
      logger?.warn({ gmid }, '[betGuard] no cached odds, allowing by config');
      return { ok: true, live: null, skipped: 'CACHE_MISS' };
    }
    return reject('ODDS_UNAVAILABLE', 'Odds are not available right now. Please try again.');
  }

  let markets;
  try {
    // The memory fallback stores the value as handed to it, Redis as a string —
    // `JSON.parse` only when it is still text.
    markets = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return reject('ODDS_UNAVAILABLE', 'Odds are not available right now. Please try again.');
  }
  if (!Array.isArray(markets) || markets.length === 0) {
    return reject('ODDS_UNAVAILABLE', 'Odds are not available right now. Please try again.');
  }

  const market = findMarket(markets, { market_id, mname, gtype });
  if (!market) return reject('MARKET_NOT_FOUND', 'Market is no longer available.');

  if (!isOpen(market.status)) {
    return reject('MARKET_SUSPENDED', 'Market is suspended.', { status: market.status });
  }

  const section = findSection(market, { selection_sid, selection_name });
  if (!section) return reject('SELECTION_NOT_FOUND', 'Selection is no longer available.');

  if (!isOpen(section.gstatus)) {
    return reject('SELECTION_SUSPENDED', 'Market is suspended.', { status: section.gstatus });
  }

  const price = bestPrice(section, side);
  const liveOdds = num(price?.odds);
  if (liveOdds === null || liveOdds <= 0) {
    return reject('NO_PRICE', 'Market is suspended.');
  }

  // Fancy only: the run line must match too, otherwise the same rate settles
  // against a different line. On match/bookmaker markets `size` is matched
  // volume, which churns constantly and must not gate the bet.
  const isFancyMarket = norm(market.gtype).startsWith('fancy');
  if (isFancyMarket && size != null && size !== '' && Number(size) !== 0) {
    const liveSize = num(price.size);
    if (liveSize !== null && liveSize !== 0 && Number(size) !== liveSize) {
      return reject('LINE_CHANGED', 'Odds have changed. Please try again.', {
        liveOdds, liveSize,
      });
    }
  }

  const delta = submitted - liveOdds;
  if (Math.abs(delta) > ODDS_EPSILON) {
    // A back below the live price, or a lay above it, is worse for the punter
    // and safe for the book — that is the unmatched-bet case.
    const inBookFavour = side === 'back' ? delta < 0 : delta > 0;
    if (!(allowWorseOdds && inBookFavour)) {
      return reject('ODDS_CHANGED', 'Odds have changed. Please try again.', {
        liveOdds, submittedOdds: submitted,
      });
    }
  }

  return {
    ok: true,
    live: {
      mid: market.mid,
      mname: market.mname,
      gtype: market.gtype,
      status: market.status,
      sid: section.sid,
      nat: section.nat,
      gstatus: section.gstatus,
      odds: liveOdds,
      size: num(price.size),
      min: num(section.min),
      max: num(section.max),
    },
  };
}

module.exports = { verifyBetAgainstLiveOdds };
