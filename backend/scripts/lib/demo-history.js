'use strict';

/**
 * `--history [days]` — the demo cast's PAST, so the admin charts have a curve.
 *
 * The demo datasets move money at seed time, so every chart (deposits, GGR,
 * registrations, wagers by provider…) is one spike on today. This generates N
 * days (default 90, max 365) of believable activity for the demo players and
 * then moves it to the dates it "happened" on.
 *
 * ── HOW ──────────────────────────────────────────────────────────────────
 *
 * 1. PLAN. A seeded PRNG (`--history-seed`, default 7) draws the whole period
 *    up front: extra history players `demo_h001…` signing up along a growing
 *    curve, and per active day a session of deposits (fiat and crypto, every
 *    status), casino rounds across three providers and many games, sports bets
 *    with results, tips, vault in/out, bonus grants, rakeback claims,
 *    affiliate commission claims, withdrawals in every status, and a few
 *    refunds (full and partial) through `WagerActivityService.reverse`.
 *    Weekday/weekend rhythm, growth, a few promo spikes, a mix of currencies.
 *    The same seed and days give the same plan.
 *
 * 2. EXECUTE, oldest first, through the REAL services (see demo-services.js):
 *    `WalletService` for every stake/payout/refund, the fiat deposit and
 *    withdrawal services, the CCPayment webhook handler for crypto,
 *    `TipService`, `VaultService`, `PlayerBonusService`, `RakebackService`,
 *    `AffiliateService` and `WagerActivityService.record/reverse` (which run
 *    VIP, rakeback, affiliate commission and bonus wagering as for real
 *    play). The provider's own record of a round (`bets`, `game_transactions`,
 *    `gis_transactions`, `SportsBet`, `ccdeposit`) is written beside its ledger
 *    movement, the way the provider handler writes it — no provider and no
 *    external API is ever called. Each event's wall-clock window
 *    [start, end] is recorded, with the time it is meant to have happened.
 *
 * 3. BACKDATE, in one transaction at the end: every timestamp a demo player's
 *    row got INSIDE an event's window is moved back by that event's offset.
 *    Only tables keyed on a player (the reset's own `USER_KEYED` list, plus
 *    `users` and the name-keyed `team`), only rows whose owner is a `demo_`
 *    player, and only values inside a window of THIS run — a timestamp written
 *    by anyone else, or before the run, matches nothing. Because the plan runs
 *    in time order, cross-table order holds after the move: a deposit lands
 *    before the wagers it funds, a bet settles after it was placed, a
 *    withdrawal follows the deposit. Future timestamps a service sets (a bonus
 *    expiry) are left as they are.
 *    The base demo cast's signup dates move into the first fifth of the
 *    period too, so the registrations chart has no spike on today.
 *
 * ── THE VIP CAST GROWS INTO ITS CARDS ────────────────────────────────────
 *
 * Without `--history`, the base `vip` dataset puts each VIP cast player on its
 * card with ONE wager on seed day (Gold alone is $110,000 — hundreds of times a
 * history day, and its level-up credits and rakeback land on that day too).
 * With `--history` that dataset leaves the wager out and hands this plan each
 * player's target (`vip.players`): what the player still needs to reach it is
 * wagered in many rounds from its signup to the end of the window, through the
 * same wager feed and source (`demo_seed`, turnover without a bet, so no
 * wallet moves), so the VIP card, the level-up credits and the rakeback
 * accrual climb gradually. The days follow the weekday rhythm and growth but
 * not the promo spikes, and the last round is before the cutoff, so every
 * player is on its card when the run ends. The player that is documented as
 * having claimed its rakeback (`claimRakeback`) claims it after its last round.
 * A cast that already holds its target — the lump from an earlier `--demo`
 * without `--history` — gets no rounds; `lump` in the result names it, and the
 * runner says how to start clean (`--reset-demo --yes`, then `--demo --history`).
 *
 * ── IDEMPOTENCY: TAGGED, SKIPPED ─────────────────────────────────────────
 *
 * Every ledger movement this writes carries an idempotency key starting with
 * `demo-history:`. If any demo player already has one, the run SKIPS and says
 * so (with the span it found): a second `--history` never doubles anything.
 * The wallet's own key replay cannot be relied on here — it honours keys for
 * 48 hours of `created_at`, and backdating puts them outside that window. To
 * regenerate (another span or seed), `--reset-demo --yes` first; the reset
 * removes every history row, because every one of them is keyed on a demo_
 * player. If a run dies half way, the events done so far are still backdated
 * (the backdate runs in `finally`), so what is left is consistent.
 */

const crypto = require('crypto');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

const { USER_KEYED } = require('./demo-reset');

const ROOT = path.resolve(__dirname, '..', '..');
const { REASON } = require(path.join(ROOT, 'services/user/src/modules/wallet/wallet.constants'));

const DEFAULT_HISTORY_DAYS = 90;
const MAX_HISTORY_DAYS = 365;
const DEFAULT_HISTORY_SEED = 7;
const TAG = 'demo-history';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Demo traffic follows an Indian evening (IST, UTC+5:30); only the curve's shape depends on it. */
const SITE_OFFSET = 330 * MIN;

/** Relative traffic per local hour, 00…23. */
const HOUR_WEIGHTS = [3, 2, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 7, 6, 6, 7, 8, 10, 12, 13, 13, 10, 6];

/** Sunday … Saturday. */
const WEEKDAY_FACTOR = [1.3, 0.85, 0.88, 0.94, 1.0, 1.15, 1.4];

/**
 * Coins and their sizes. Amounts are drawn as floats, then snapped to `step` /
 * `depositStep` and carried as 8-dp minor units from there on.
 */
const COINS = {
  INR: { stake: 120, step: '10', depositStep: '500', minDeposit: '1000', fiat: true, withdraw: true, tip: [100, 600, '50'], usd: 0.012 },
  EUR: { stake: 2, step: '0.5', depositStep: '10', minDeposit: '20', fiat: true, withdraw: true, usd: 1.08 },
  USDT: { stake: 2, step: '0.5', depositStep: '10', minDeposit: '20', coinId: 1280, chain: 'TRC20', withdraw: true, tip: [2, 25, '1'], usd: 1 },
  BTC: { stake: 0.00004, step: '0.000005', depositStep: '0.0005', minDeposit: '0.0005', coinId: 1155, chain: 'BTC', usd: 65000 },
  ETH: { stake: 0.0007, step: '0.0001', depositStep: '0.005', minDeposit: '0.01', coinId: 1161, chain: 'ERC20', usd: 3200 },
  TRX: { stake: 18, step: '1', depositStep: '100', minDeposit: '200', coinId: 1482, chain: 'TRC20', usd: 0.12 },
};

const PRIMARY_COIN = [['INR', 55], ['USDT', 25], ['BTC', 7], ['ETH', 5], ['TRX', 4], ['EUR', 4]];

const PROFILES = {
  whale: { share: 6, active: 0.62, stakeX: 12, rounds: [8, 20], sports: 0.45, churn: 0.05, extras: 1.6 },
  regular: { share: 34, active: 0.4, stakeX: 3, rounds: [4, 12], sports: 0.35, churn: 0.15, extras: 1 },
  casual: { share: 45, active: 0.15, stakeX: 1, rounds: [2, 7], sports: 0.2, churn: 0.45, extras: 0.5 },
  dormant: { share: 15, active: 0.03, stakeX: 1, rounds: [1, 4], sports: 0.1, churn: 0.9, extras: 0.2 },
};

/** Round outcome: [weight, min multiplier, max multiplier] — about a 93% return. */
const OUTCOMES = [[62, 0, 0], [24, 1.1, 1.9], [10, 2, 3], [3.7, 3, 8], [0.3, 15, 60]];

