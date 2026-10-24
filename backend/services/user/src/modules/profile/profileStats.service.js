'use strict';

const { money, ServiceUnavailableError } = require('@ibitplay/common');

/**
 * `GET /user/profile/stats`: the caller's own lifetime play, for the profile
 * page's Statistics and Favourites cells.
 *
 * ── WHERE THE NUMBERS COME FROM ──────────────────────────────────────────
 *
 * casino-service  `/internal/casino/bet-history/player/:id/profile-stats`
 *                 stakes, wins, biggest payout and top games per currency,
 *                 across in-house `bets`, Slotegrator, jsGames v1 and v2.
 * sports-service  `/internal/sports/wager/player/:id/profile-stats`
 *                 settled sports bets per currency, with the stake-time USD.
 *
 * user-service owns `exchangerate`, so the conversion to USD happens here,
 * the same split the wagering race uses. A currency with no rate stays in the
 * per-currency list and is NAMED in `wagered.unrated` rather than counted at a
 * guessed rate of 1.
 *
 * ── WAGERED IS NOT A PROMOTION ───────────────────────────────────────────
 *
 * It is the player's own play, so this route has no `denyAgentPlayer`: an
 * agent-tree player sees their turnover like anyone else. Nothing here is VIP.
 *
 * ── CACHE ────────────────────────────────────────────────────────────────
 *
 * 60 s per player, in this process: the page is read far more often than a
 * player's lifetime totals move in a way they would notice, and concurrent
 * reads of the same player share one in-flight computation. A partial answer
 * (one source down) is never cached, so the next read retries it.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;
const USD_LIKE = new Set(['USD', 'USDT', 'USDC']);
const SPORTS_PROVIDER = 'Sports';

const ZERO = '0';
const dec = (minor) => money.toDecimalString(minor);
const minor = (v) => money.toMinorQuantised(String(v ?? '0'));

class ProfileStatsService {
  constructor({ models, clients, logger, now = () => Date.now() }) {
    this.models = models;
    this.clients = clients;
    this.logger = logger;
    this.now = now;
    /** userId → { at, value } */
    this.cache = new Map();
    /** userId → Promise, so a burst of reads computes once. */
    this.pending = new Map();
  }

  async forPlayer(userId) {
    const key = String(userId);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < TTL_MS) return hit.value;

    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.#compute(key).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  async #compute(userId) {
    const [casino, sports, rates] = await Promise.allSettled([
      this.clients.casino.get(`/internal/casino/bet-history/player/${userId}/profile-stats`),
      this.clients.sports.get(`/internal/sports/wager/player/${userId}/profile-stats`),
      this.#usdRates(),
    ]);

    const unavailable = [];
    if (casino.status === 'rejected') {
      unavailable.push('casino');
      this.logger?.warn({ err: casino.reason, userId }, 'profile stats: casino source unavailable');
    }
    if (sports.status === 'rejected') {
      unavailable.push('sports');
      this.logger?.warn({ err: sports.reason, userId }, 'profile stats: sports source unavailable');
    }
    if (unavailable.length === 2) {
      throw new ServiceUnavailableError('Betting statistics are unavailable right now', { sources: unavailable });
    }

    const value = buildProfileStats({
      casino: casino.status === 'fulfilled' ? casino.value : null,
      sports: sports.status === 'fulfilled' ? sports.value : null,
      rates: rates.status === 'fulfilled' ? rates.value : new Map(),
      asOf: new Date(this.now()).toISOString(),
    });
    value.unavailable = unavailable;

    if (!unavailable.length && rates.status === 'fulfilled') {
      if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(userId, { at: this.now(), value });
    }
    return value;
  }

  /** `usd_rate` is USD per one unit of the currency. */
  async #usdRates() {
    const rows = await this.models.Exchangerate.findAll({ attributes: ['currency', 'usd_rate'], raw: true });
    const rates = new Map();
    for (const row of rows) {
      const rate = Number(row.usd_rate);
      if (Number.isFinite(rate) && rate > 0) rates.set(String(row.currency).toUpperCase(), String(row.usd_rate));
    }
    return rates;
  }
}

/** USD minor units, or null when the currency has no rate. */
function toUsd(amount, currency, rates) {
  const code = String(currency).toUpperCase();
  if (USD_LIKE.has(code)) return minor(amount);
  const rate = rates.get(code);
  if (!rate) return null;
  return money.multiply(dec(minor(amount)), dec(minor(rate)));
}

const earliest = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const latest = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const byUsdDesc = (a, b) => (b.usd > a.usd ? 1 : b.usd < a.usd ? -1 : b.bets - a.bets);

/**
 * Fold the two services' answers into the page's shape. Pure, for the tests.
 *
 * Money stays in BigInt minor units until the end; nothing is added as a float.
 */
