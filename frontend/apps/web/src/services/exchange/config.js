/* Ported from TENEXCH frontend/src/apiservices/bettingConfig.js — sports half only (the casino
 * buffers/limits are dropped: this site's casino is not mssports). TENEXCH (no Addaplay equivalent
 * for this config shape). `GET /betting-config` answers WITHOUT a `data` envelope:
 *   { success, buffers:{global, grid, sports}, max_odds, virtual_limits, leagues }
 * Shape returned by getBettingConfig():
 *   { buffers:{ global:number, grid:object|null, sports:object, casino:object },
 *     casino_limits:{}, max_odds:{ [sid]: {name, match_odds:{max,limited_overs_only}, bookmaker, leagues} },
 *     virtual_limits:{ [sid]: { [leagueKey]: {min,max} } }, leagues:{ [sid]: [{key, patterns[]}] } } */
// ─── Owner-set betting config (buffer seconds, min/max stake, max odds) ──────
//
// GET /user/betting-config returns the WHOLE map in one response — every
// sport's buffer, every casino game's buffer, every casino limit override and
// every sport's max-odds cap.
// It is fetched lazily on first use and cached in module memory for a minute,
// so the owner can retune from the admin panel without a frontend redeploy and
// without the panel calling the API per bet. The server serves it from Redis,
// so many players asking at once still cost one DB read per TTL.
//
// Per-event sports limits are NOT in this payload (they would grow without
// bound) — useMatchData fetches them per event; see eventLimits.js.
//
// Every failure path returns "nothing configured", which makes the callers
// fall back to their env defaults / the feed's own limits — i.e. exactly the
// behaviour that existed before this feature.
//
// Sports buffer and max odds are keyed by LEAGUE too (admin Settings → Buffer
// Time / Max Odds, same tabs as Commission): cricket's E-Cricket (Dim), T10 XI,
// T5 XI and Virtual Cricket League have their own rows. A league cell the owner
// left on Inherit follows the sport's main row.

import { exchangeRequest, POLL_TIMEOUT_MS } from './api';

const TTL_MS = 60 * 1000;

const DEFAULT_LEAGUE_KEY = 'default';

// grid: null = the server predates the league grid; the 3-bucket `sports` map
// is used instead.
const EMPTY = {
  buffers: { global: 0, grid: null, sports: {}, casino: {} },
  casino_limits: {},
  max_odds: {},
  virtual_limits: {},
  leagues: {},
};

let cached = null;
let fetchedAt = 0;
let inFlight = null; // de-dupes the burst of callers on first load

export async function getBettingConfig() {
  const now = Date.now();
  if (cached && now - fetchedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const data = await exchangeRequest('/betting-config', { timeout: POLL_TIMEOUT_MS });
      cached = {
        buffers: {
          global: Number(data?.buffers?.global) || 0,
          grid: data?.buffers?.grid || null,
          sports: data?.buffers?.sports || {},
          casino: data?.buffers?.casino || {},
        },
        casino_limits: data?.casino_limits || {},
        max_odds: data?.max_odds || {},
        virtual_limits: data?.virtual_limits || {},
        leagues: data?.leagues || {},
      };
    } catch {
      cached = EMPTY;
    }
    fetchedAt = Date.now();
    inFlight = null;
    return cached;
  })();

  return inFlight;
}

// Same normalisation as server constants/commissionLeagues.js
// normaliseLeagueName: "Dim Cricket League (1 over)" → "dim cricket league 1 over".
const normaliseLeagueName = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Feed league name (cname) → the grid's league key for this sport. The patterns
// arrive with the config payload (built from the server's own list), so the
// slip and the server always agree. Unknown / empty → 'default'.
export function leagueKeyOf(config, sportId, leagueName) {
  const norm = normaliseLeagueName(leagueName);
  if (!norm) return DEFAULT_LEAGUE_KEY;
  for (const league of config?.leagues?.[String(sportId)] || []) {
    if ((league.patterns || []).some((p) => norm.includes(p))) return league.key;
  }
  return DEFAULT_LEAGUE_KEY;
}

// gtype (feed) → the pre-2026-09-15 buffer category. Only used against a server
// that still serves the 3-bucket map.
export function bufferCategoryOf(gtype) {
  const g = String(gtype || '').toLowerCase();
  if (g === 'match') return 'match_odds';
  if (g === 'match1') return 'bookmaker';
  return 'fancy';
}

const DIRECT_MARKET_GTYPES = new Set([
  'fancy', 'fancy1', 'fancy2', 'oddeven', 'khado', 'meter', 'badlo', 'cricketcasino',
]);
// The slip falls back to game_type when a market has no gtype.
const GAME_TYPE_ALIASES = { mo: 'match', bm: 'match1', bookmaker: 'match1', fan: 'fancy' };