const PROVIDERS = [['inhouse', 35], ['jsgames-v2', 35], ['gis', 30]];

const IN_HOUSE_GAMES = ['crash', 'classic_dice', 'limbo', 'plinko', 'mine', 'keno', 'wheel', 'tower', 'hilo', 'roulette'];

const FIXTURES = [
  { sport: '4', teams: ['India', 'Australia'] }, { sport: '4', teams: ['England', 'Pakistan'] },
  { sport: '4', teams: ['Mumbai Indians', 'Chennai Super Kings'] }, { sport: '4', teams: ['South Africa', 'New Zealand'] },
  { sport: '1', teams: ['Arsenal', 'Chelsea'] }, { sport: '1', teams: ['Real Madrid', 'Barcelona'] },
  { sport: '1', teams: ['Bayern Munich', 'Dortmund'] }, { sport: '2', teams: ['J. Sinner', 'C. Alcaraz'] },
  { sport: '2', teams: ['N. Djokovic', 'D. Medvedev'] },
];

/** Base-cast players whose promised state (see DIRECT_PLAYERS) survives extra play; the rest only get a signup date. */
const ACTIVE_CAST = { demo_depositor: { coins: ['INR'], kyc: true }, demo_multicoin: { coins: ['USDT', 'BTC', 'ETH', 'TRX', 'INR'], kyc: false } };

// ══════════════════════════════════════════════════════════════════════════
//  Small helpers
// ══════════════════════════════════════════════════════════════════════════

const M = (value) => money.toMinor(String(value));
const S = (minor) => money.toDecimalString(minor);
const ZERO = 0n;

/** mulberry32 — small, fast and seedable; `Math.random` is not. */
function createRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    between: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * next()),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted(pairs) {
      const total = pairs.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [value, w] of pairs) {
        if ((r -= w) < 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
    /** e^(σ·N(0,1)) — the long right tail stakes and deposits have. */
    lognormal(sigma) {
      const u = Math.max(next(), 1e-12);
      return Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()));
    },
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

/** `value` snapped to a multiple of `step` (at least one step), as minor units. */
function snap(value, step) {
  const units = Math.max(1, Math.round(value / Number(step)));
  return BigInt(units) * M(step);
}

const floorTo = (minor, step) => (minor / M(step)) * M(step);