function buildProfileStats({ casino, sports, rates, asOf }) {
  const currencies = new Map(); // code → { amount, usd|null, bets }
  const unrated = new Set();
  const sections = {
    casino: { bets: 0, wins: 0, usd: 0n },
    sports: { bets: 0, wins: 0, usd: 0n },
  };
  let firstBetAt = null;
  let lastBetAt = null;
  /* Net result (payouts - stakes) over casino-service's rows, in USD; a currency
     with no rate is left out, as everywhere here. Read by the profile medals
     (Chicken Dinner). Sports-service reports stakes but not returns, so its
     bets are not in it. */
  let casinoNetUsd = 0n;

  const addCurrency = (code, amount, usd, bets) => {
    const entry = currencies.get(code) ?? { amount: 0n, usd: 0n, rated: true, bets: 0 };
    entry.amount += minor(amount);
    entry.bets += bets;
    if (usd === null) {
      entry.rated = false;
      unrated.add(code);
    } else entry.usd += usd;
    currencies.set(code, entry);
  };

  for (const row of casino?.byCurrency ?? []) {
    const usd = toUsd(row.wagered, row.currency, rates);
    addCurrency(row.currency, row.wagered, usd, row.bets);
    if (row.won !== undefined) {
      const wonUsd = toUsd(row.won, row.currency, rates);
      if (usd !== null && wonUsd !== null) casinoNetUsd += wonUsd - usd;
    }
    const section = sections[row.section === 'sports' ? 'sports' : 'casino'];
    section.bets += row.bets;
    section.wins += row.wins;
    if (usd !== null) section.usd += usd;
    firstBetAt = earliest(firstBetAt, row.firstAt);
    lastBetAt = latest(lastBetAt, row.lastAt);
  }

  for (const row of sports?.byCurrency ?? []) {
    // Priced when the stake was risked; never re-priced at today's rate.
    const usd = minor(row.usd);
    addCurrency(row.currency, row.wagered, usd, row.bets);
    sections.sports.bets += row.bets;
    sections.sports.wins += row.wins;
    sections.sports.usd += usd;
    firstBetAt = earliest(firstBetAt, row.firstAt);
    lastBetAt = latest(lastBetAt, row.lastAt);
  }

  const bets = sections.casino.bets + sections.sports.bets;
  const wins = sections.casino.wins + sections.sports.wins;
  const totalUsd = sections.casino.usd + sections.sports.usd;

  // Biggest single payout, compared in USD; a currency with no rate can only
  // win when nothing priced exists.
  let biggestWin = null;
  for (const w of casino?.biggestWins ?? []) {
    const usd = toUsd(w.amount, w.currency, rates);
    const candidate = { amount: w.amount, currency: w.currency, usd, game: w.game ?? null, at: w.at ?? null };
    if (!biggestWin) biggestWin = candidate;
    else if (usd !== null && (biggestWin.usd === null || usd > biggestWin.usd)) biggestWin = candidate;
  }

  // Games: the same game in several currencies is one game.
  const games = new Map();
  for (const g of casino?.games ?? []) {
    const usd = toUsd(g.wagered, g.currency, rates);
    if (usd === null) continue;
    const entry = games.get(g.key) ?? { key: g.key, name: g.name, provider: g.provider ?? null, usd: 0n, bets: 0 };
    entry.usd += usd;
    entry.bets += g.bets;
    games.set(g.key, entry);
  }
  const rankedGames = [...games.values()].sort(byUsdDesc);

  const providers = new Map();
  for (const g of rankedGames) {
    if (!g.provider) continue;
    const entry = providers.get(g.provider) ?? { name: g.provider, usd: 0n, bets: 0 };
    entry.usd += g.usd;
    entry.bets += g.bets;
    providers.set(g.provider, entry);
  }
  if (sections.sports.bets > 0) {
    providers.set(SPORTS_PROVIDER, { name: SPORTS_PROVIDER, usd: sections.sports.usd, bets: sections.sports.bets });
  }

  return {
    asOf,
    bets,
    wins,
    // Two places, as a string; null before the first bet rather than "0.00".
    winRate: bets > 0 ? (Math.min(100, (wins / bets) * 100)).toFixed(2) : null,
    wagered: {
      usd: dec(totalUsd),
      byCurrency: [...currencies.entries()]
        .map(([currency, e]) => ({ currency, amount: dec(e.amount), usd: e.rated ? dec(e.usd) : null, bets: e.bets, _usd: e.usd }))
        .sort((a, b) => (b._usd > a._usd ? 1 : b._usd < a._usd ? -1 : b.bets - a.bets))
        .map(({ _usd, ...rest }) => rest),
      unrated: [...unrated].sort(),
    },
    sections: {
      casino: { bets: sections.casino.bets, wins: sections.casino.wins, wageredUsd: dec(sections.casino.usd) },
      sports: { bets: sections.sports.bets, wins: sections.sports.wins, wageredUsd: dec(sections.sports.usd) },
    },
    biggestWin: biggestWin && { ...biggestWin, usd: biggestWin.usd === null ? null : dec(biggestWin.usd) },
    // `key` is casino-service's `<source>:<game id>`, so a client can link the game.
    favouriteGames: rankedGames.slice(0, 3).map((g) => ({ key: g.key, name: g.name, provider: g.provider, wageredUsd: dec(g.usd), bets: g.bets })),
    favouriteProviders: [...providers.values()].sort(byUsdDesc).slice(0, 3)
      .map((p) => ({ name: p.name, wageredUsd: dec(p.usd), bets: p.bets })),
    firstBetAt,
    lastBetAt,
    casinoNetUsd: dec(casinoNetUsd),
    /* Best in-house round's payout / stake, or null. */
    maxMultiplier: casino?.maxMultiplier ?? null,
  };
}

module.exports = { ProfileStatsService, buildProfileStats, TTL_MS, ZERO };