// Buffer grid market key — mirror of server CommissionConfig.marketKeyOfBet():
// gtype 'match' splits on the market NAME (only "Match Odds" is matchodds,
// Over/Under, Correct Score… are match_other), 'match1' into bookmaker /
// match1_other, the fancy family maps one-for-one, a badlo slip is 'badlo',
// anything else 'other'.
export function bufferMarketKeyOf({ gtype, mname, badlo } = {}) {
  if (badlo === true || String(badlo) === 'true') return 'badlo';
  let g = String(gtype || '').toLowerCase().trim();
  g = GAME_TYPE_ALIASES[g] || g;
  const name = String(mname || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (g === 'match') return name === 'MATCHODDS' ? 'matchodds' : 'match_other';
  if (g === 'match1') return name.startsWith('BOOKMAKER') ? 'bookmaker' : 'match1_other';
  if (DIRECT_MARKET_GTYPES.has(g)) return g;
  return 'other';
}

// Buffer seconds for one sports market. `market` is
// { gtype, mname, badlo, leagueName } (a bare gtype string still works).
//
// Precedence: the league's own cell (T10 XI, Dim…) → the sport's main cell (a
// league cell on Inherit) → with `allowGlobalFallback`, the platform-wide
// buffer_time → 0 (caller uses its env default).
//
// `allowGlobalFallback` is TRUE only for live-tracked markets (Match Odds /
// Bookmaker), because those are the only ones that honoured that number before
// this feature existed. Fancy never did — giving it the global fallback would
// silently change the fancy buffer on every site that has buffer_time set, so
// an unconfigured fancy market deliberately keeps its env default.
export async function getSportsBufferSeconds(sportId, market = {}, { allowGlobalFallback = false } = {}) {
  const m = typeof market === 'string' ? { gtype: market } : (market || {});
  const config = await getBettingConfig();
  const sid = String(sportId);
  const grid = config?.buffers?.grid;

  let seconds;
  if (grid) {
    const sport = grid[sid] || {};
    const marketKey = bufferMarketKeyOf(m);
    const leagueKey = leagueKeyOf(config, sid, m.leagueName);
    const own = leagueKey !== DEFAULT_LEAGUE_KEY ? sport[leagueKey]?.[marketKey] : undefined;
    seconds = Number(own !== undefined ? own : sport[DEFAULT_LEAGUE_KEY]?.[marketKey]) || 0;
  } else {
    seconds = Number(config?.buffers?.sports?.[sid]?.[bufferCategoryOf(m.gtype)]) || 0;
  }

  if (seconds > 0) return seconds;
  return allowGlobalFallback ? (Number(config?.buffers?.global) || 0) : 0;
}

// gtype (feed) → max-odds category, or null for markets that are never capped
// (the fancy family — their "rate" is a run line). Same rule as
// MaxOddsConfig.categoryFromGtype() on the server, plus 'fancy3': those
// under/over outcome markets are POSTed as gtype 'match' (betHelpers
// prepareBetPayload), so the server caps them as Match Odds.
function maxOddsCategoryOf(gtype) {
  const g = String(gtype || '').toLowerCase();
  if (g === 'match' || g === 'fancy3') return 'match_odds';
  if (g === 'match1') return 'bookmaker';
  return null;
}

// Owner-set max rate for one sports market (admin Settings → Max Odds):
// { max, sport, limitedOversOnly }, or null when no cap applies. `leagueName`
// (the feed cname) picks a league tab's own cell; a league cell on Inherit
// follows the sport's. The server re-checks every bet, so a stale/failed
// config only loses the early toast.
export async function getSportsMaxOddsRule(sportId, gtype, leagueName) {
  const category = maxOddsCategoryOf(gtype);
  if (!category) return null;
  const config = await getBettingConfig();
  const entry = config?.max_odds?.[String(sportId)];
  if (!entry) return null;
  const leagueKey = leagueKeyOf(config, sportId, leagueName);
  const own = leagueKey !== DEFAULT_LEAGUE_KEY ? entry.leagues?.[leagueKey]?.[category] : undefined;
  const cell = own !== undefined ? own : entry[category];
  const max = Number(cell?.max) || 0;
  if (max <= 0) return null;
  return {
    max,
    sport: entry.name || `Sport ${sportId}`,
    limitedOversOnly: !!cell?.limited_overs_only,
  };
}

// Owner-set stake limits for a VIRTUAL league (admin Settings → Virtual Bet
// Limits: Dim / T5 XI / T10 XI / VCL / WWE Virtual): { min, max } with 0 =
// not set, or null for a real match. Sync — reads the module cache, so it is
// null until the config has been fetched once (the virtual page fetches it on
// mount). Mirror of server BettingConfigService.getVirtualLimit(); the server
// re-checks every bet.
export function peekVirtualLimit(sportId, leagueName) {
  if (!cached) return null;
  const key = leagueKeyOf(cached, sportId, leagueName);
  if (key === DEFAULT_LEAGUE_KEY) return null;
  const cell = cached?.virtual_limits?.[String(sportId)]?.[key];
  const min = Number(cell?.min) || 0;
  const max = Number(cell?.max) || 0;
  return min > 0 || max > 0 ? { min, max } : null;
}

// Show the virtual league's limits on the market rows ("Min:… Max:…"), so the
// numbers printed are the ones enforced. fancy3 is skipped: it reuses `min` for
// the RUN LINE (Total Sixs min=1.5), which must not be overwritten.
export function applyVirtualLimits(markets, sportId, leagueName) {
  const lim = peekVirtualLimit(sportId, leagueName);
  if (!lim || !Array.isArray(markets)) return markets;
  const patch = (node) => ({
    ...node,
    ...(lim.min > 0 && node.min !== undefined ? { min: lim.min } : {}),
    ...(lim.max > 0 && node.max !== undefined ? { max: lim.max } : {}),
    ...(lim.max > 0 && Number(node.maxb) > 0 ? { maxb: lim.max } : {}),
  });
  return markets.map((m) => {
    if (String(m?.gtype || '').toLowerCase() === 'fancy3') return m;
    const out = patch(m);
    if (Array.isArray(m.section)) out.section = m.section.map(patch);
    return out;
  });
}

// Test/dev escape hatch — drops the memory cache so the next read refetches.
export function resetBettingConfigCache() {
  cached = null;
  fetchedAt = 0;
  inFlight = null;
}