/** A UUID derived from a string — tip request ids that are the same on every run of a seed. */
function uuidFrom(seed) {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

const isRefusal = (error) => {
  const status = Number(error?.status ?? error?.statusCode);
  return status >= 400 && status < 500;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ══════════════════════════════════════════════════════════════════════════
//  Already there?
// ══════════════════════════════════════════════════════════════════════════

/** The history this database already holds: tagged ledger rows of demo players. */
async function existingHistory(sequelize) {
  const [row] = await sequelize.query(
    `SELECT COUNT(*)::int AS n, MIN(l.created_at) AS first, MAX(l.created_at) AS last
       FROM credits_ledger l
      WHERE l.idempotency_key LIKE :tag
        AND l.user_id IN (SELECT id::text FROM users WHERE name LIKE 'demo\\_%' OR email LIKE 'demo\\_%')`,
    { replacements: { tag: `${TAG}:%` }, type: QueryTypes.SELECT }
  );
  return row;
}

// ══════════════════════════════════════════════════════════════════════════
//  The plan
// ══════════════════════════════════════════════════════════════════════════

function createPlanner({ rng, seed, days, now, catalogue, cast, vip = null, svc, sequelize, helpers, staff }) {
  const events = [];
  const cutoff = now - 3 * MIN;
  const todayStart = Math.floor((now + SITE_OFFSET) / DAY) * DAY - SITE_OFFSET;
  const firstDay = todayStart - (days - 1) * DAY;
  const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  const exec = (sql, replacements = {}) => sequelize.query(sql, { replacements });

  let seq = 0;
  const key = (n, part) => `${TAG}:${seed}:${n}:${part}`;
  const ref = (n) => `demo-h-${seed}-${n}`;
  const push = (at, kind, run) => {
    const n = (seq += 1);
    events.push({ at: Math.floor(at), seq: n, kind, run: () => run(n) });
    return n;
  };

  // ── Day shape: weekday rhythm × growth × noise × a few promo spikes ──────
  const spikeDays = new Set();
  const spikes = Math.max(1, Math.round(days / 25));
  for (let i = 0; i < spikes && days > 3; i += 1) spikeDays.add(rng.int(1, days - 2));
  const factor = [];
  /** The same day shape without the promo spikes — the VIP cast's grind follows this one. */
  const calm = [];
  for (let d = 0; d < days; d += 1) {
    const dow = new Date(firstDay + d * DAY + SITE_OFFSET + 12 * HOUR).getUTCDay();
    const growth = 0.55 + 0.9 * (days > 1 ? d / (days - 1) : 1);
    const base = WEEKDAY_FACTOR[dow] * growth * rng.between(0.85, 1.15);
    calm.push(base);
    factor.push(base * (spikeDays.has(d) ? rng.between(1.9, 2.6) : 1));
  }
  const meanFactor = factor.reduce((a, b) => a + b, 0) / days;
  const hourPairs = HOUR_WEIGHTS.map((w, h) => [h, w]);

  /** A believable moment on day `d`, not before `after`. */
  const timeIn = (d, after = 0) => {
    const at = firstDay + d * DAY + rng.weighted(hourPairs) * HOUR + rng.between(0, HOUR);
    return Math.max(at, after);
  };
  const dayOf = (at) => Math.floor((at - firstDay) / DAY);

  // ── Players' money, as far as the plan can know it ──────────────────────
  //
  // Tracked balances only ever UNDER-count what a player holds (VIP credits,
  // bonus releases, received tips and claims are not added), so a planned
  // debit never meets an empty wallet.
  const available = (p, at, coin) => {
    p.pending = p.pending.filter((c) => {
      if (c.at > at) return true;
      p.bal[c.coin] = (p.bal[c.coin] ?? ZERO) + c.minor;
      return false;
    });
    return (p.bal[coin] ?? ZERO) - (p.floor[coin] ?? ZERO);
  };
  const debit = (p, coin, minor) => { p.bal[coin] = (p.bal[coin] ?? ZERO) - minor; };
  const creditLater = (p, at, coin, minor) => p.pending.push({ at, coin, minor });
  /** Unique per player: the vault and withdrawal keys are per (amount, minute). */
  const unique = (p, coin, minor, step) => {
    let value = minor;
    while (p.used.has(`${coin}:${value}`)) value += M(step);
    p.used.add(`${coin}:${value}`);
    return value;
  };

  const counts = { refundsPlanned: 0 };

  // ── Signups ─────────────────────────────────────────────────────────────

  const players = [];
  const historyCount = Math.max(8, Math.min(260, Math.round(days * 0.8)));

  /**
   * Stratified along the day curve: signup i lands at quantile (i + jitter) / count
   * of the cumulative day weights over days [from, to). A few dozen independent
   * draws would leave empty weeks; this follows growth, weekends and spikes smoothly.
   */
  const spreadOver = (count, from, to) => {
    const span = factor.slice(from, to);
    const total = span.reduce((a, b) => a + b, 0);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      let u = ((i + rng.between(0.1, 0.9)) / count) * total;
      let d = from;
      for (const f of span) {
        if ((u -= f) < 0) break;
        d += 1;
      }
      out.push(timeIn(Math.min(d, to - 1)));
    }
    return out;
  };

  const signups = spreadOver(historyCount, 0, days);
  signups.sort((a, b) => a - b);
  // The first one is the referrer; keep it first even if another drew an earlier minute.
  for (const [i, at] of signups.entries()) {
    if (at > cutoff) signups[i] = cutoff - (historyCount - i) * MIN;
  }

  for (const [i, signupAt] of signups.entries()) {
    const name = `demo_h${String(i + 1).padStart(3, '0')}`;
    const profileName = i === 0 ? 'regular' : rng.weighted(Object.entries(PROFILES).map(([k, v]) => [k, v.share]));
    const profile = PROFILES[profileName];
    const coin = rng.weighted(PRIMARY_COIN);
    const coins = [coin];
    if (coin !== 'USDT' && rng.chance(0.2)) coins.push('USDT');
    if (coin !== 'INR' && rng.chance(0.15)) coins.push('INR');
    const kyc = rng.weighted([['Verified', 70], ['Pending', 15], [null, 15]]);
    const p = {
      kind: 'history',
      name,
      id: null,
      profileName,
      profile,
      coins,
      signupAt,
      kyc,
      kycAt: kyc ? signupAt + rng.between(2 * HOUR, 3 * DAY) : null,
      referrer: i > 0 && rng.chance(0.25) ? 'demo_h001' : null,
      churnDay: rng.chance(profile.churn) ? dayOf(signupAt) + rng.int(3, 40) : days,
      bal: {},
      floor: {},
      pending: [],
      used: new Set(),
      deposits: 0,
      tips: { count: 0, usd: 0 },
    };
    players.push(p);
  }
  const byName = new Map(players.map((p) => [p.name, p]));

  for (const p of players) {
    push(p.signupAt, 'signups', async () => {
      const created = await helpers.createPlayer(p.name, `history player (${p.profileName})`);
      p.id = created.id;
      p.referralCode = created.referralCode;
      if (p.referrer) {
        const owner = byName.get(p.referrer);
        await svc.affiliate.joinTeam({ userId: p.id, referralCode: owner.referralCode });
        await exec('UPDATE users SET refree = :code WHERE id = :id AND refree IS NULL', { code: owner.referralCode, id: p.id });
      }
    });
    if (p.kyc && p.kycAt <= cutoff) {
      push(p.kycAt, 'kyc', async () => helpers.setKyc({ id: p.id, name: p.name }, p.kyc));
    } else if (p.kyc) {
      p.kyc = null;
    }
  }

  // The base cast: a signup date in the first third of the period; two of them play on.
  const castTimes = rng.shuffle(spreadOver(cast.length, 0, Math.max(1, Math.ceil(days / 3))));
  const castSignups = [];
  const castSignupAt = new Map();
  for (const [i, c] of cast.entries()) {
    const signupAt = Math.min(castTimes[i], cutoff - MIN);
    castSignups.push({ id: c.id, at: signupAt });
    castSignupAt.set(c.name, signupAt);
    const active = ACTIVE_CAST[c.name];
    const agent = c.parentStaffId != null;
    if (!active && !agent) continue;
    const bal = {};
    const floor = {};
    for (const [coin, value] of Object.entries(c.balances)) {
      bal[coin] = M(value);
      floor[coin] = (M(value) * (agent ? 3n : 5n)) / 10n; // keep the promised balances visible
    }
    players.push({
      kind: agent ? 'agent' : 'cast',
      name: c.name,
      id: c.id,
      profileName: agent ? 'casual' : 'regular',
      profile: agent ? PROFILES.casual : PROFILES.regular,
      coins: agent ? ['INR'] : active.coins,
      signupAt,
      kyc: active?.kyc ? 'Verified' : null,
      kycAt: active?.kyc ? signupAt : null,
      churnDay: days,
      bal,
      floor,
      pending: [],
      used: new Set(),
      deposits: 1,
      tips: { count: 0, usd: 0 },
    });
  }

  // ── One day's session ───────────────────────────────────────────────────

  const recipients = () => players.filter((x) => x.kind === 'history');

  function planDeposit(p, coin, at) {
    const c = COINS[coin];
    let amount = snap(c.stake * p.profile.stakeX * rng.between(15, 60) * rng.lognormal(0.35), c.depositStep);
    if (amount < M(c.minDeposit)) amount = M(c.minDeposit);
    const settledAt = at + (c.fiat ? rng.between(4, 75) : rng.between(3, 30)) * MIN;
    if (at > cutoff) return null;
    const pendingNow = settledAt > cutoff;
    const ok = !pendingNow && rng.chance(0.93);
    const first = ok && p.deposits === 0;
    const holder = { id: null };

    if (c.fiat) {
      push(at, 'fiat_deposits', async (n) => {
        const [row] = await q(
          `INSERT INTO fiat_deposits (user_id, amount, currency, bank_name, account_holder_name, transaction_id, status, created_at)
           VALUES (:userId, :amount, :currency, 'Demo Bank', :holder, :tx, 'pending', now())
           RETURNING deposit_id`,
          { userId: p.id, amount: S(amount), currency: coin, holder: `Demo ${p.name}`, tx: `DEMO-H-${seed}-${n}` }
        );
        holder.id = row.deposit_id;
      });
      if (!pendingNow) {
        push(settledAt, 'fiat_deposits', async () => {
          if (!holder.id) return;
          if (ok) await svc.fiatDeposit.approve({ depositId: holder.id, comment: 'Demo history — approved' }, staff);
          else await svc.fiatDeposit.reject({ depositId: holder.id, comment: 'Payment not received — the UTR does not match any credit.' }, staff);
        });
      }
    } else {
      const orderId = ref(seq + 1);
      push(at, 'ccdeposit', async () => {
        await exec(
          `INSERT INTO ccdeposit (userid, coinid, price, orderid, chain, deposit_address, amount, status, created_at, updated_at)
           VALUES (:userId, :coinId, :amount, :orderId, :chain, :address, :amount, 'Processing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          {
            userId: String(p.id), coinId: c.coinId, amount: S(amount), orderId, chain: c.chain,
            address: `demo-${crypto.createHash('sha1').update(orderId).digest('hex').slice(0, 30)}`,
          }
        );
        holder.id = orderId;
      });
      if (!pendingNow) {
        push(settledAt, 'ccdeposit', async () => {
          if (!holder.id) return;
          const rawBody = JSON.stringify({
            type: 'ApiDeposit',
            msg: { orderId: holder.id, coinSymbol: coin, status: ok ? 'Success' : 'Failed', amount: S(amount) },
          });
          const { signature, timestamp } = svc.signCryptoWebhook(rawBody);
          await svc.crypto.handleWebhook({ rawBody, signature, timestamp });
        });
      }
    }
    if (!ok) return null;

    p.deposits += 1;
    creditLater(p, settledAt, coin, amount);
    if (first && rng.chance(0.6)) {
      const usd = String(rng.pick([10, 20, 25, 50]));
      const multiplier = rng.pick([5, 8, 10]);
      push(settledAt + MIN, 'player_bonuses', async () => {
        const quote = await svc.rewardMoney.fromUsd(usd);
        await svc.playerBonuses.grant({
          userId: p.id,
          source: 'first_deposit',
          grantKey: `${TAG}:${seed}:bonus:${p.name}:first-deposit`,
          ref: 'demo-history',
          currency: quote.currency,
          amount: quote.amount,
          wagerMultiplier: multiplier,
          expiryDays: 30,
          description: 'Demo first-deposit bonus',
        });
      });
    }
    return settledAt + rng.between(1, 5) * MIN;
  }

  function planRound(p, coin, at, stake) {
    const provider = rng.weighted(PROVIDERS);
    const game = rng.weighted(catalogue[provider]);
    const multiplier = rng.weighted(OUTCOMES.map(([w, lo, hi]) => [[lo, hi], w]));
    const m = multiplier[1] === 0 ? 0 : rng.between(multiplier[0], multiplier[1]);
    const payout = m === 0 ? ZERO : (stake * BigInt(Math.round(m * 10000))) / 10000n;
    const refundRoll = provider !== 'jsgames-v2' && dayOf(at) >= 1 && rng.chance(0.015);
    const refund = refundRoll ? { partial: provider === 'gis' && rng.chance(0.6) } : null;
    if (refund) counts.refundsPlanned += 1;

    debit(p, coin, stake);
    if (refund) creditLater(p, at, coin, refund.partial ? stake / 2n : stake);
    else if (payout > ZERO) creditLater(p, at, coin, payout);

    push(at, `casino:${provider}`, async (n) => {
      const userId = p.id;
      const tx = ref(n);
      const refType = { inhouse: 'INHOUSE', 'jsgames-v2': 'JSGAMES', gis: 'GIS' }[provider];
      const move = (direction, reason, amount, part) =>
        svc.wallet[direction](
          { userId, currency: coin, amount: S(amount), reason, idempotencyKey: key(n, part), refType, refId: tx, description: `${game.name} ${part}` },
          { sourceService: 'casino-service' }
        );

      const staked = await move('debit', REASON.BET_STAKE, stake, 'stake');
      let wagerRef = tx;
      const refunded = refund ? (refund.partial ? stake / 2n : stake) : ZERO;
      const credited = refund ? null : payout > ZERO ? await move('credit', REASON.BET_PAYOUT, payout, 'payout') : null;
      const back = refund ? await move('credit', REASON.BET_REFUND, refunded, 'refund') : null;

      if (provider === 'inhouse') {
        const [row] = await q(
          `INSERT INTO bets (game, gid, uid, amount, coin, result, profit, created, hash, name)
           VALUES (:game, :gid, :uid, :amount, :coin, CAST(:result AS json), :profit, now(), :hash, :name)
           RETURNING id`,
          {
            game: game.key, gid: 100000 + n, uid: userId, amount: S(stake), coin: coin.toLowerCase(),
            result: refund ? '"refunded"' : JSON.stringify(Number(m.toFixed(4))),
            profit: refund ? '0' : S(payout - stake),
            hash: crypto.createHash('sha256').update(tx).digest('hex'), name: p.name,
          }
        );
        wagerRef = String(row.id);
      } else if (provider === 'jsgames-v2') {
        const insert = (type, amount, ledgerId) => exec(
          `INSERT INTO game_transactions (user_id, game_uid, transaction_type, amount, currency, external_transaction_id,
                                          ledger_id, serial_number, game_type, game_name, transaction_status)
           VALUES (:userId, :gameUid, :type, :amount, :currency, :round, :ledgerId, :serial, :gameType, :gameName, 'completed')`,
          { userId, gameUid: game.key, type, amount: S(amount), currency: coin, round: tx, ledgerId, serial: `${tx}:${type}`, gameType: game.type, gameName: game.name }
        );
        await insert('bet', -stake, staked.ledgerId);
        if (credited) await insert('win', payout, credited.ledgerId);
      } else {
        // No `session_id`: it references a real `gis_sessions` launch, and no game was launched.
        const insert = (transactionId, action, amount, balance, betTx) => exec(
          `INSERT INTO gis_transactions (user_id, session_id, transaction_id, action, amount, currency, game_uuid, round_id,
                                         finished, bet_transaction_id, balance_after, created_at)
           VALUES (:userId, NULL, :transactionId, :action, :amount, :currency, :game, :round, true, :betTx, :balance, now())`,
          { userId, transactionId, action, amount: S(amount), currency: coin, game: game.key, round: tx, betTx, balance }
        );
        await insert(tx, 'bet', -stake, staked.newBalance, null);
        if (credited) await insert(`${tx}:w`, 'win', payout, credited.newBalance, tx);
        if (back) await insert(`rf:${tx}`, 'refund', refunded, back.newBalance, tx);
      }

      const source = provider;
      await svc.wager.record({ userId, amount: S(stake), currency: coin, source, ref: wagerRef });
      if (refund?.partial) {
        await svc.wager.reverse({ userId, source, ref: wagerRef, amount: S(refunded), refundRef: `rf:${tx}` });
      } else if (refund) {
        await svc.wager.reverse({ userId, source, ref: wagerRef });
      }
    });
  }

  function planSportsBet(p, at) {
    const c = COINS.INR;
    const stake = snap(c.stake * p.profile.stakeX * rng.lognormal(0.5) * 1.5, '50');
    if (available(p, at, 'INR') < stake) return;
    const fixture = rng.pick(FIXTURES);
    const pickIndex = rng.int(0, 1);
    const odds = Number(rng.between(1.3, 4.2).toFixed(2));
    const startAt = at + rng.between(10, 120) * MIN;
    const settleAt = startAt + rng.between(1.5, 4.5) * HOUR;
    const result = rng.weighted([['won', 42], ['loss', 53], ['refund', 5]]);
    const payout = result === 'won' ? (stake * BigInt(Math.round(odds * 100))) / 100n : result === 'refund' ? stake : ZERO;
    debit(p, 'INR', stake);
    const settles = settleAt <= cutoff;
    if (settles && payout > ZERO) creditLater(p, settleAt, 'INR', payout);

    const bet = { id: null, stakeLedger: null };
    const matchId = String(7600000000000 + rng.int(1, 999999));
    const eventId = String(650000000 + rng.int(1, 999999));
    // The bet row and its stake commit together, as the book's placement does.
    push(at, 'sports', (n) => sequelize.transaction(async (transaction) => {
      const userId = p.id;
      const title = `${fixture.teams[0]} v ${fixture.teams[1]}`;
      const [row] = await sequelize.query(
        `INSERT INTO "SportsBet" (user_id, game_type, match_title, team_one, team_two, selection_name, category, bet_type,
                                  market_type, odds, stake_amount, original_currency, original_amount, usd_amount, liability,
                                  match_start_time, created_at, updated_at, match_id, exposure_after_bet, status, eventid,
                                  result_status, fixed, counts, sport_id, unmatched, runners, size, event_name)
         VALUES (:userId, 'MO', :title, :one, :two, :selection, '01', 'back', 'MATCH_ODDS', :odds, :stake, 'INR', :stake,
                 :usd, :stake, :startAt, now(), now(), :matchId, :stake, 'open', :eventId, 'pending', 0, 2, :sport, false,
                 CAST(:runners AS jsonb), 0, :title)
         RETURNING id`,
        {
          type: QueryTypes.SELECT,
          transaction,
          replacements: {
            userId, title, one: fixture.teams[0], two: fixture.teams[1], selection: fixture.teams[pickIndex], odds: odds.toFixed(4),
            stake: S(stake), usd: (Number(S(stake)) * c.usd).toFixed(2), startAt: new Date(startAt), matchId, eventId,
            sport: fixture.sport, runners: JSON.stringify(fixture.teams),
          },
        }
      );
      const moved = await svc.wallet.debit(
        {
          userId, currency: 'INR', amount: S(stake), reason: REASON.BET_STAKE, idempotencyKey: key(n, 'stake'),
          refType: 'SPORTS', refId: String(row.id), description: `Sports bet #${row.id} — ${title}`,
          matchId, marketType: 'MATCH_ODDS', sportId: fixture.sport, eventId, betId: row.id,
        },
        { sourceService: 'sports-service', transaction }
      );
      bet.id = row.id;
      bet.stakeLedger = moved.ledgerId;
    }));

    if (!settles) return;
    push(settleAt, 'sports', async (n) => {
      if (!bet.id) return;
      const userId = p.id;
      let paid = null;
      if (payout > ZERO) {
        paid = await svc.wallet.credit(
          {
            userId, currency: 'INR', amount: S(payout), reason: result === 'won' ? REASON.BET_PAYOUT : REASON.BET_REFUND,
            idempotencyKey: key(n, result), refType: 'SPORTS', refId: String(bet.id),
            description: `Sports bet #${bet.id} ${result === 'won' ? 'won' : 'voided — stake returned'}`,
            matchId, marketType: 'MATCH_ODDS', sportId: fixture.sport, eventId, betId: bet.id,
          },
          { sourceService: 'sports-service' }
        );
      }
      await exec(
        `UPDATE "SportsBet" SET status = 'closed', result_status = :result, match_end_time = now(), updated_at = now() WHERE id = :id`,
        { id: bet.id, result }
      );
      // The settlement ledger's `netamount` (the player's net), which the sports GGR is read from.
      await exec('UPDATE credits_ledger SET netamount = :net WHERE id = :id AND user_id = :uid', { id: bet.stakeLedger, net: S(-stake), uid: String(userId) });
      if (paid) await exec('UPDATE credits_ledger SET netamount = :net WHERE id = :id AND user_id = :uid', { id: paid.ledgerId, net: S(payout), uid: String(userId) });
      if (result !== 'refund') {
        await svc.wager.record({ userId, amount: S(stake), currency: 'INR', source: 'sports', ref: String(bet.id) });
      }
    });
  }

  function planWithdrawal(p, coin, at) {
    const c = COINS[coin];
    const free = available(p, at, coin);
    let amount = floorTo((free * BigInt(Math.round(rng.between(0.35, 0.7) * 100))) / 100n, c.depositStep);
    if (amount < M(c.depositStep) * 2n) return;
    amount = unique(p, coin, amount, c.depositStep);
    debit(p, coin, amount);
    const decidedAt = at + rng.between(1, 30) * HOUR;
    const decided = decidedAt <= cutoff;
    const status = decided ? rng.weighted([['Paid', 62], ['Approved', 12], ['Rejected', 16], ['In Queue', 4]]) : 'In Queue';
    if (status === 'Rejected') creditLater(p, decidedAt, coin, amount);
    const holder = { id: null };
    if (!c.fiat) {
      planCryptoWithdrawal(p, coin, amount, at, status === 'Paid' ? 'Sent' : status, decidedAt, holder);
      return;
    }
    push(at, 'fiat_withdrawals', async () => {
      const created = await svc.fiatWithdraw.create({
        userId: p.id,
        details: {
          // The player confirms the "withdrawing forfeits your bonus" dialog, so a held bonus ends `forfeited`.
          forfeitBonus: true,
          amount: S(amount),
          currency: coin,
          accountHolderName: `Demo ${p.name}`,
          bankName: 'Demo Bank',
          accountNumber: '000012345678',
          ifscCode: 'DEMO0001234',
        },
      });
      holder.id = created.withdrawalId;
    });
    if (status === 'In Queue') return;
    push(decidedAt, 'fiat_withdrawals', async () => {
      if (!holder.id) return;
      await svc.fiatWithdraw.updateStatus(
        { withdrawalId: holder.id, status, comment: status === 'Rejected' ? 'The beneficiary name does not match the KYC name.' : null },
        staff
      );
    });
  }

  /**
   * A coin payout: the crypto queue (`withdrawals`), not the bank form. The
   * request is what the player's socket call writes — the hold and the row in
   * one transaction — but with the hold as a WITHDRAWAL ledger debit, so the
   * wallet reconciles. The queue's decisions then go through
   * `CryptoWithdrawService.decide` (Approved → Sent, or Rejected with its refund).
   * `coin` is stored upper-case, as most rows are: `decide` refunds in `row.coin`,
   * and a lower-case ledger currency is invisible to `WalletService.reconcile`.
   */
  let cryptoWithdrawals = 0;
  function planCryptoWithdrawal(p, coin, amount, at, status, decidedAt, holder) {
    const c = COINS[coin];
    cryptoWithdrawals += 1;
    push(at, 'withdrawals', (n) => sequelize.transaction(async (transaction) => {
      await svc.playerBonuses.beforeWithdrawal(p.id, { forfeitBonus: true, transaction });
      const [row] = await sequelize.query(
        `INSERT INTO withdrawals (uid, amount, wallet, status, coin, chain, date)
         VALUES (:uid, :amount, :wallet, 'In Queue', :coin, :chain, now()) RETURNING id`,
        {
          type: QueryTypes.SELECT,
          transaction,
          replacements: {
            uid: p.id, amount: S(amount), coin, chain: c.chain,
            wallet: `demo-${crypto.createHash('sha1').update(`${p.name}:${coin}`).digest('hex').slice(0, 30)}`,
          },
        }
      );
      await svc.wallet.debit(
        {
          userId: p.id, currency: coin, amount: S(amount), reason: REASON.WITHDRAWAL, idempotencyKey: key(n, 'withdraw'),
          refType: 'CRYPTO_WITHDRAWAL', refId: String(row.id), description: `${coin} withdrawal requested`,
        },
        { sourceService: 'user-service', transaction }
      );
      holder.id = String(row.id);
    }));
    if (status === 'In Queue') return;
    // The queue moves one step at a time: In Queue → Approved → Sent.
    const steps = status === 'Sent' ? ['Approved', 'Sent'] : [status];
    steps.forEach((step, i) => {
      const stepAt = decidedAt + i * rng.between(10, 90) * MIN;
      if (stepAt > cutoff) return; // still waiting to be sent
      push(stepAt, 'withdrawals', async () => {
        if (!holder.id) return;
        await svc.cryptoWithdraw.decide(
          { withdrawalId: holder.id, status: step, comment: step === 'Rejected' ? 'The destination address failed the screening check.' : null },
          staff
        );
      });
    });
  }

  function planTip(p, coin, at) {
    const c = COINS[coin];
    if (!c.tip || p.tips.count >= 12) return;
    const to = rng.pick(recipients().filter((x) => x !== p && x.signupAt < at - HOUR));
    if (!to) return;
    const amount = snap(rng.between(c.tip[0], c.tip[1]), c.tip[2]);
    const usd = Number(S(amount)) * c.usd;
    if (p.tips.usd + usd > 400 || available(p, at, coin) < amount * 4n) return;
    p.tips.count += 1;
    p.tips.usd += usd;
    debit(p, coin, amount);
    push(at, 'tips', async (n) => {
      await svc.tips.send({
        userId: p.id,
        toUsername: to.name,
        currency: coin,
        amount: S(amount),
        note: rng.chance(0.5) ? rng.pick(['gg', 'nice win!', 'good luck', 'for the next spin', 'thanks mate']) : null,
        requestId: uuidFrom(`${TAG}:${seed}:tip:${n}`),
      });
    });
  }

  function planVault(p, coin, at) {
    const c = COINS[coin];
    let amount = floorTo((available(p, at, coin) * BigInt(Math.round(rng.between(0.2, 0.4) * 100))) / 100n, c.depositStep);
    if (amount < M(c.depositStep)) return;
    amount = unique(p, coin, amount, c.depositStep);
    debit(p, coin, amount);
    const outAt = at + rng.between(1, 20) * DAY;
    const holder = { id: null };
    push(at, 'vault', async () => {
      const out = await svc.vault.transferIn({ userId: p.id, coin, amount: S(amount), lockPeriod: 'flexible' });
      holder.id = out.depositId;
    });
    if (outAt > cutoff) return;
    creditLater(p, outAt, coin, amount);
    push(outAt, 'vault', async () => {
      if (holder.id) await svc.vault.transferOut({ userId: p.id, depositId: holder.id, coin });
    });
  }

  function planSession(p, d) {
    let t = timeIn(d, d === dayOf(p.signupAt) ? p.signupAt + rng.between(3, 40) * MIN : 0);
    if (t > cutoff) return;
    const coin = p.coins.length > 1 && rng.chance(0.25) ? rng.pick(p.coins.slice(1)) : p.coins[0];
    const c = COINS[coin];
    const stakeBase = c.stake * p.profile.stakeX;

    if (p.kind !== 'agent' && (available(p, t, coin) < snap(stakeBase * 6, c.step) || rng.chance(0.1))) {
      const after = planDeposit(p, coin, t);
      if (after == null) return;
      t = after;
    }

    const rounds = rng.int(...p.profile.rounds);
    for (let r = 0; r < rounds; r += 1) {
      t += rng.between(0.5, 4) * MIN;
      if (t > cutoff) return;
      const stake = snap(stakeBase * rng.lognormal(0.6), c.step);
      if (available(p, t, coin) < stake) break;
      planRound(p, coin, t, stake);
    }

    if (p.coins.includes('INR') && rng.chance(p.profile.sports)) {
      for (let b = rng.int(1, 3); b > 0; b -= 1) {
        t += rng.between(1, 10) * MIN;
        if (t > cutoff) return;
        planSportsBet(p, t);
      }
    }

    if (p.kind === 'agent') return;
    const x = p.profile.extras;
    t += rng.between(1, 6) * MIN;
    if (t > cutoff) return;

    if (p.kind === 'history' && rng.chance(0.06 * x)) planTip(p, coin, t);
    if (p.kind === 'history' && ['INR', 'USDT'].includes(coin) && p.profileName !== 'casual' && rng.chance(0.05 * x)) {
      t += MIN;
      planVault(p, coin, t);
    }
    if (rng.chance(0.07 * x)) {
      t += MIN;
      push(t, 'rakeback', async () => {
        const state = await svc.rakeback.amount({ userId: p.id });
        if (state?.claimable) await svc.rakeback.claim({ userId: p.id });
      });
    }
    if (p.kind === 'history' && rng.chance(0.025 * x)) {
      t += MIN;
      const usd = String(rng.pick([5, 10, 15, 25]));
      const multiplier = rng.pick([10, 15, 20]);
      push(t, 'player_bonuses', async (n) => {
        const quote = await svc.rewardMoney.fromUsd(usd);
        await svc.playerBonuses.grant({
          userId: p.id,
          source: 'spin_wheel',
          grantKey: `${TAG}:${seed}:bonus:${p.name}:${n}`,
          ref: 'demo-history',
          currency: quote.currency,
          amount: quote.amount,
          wagerMultiplier: multiplier,
          expiryDays: 14,
          description: 'Demo reload bonus',
        });
      });
    }
    // History players only, after one of their own deposits: the base cast's money lands on
    // seed day, and a backdated withdrawal must not come before the player's first deposit.
    if (p.kyc === 'Verified' && p.kycAt < t && p.kind === 'history' && p.deposits > 0 && c.withdraw && available(p, t, coin) > snap(stakeBase * 25, c.step)
        && rng.chance({ whale: 0.3, regular: 0.14, casual: 0.07, dormant: 0.05 }[p.profileName])) {
      t += rng.between(2, 20) * MIN;
      if (t <= cutoff) planWithdrawal(p, coin, t);
    }
  }

  for (const p of players) {
    const startDay = Math.max(0, dayOf(p.signupAt));
    const lastDay = Math.min(days - 1, p.churnDay);
    for (let d = startDay; d <= lastDay; d += 1) {
      const firstDay_ = p.kind === 'history' && d === startDay;
      const chance = firstDay_ ? 0.75 : Math.min(0.95, (p.profile.active * factor[d]) / meanFactor);
      if (rng.chance(chance)) planSession(p, d);
    }
  }

  // Withdrawals are random, so a short window can draw none on the crypto rail; the crypto
  // withdrawals chart and queue should never be empty, so plant one from the richest verified
  // USDT player shortly before the cutoff.
  if (cryptoWithdrawals === 0) {
    const at = cutoff - 2 * HOUR;
    const candidates = players
      .filter((p) => p.kyc === 'Verified' && p.kycAt < at && p.kind === 'history' && p.deposits > 0 && p.coins.includes('USDT'))
      .sort((x, y) => (available(y, at, 'USDT') > available(x, at, 'USDT') ? 1 : -1));
    for (const p of candidates) {
      const step = COINS.USDT.depositStep;
      const amount = floorTo(available(p, at, 'USDT') / 2n, step);
      if (amount < M(step) * 2n) continue;
      debit(p, 'USDT', amount);
      // Decided (and sent) an hour later, still before the cutoff.
      planCryptoWithdrawal(p, 'USDT', amount, at, 'Sent', at + HOUR, { id: null });
      break;
    }
  }

  // The affiliate claims commission about once a week (when its referees have played).
  const affiliate = byName.get('demo_h001');
  if (affiliate && players.some((p) => p.referrer === 'demo_h001')) {
    for (let d = dayOf(affiliate.signupAt) + 7; d < days; d += rng.int(5, 9)) {
      const at = timeIn(d);
      if (at > cutoff) break;
      push(at, 'rewards', async () => {
        const rows = await q(
          `SELECT id FROM rewards WHERE owner_id = :id AND type = 'commission' AND claimed = false AND voided = false
            ORDER BY id ASC LIMIT 5`,
          { id: affiliate.id }
        );
        for (const row of rows) await svc.affiliate.claimReward({ userId: affiliate.id, rewardId: Number(row.id), kind: 'commission' });
      });
    }
  }

  // ── The VIP cast grows into its cards (see the header) ───────────────────
  //
  // Drawn last, so the rest of a seed's plan is the same with or without it.
  const vipGrowth = [];
  const lastVipAt = cutoff - 2 * MIN; // room for the rakeback claim after the last round
  for (const v of vip?.players ?? []) {
    const signupAt = castSignupAt.get(v.name);
    if (signupAt == null || v.remainingCents <= 0) continue;
    const after = signupAt + 5 * MIN;
    /** A moment on day `d` after the signup and before the cutoff, or null. */
    const momentOn = (d) => {
      const at = timeIn(d, after);
      if (at <= lastVipAt) return at;
      const lo = Math.max(after, firstDay + d * DAY);
      return lo < lastVipAt ? lo + rng.between(0, 1) * (lastVipAt - lo) : null;
    };
    // Active on most days; the bigger the card, the more rounds a day.
    const playDays = [];
    for (let d = Math.max(0, dayOf(signupAt)); d < days; d += 1) {
      if (rng.chance(0.85)) playDays.push(d);
    }
    if (!playDays.length) playDays.push(days - 1);
    const rounds = [];
    for (const d of playDays) {
      const weight = calm[d] * rng.between(0.8, 1.2);
      const n = rng.int(1, 2 + Math.min(4, v.card ?? 0));
      for (let r = 0; r < n; r += 1) {
        const at = momentOn(d);
        if (at != null) rounds.push({ at, w: (weight / n) * rng.between(0.6, 1.4) });
      }
    }
    if (!rounds.length) rounds.push({ at: Math.max(after, lastVipAt - MIN), w: 1 });
    // Whole cents, split by weight; the last round takes the rounding, so the total is exact.
    const totalW = rounds.reduce((sum, r) => sum + r.w, 0);
    let left = v.remainingCents;
    rounds.forEach((r, i) => {
      const cents = i === rounds.length - 1 ? left : Math.min(left, Math.floor((v.remainingCents * r.w) / totalW));
      left -= cents;
      r.cents = cents;
    });
    let last = 0;
    for (const r of rounds) {
      if (r.cents <= 0) continue;
      last = Math.max(last, r.at);
      const amount = `${Math.floor(r.cents / 100)}.${String(r.cents % 100).padStart(2, '0')}`;
      push(r.at, 'vip', async (n) => {
        const result = await svc.wager.record({
          userId: v.id, amount, currency: 'USDT', source: vip.source, ref: `${TAG}:${seed}:vip:${v.name}:${n}`,
        });
        if (!result?.counted && !result?.duplicate) throw new Error(`${v.name}: VIP wager not counted (${result?.reason})`);
      });
    }
    if (v.claimRakeback) {
      push(Math.min(last + MIN, cutoff), 'rakeback', async () => {
        const state = await svc.rakeback.amount({ userId: v.id });
        if (state?.claimable) await svc.rakeback.claim({ userId: v.id });
      });
    }
    vipGrowth.push({ name: v.name, rounds: rounds.filter((r) => r.cents > 0).length, usd: v.remainingCents / 100 });
  }

  events.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return { events, castSignups, firstDay, cutoff, historyCount, spikeDays: [...spikeDays].sort((a, b) => a - b), counts, vipGrowth };
}

// ══════════════════════════════════════════════════════════════════════════
//  The game catalogue the rounds are played on
// ══════════════════════════════════════════════════════════════════════════

async function loadCatalogue(sequelize, rng) {
  const q = (sql) => sequelize.query(sql, { type: QueryTypes.SELECT });
  /** A few games, more popular ones first (Zipf-ish weights). */
  const pickGames = (rows, count, vendorOf) => {
    const shuffled = rng.shuffle(rows);
    const chosen = [];
    const vendors = new Set();
    for (const row of shuffled) {
      if (chosen.length >= count) break;
      if (vendors.has(vendorOf(row)) && vendors.size < count / 2) continue;
      vendors.add(vendorOf(row));
      chosen.push(row);
    }
    return chosen.map((row, i) => [row, 1 / (i + 1)]);
  };

  const js = await q(
    `SELECT game_uid, game_name, game_type, vendor FROM js_games
      WHERE COALESCE(is_active, true) AND game_uid IS NOT NULL AND COALESCE(vendor, '') NOT ILIKE '%house%'
      ORDER BY id ASC LIMIT 1500`
  ).catch(() => []);
  const gis = await q(
    `SELECT uuid, name, provider, type FROM gis_games
      WHERE LOWER(COALESCE(type, '')) NOT LIKE '%sport%' ORDER BY uuid ASC LIMIT 500`
  ).catch(() => []);

  const jsGames = js.length
    ? pickGames(js, 12, (r) => r.vendor).map(([r, w]) => [{ key: r.game_uid, name: r.game_name, type: r.game_type }, w])
    : [1, 2, 3, 4].map((i) => [{ key: `demo-slot-${i}`, name: `Demo Slot ${i}`, type: 'slot' }, 1 / i]);
  const gisGames = gis.length
    ? pickGames(gis, 8, (r) => r.provider).map(([r, w]) => [{ key: r.uuid, name: r.name, type: r.type }, w])
    : [1, 2, 3].map((i) => [{ key: `demo-gis-${i}`, name: `Demo Live ${i}`, type: 'live' }, 1 / i]);
  const inhouse = IN_HOUSE_GAMES.map((g, i) => [{ key: g, name: g, type: 'originals' }, 1 / (i + 1)]);

  return { inhouse, 'jsgames-v2': jsGames, gis: gisGames };
}

// ══════════════════════════════════════════════════════════════════════════
//  Backdating
// ══════════════════════════════════════════════════════════════════════════

const TIMESTAMP_TYPES = new Set(['timestamp with time zone', 'timestamp without time zone']);
const NUMERIC_TYPES = new Set(['bigint', 'integer', 'smallint', 'numeric']);

/**
 * Move every timestamp a demo player's row got inside one of `windows` back by
 * that window's offset. One transaction; returns rows touched per table.
 *
 * `windows`: [{ loUs, hiUs, shiftUs }] — microseconds since the epoch (DB clock).
 */
async function backdate({ sequelize, windows, castSignups }) {
  return sequelize.transaction(async (transaction) => {
    const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
    const exec = (sql, replacements = {}) => sequelize.query(sql, { replacements, transaction });

    const users = await q("SELECT id::text AS id, name FROM users WHERE name LIKE 'demo\\_%' OR email LIKE 'demo\\_%'");
    const ids = users.map((u) => u.id);
    const names = users.map((u) => u.name);
    const touched = {};
    if (!ids.length || !windows.length) return touched;

    await exec('CREATE TEMP TABLE demo_history_windows (span tstzrange NOT NULL, shift interval NOT NULL) ON COMMIT DROP');
    for (let i = 0; i < windows.length; i += 500) {
      const chunk = windows.slice(i, i + 500);
      const values = chunk.map((_, j) => `(tstzrange(timestamptz 'epoch' + :lo${j} * interval '1 microsecond',
                                                     timestamptz 'epoch' + :hi${j} * interval '1 microsecond', '[]'),
                                           :shift${j} * interval '1 microsecond')`);
      const replacements = {};
      chunk.forEach((w, j) => {
        replacements[`lo${j}`] = w.loUs;
        replacements[`hi${j}`] = w.hiUs;
        replacements[`shift${j}`] = w.shiftUs;
      });
      await exec(`INSERT INTO demo_history_windows (span, shift) VALUES ${values.join(', ')}`, replacements);
    }
    await exec('CREATE INDEX ON demo_history_windows USING gist (span)');
    await exec('ANALYZE demo_history_windows');

    const columns = await q(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()`
    );
    const typeOf = new Map(columns.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
    const timestampsOf = (table) => columns.filter((c) => c.table_name === table && TIMESTAMP_TYPES.has(c.data_type)).map((c) => c.column_name);

    const keyed = [...USER_KEYED, ['users', 'id']];
    const plans = [];
    for (const [table, column] of keyed) {
      if (!typeOf.has(`${table}.${column}`)) continue;
      const numeric = NUMERIC_TYPES.has(typeOf.get(`${table}.${column}`));
      plans.push({ table, where: `t.${quoteIdent(column)} IN (:ids)`, replacements: { ids: numeric ? ids.map(Number) : ids } });
    }
    if (typeOf.has('team.ownername') && typeOf.has('team.membername')) {
      plans.push({ table: 'team', where: 't.ownername IN (:names) OR t.membername IN (:names)', replacements: { names } });
    }

    for (const { table, where, replacements } of plans) {
      for (const col of timestampsOf(table)) {
        const c = quoteIdent(col);
        // Each value sits in at most one window (they are disjoint), and a moved value is
        // before the run started, so a second pass over the same row cannot move it again.
        const [{ n }] = await q(
          `WITH moved AS (
             UPDATE ${quoteIdent(table)} AS t SET ${c} = t.${c} - w.shift
               FROM demo_history_windows w
              WHERE (${where}) AND t.${c} IS NOT NULL AND w.span @> t.${c}::timestamptz
             RETURNING 1)
           SELECT COUNT(*)::int AS n FROM moved`,
          replacements
        );
        if (n) touched[table] = Math.max(touched[table] ?? 0, n);
      }
    }

    // The base cast's signups — demo players that existed before this run.
    for (const { id, at } of castSignups) {
      await exec(
        "UPDATE users SET created = :at WHERE id = :id AND (name LIKE 'demo\\_%' OR email LIKE 'demo\\_%')",
        { id, at: new Date(at) }
      );
    }
    if (castSignups.length) touched.users = (touched.users ?? 0) + castSignups.length;
    return touched;
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  The run
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} o
 * @param {import('sequelize').Sequelize} o.sequelize
 * @param {object} o.services     createDemoServices(...)
 * @param {number} o.days
 * @param {number} o.seed
 * @param {object} o.helpers      { createPlayer(name, note) → { id, referralCode }, setKyc(player, status) }
 * @param {object} [o.vip]        { source, players: [{ name, target (USD), card (index), claimRakeback }] } — the VIP
 *                                cast this run grows into its cards (the base `vip` dataset left the wager out)
 * @param {(line: string) => void} [o.progress]
 * @returns {Promise<{ skipped?, existing?, events, byKind, refused, touched, span, historyPlayers, spikeDays, vipGrowth, lump }>}
 */
async function runHistory({ sequelize, services: svc, days, seed, helpers, vip = null, progress = () => {} }) {
  const before = await existingHistory(sequelize);
  if (before.n) return { skipped: true, existing: before };

  const cast = await sequelize.query(
    `SELECT u.id, u.name, u.parent_staff_id AS "parentStaffId", c.inr::text AS inr, c.usdt::text AS usdt, c.btc::text AS btc,
            c.eth::text AS eth, c.trx::text AS trx, c.eur::text AS eur
       FROM users u LEFT JOIN credits c ON c.uid = u.id
      WHERE (u.name LIKE 'demo\\_%' OR u.email LIKE 'demo\\_%') AND u.name NOT LIKE 'demo\\_h%'
      ORDER BY u.name`,
    { type: QueryTypes.SELECT }
  );
  if (!cast.some((c) => c.name === 'demo_depositor')) {
    throw new Error('No demo cast on this database — run `--demo` first (or together: --demo --history).');
  }
  for (const c of cast) {
    c.id = Number(c.id);
    c.balances = {};
    for (const coin of Object.keys(COINS)) {
      const value = c[coin.toLowerCase()];
      if (value != null && money.gt(money.fromStored(value), '0')) c.balances[coin] = money.fromStored(value);
    }
  }

  // What each VIP cast player still needs to reach its target, in whole USD cents.
  const vipPlan = vip ? { source: vip.source, players: [] } : null;
  const lump = [];
  for (const v of vip?.players ?? []) {
    const c = cast.find((x) => x.name === v.name);
    if (!c) continue;
    const [row] = await sequelize.query(
      `SELECT COALESCE((SELECT wager::text FROM userwager WHERE uid = :id LIMIT 1), '0') AS wager,
              EXISTS (SELECT 1 FROM wager_activity WHERE user_id = :id AND source = :source AND ref = :ref) AS lumped`,
      { replacements: { id: c.id, source: vip.source, ref: `demo-seed:${v.name}:vip` }, type: QueryTypes.SELECT }
    );
    if (row.lumped) lump.push(v.name);
    const missing = money.toMinor(v.target) - money.toMinor(money.fromStored(row.wager));
    const unit = money.toMinor('0.01');
    const remainingCents = missing > ZERO ? Number((missing + unit - 1n) / unit) : 0;
    vipPlan.players.push({ id: c.id, name: v.name, card: v.card, claimRakeback: Boolean(v.claimRakeback), remainingCents });
  }

  const [handler] = await sequelize.query("SELECT id FROM staff WHERE name = 'demo_admin' LIMIT 1", { type: QueryTypes.SELECT });
  const staff = handler ? { id: Number(handler.id) } : null;

  const clockUs = async () => {
    const [row] = await sequelize.query("SELECT (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text AS us", { type: QueryTypes.SELECT });
    return Number(row.us);
  };
  const now = Math.floor((await clockUs()) / 1000);

  const rng = createRng(seed);
  const catalogue = await loadCatalogue(sequelize, rng);
  const plan = createPlanner({ rng, seed, days, now, catalogue, cast, vip: vipPlan, svc, sequelize, helpers, staff });
  progress(`${plan.events.length} events planned over ${days} day(s), ${plan.historyCount} new history players`);

  const windows = [];
  const byKind = {};
  const refused = {};
  let failure = null;
  let done = 0;
  try {
    for (const event of plan.events) {
      const t0 = await clockUs();
      try {
        await event.run();
        byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      } catch (error) {
        if (!isRefusal(error)) {
          error.message = `history event #${event.seq} (${event.kind}): ${error.message}`;
          throw error;
        }
        const label = `${event.kind}: ${error.code ?? error.status}`;
        refused[label] = (refused[label] ?? 0) + 1;
      }
      await svc.settle();
      const t1 = await clockUs();
      // [t0 − 1 ms, t1]: a JS Date a service wrote is truncated to the millisecond.
      windows.push({ loUs: t0 - 1000, hiUs: t1, shiftUs: t0 - event.at * 1000 });
      done += 1;
      if (done % 500 === 0) progress(`${done}/${plan.events.length} events`);
      // Keeps the windows disjoint even after the 1 ms widening above.
      await sleep(2);
    }
  } catch (error) {
    failure = error;
  }

  const touched = await backdate({ sequelize, windows, castSignups: plan.castSignups });
  if (failure) {
    failure.message = `${failure.message} (the ${windows.length} events before it were backdated)`;
    throw failure;
  }

  return {
    events: plan.events.length,
    byKind,
    refused,
    touched,
    span: { from: new Date(plan.firstDay), to: new Date(Math.max(...plan.events.map((e) => e.at))) },
    historyPlayers: plan.historyCount,
    spikeDays: plan.spikeDays,
    refundsPlanned: plan.counts.refundsPlanned,
    vipGrowth: plan.vipGrowth,
    lump,
  };
}

/**
 * `WalletService.reconcile` for every currency of every demo wallet.
 * @returns {{ checked: number, mismatches: object[] }}
 */
async function reconcileAll({ sequelize, wallet }) {
  const { CURRENCY_COLUMN } = require(path.join(ROOT, 'services/user/src/modules/wallet/wallet.constants'));
  const users = await sequelize.query(
    "SELECT id, name FROM users WHERE name LIKE 'demo\\_%' OR email LIKE 'demo\\_%' ORDER BY id",
    { type: QueryTypes.SELECT }
  );
  if (!users.length) return { checked: 0, wallets: 0, mismatches: [] };
  const ledgerCoins = await sequelize.query(
    'SELECT DISTINCT user_id, upper(currency) AS currency FROM credits_ledger WHERE user_id IN (:ids)',
    { replacements: { ids: users.map((u) => String(u.id)) }, type: QueryTypes.SELECT }
  );
  const coinsOf = new Map();
  for (const r of ledgerCoins) coinsOf.set(r.user_id, [...(coinsOf.get(r.user_id) ?? []), r.currency]);

  const mismatches = [];
  let wallets = 0;
  for (const u of users) {
    const coins = new Set(['INR', ...(coinsOf.get(String(u.id)) ?? [])].filter((c) => CURRENCY_COLUMN[c]));
    for (const currency of coins) {
      const r = await wallet.reconcile({ userId: String(u.id), currency });
      wallets += 1;
      if (!r.balanced) mismatches.push({ name: u.name, currency, balance: r.balance, ledger: r.ledgerSum, drift: r.drift });
    }
  }
  return { checked: users.length, wallets, mismatches };
}

module.exports = {
  runHistory,
  reconcileAll,
  existingHistory,
  createRng,
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
  DEFAULT_HISTORY_SEED,
  HISTORY_TAG: TAG,
};
