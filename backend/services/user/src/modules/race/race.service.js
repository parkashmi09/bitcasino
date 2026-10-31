'use strict';

const { createRewardMoney, USD_CODES } = require('../../lib/rewardMoney');
const { Op } = require('sequelize');
const { money, operatorSettings } = require('@ibitplay/common');
const { notifyBonus } = require('../notifications/notifyPlayer');
const { siteHasNoPromotions, promotionsBlocked } = require('@ibitplay/auth');

const { WalletService } = require('../wallet/wallet.service');
const errors = require('./race.errors');
const { buildRankPrizes, buildCustomLadder } = require('./race.prizes');
const { windowFor, DAY_MS } = require('./race.window');
const {
  RACE_TYPES,
  BOAT_FIELDS,
  MAX_RACE_DAYS,
  RACE_LABEL,
  RACE_STATUS,
  RACE_BUCKETS,
  BUCKET_COLUMN,
  PRIZE_CURRENCY,
  REASON,
  MIN_REWARD,
  PODIUM_SIZE,
} = require('./race.constants');

/**
 * The wagering race.
 *
 * Every bet placed inside a window is converted to USD, multiplied by its game
 * bucket's points rate, and summed per player. The window closes, the top N are
 * paid out of a prize pool, and each prize sits as a claimable row until the
 * player takes it into their wallet.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS A PORT OF, AND WHAT CHANGED
 *
 * A module that had been running in production with four faults that each cost
 * money or credibility. They are fixed here, and each is commented where it
 * was:
 *
 *   THE CLAIM RAN `BEGIN` ON A SHARED CONNECTION. The reference wrapped its
 *   claim in `pg.query('BEGIN') … COMMIT` on a single long-lived `pg.Client`
 *   shared by the whole process — so every unrelated query issued by any other
 *   request while a claim was in flight joined that transaction, and rolled
 *   back with it. Two concurrent claims interleaved their BEGIN/COMMIT on the
 *   same connection with no isolation at all, which made the `FOR UPDATE` in
 *   the middle worthless. `claim()` below is a single conditional UPDATE.
 *
 *   THE "IS THIS RACE OVER" GUARD WAS DEAD CODE. It tested `race.end` against
 *   a SELECT that did not list that column, so the test was always against
 *   `undefined` and never fired. A settled race went on serving live standings
 *   for three days after its cron stopped. `#activeRace` filters on `status`
 *   in SQL, where it cannot be forgotten.
 *
 *   DECORATIVE ENTRIES WON REAL PRIZES. Settlement wrote a reward row for
 *   every board entry including the operator's fake ones, against user ids
 *   that exist in no table — unclaimable money, permanently occupying paid
 *   ranks. `settle()` ranks the board but pays only real players.
 *
 *   AN UNKNOWN CURRENCY SCORED AT 1:1. The points query did
 *   `COALESCE(er.usd_rate, 1)`, so a currency missing from `exchangerate` was
 *   treated as worth a dollar a unit. For a low-value currency that is a
 *   points multiplier of several thousand. `#toUsd` returns null and the row
 *   is excluded and counted, rather than silently winning the race.
 * ═════════════════════════════════════════════════════════════════════════
 */
/** A booked seat is a rank (any free boat) or `{ rank, boatId }` (that boat). */
const seatRank = (seat) => Number(seat?.rank ?? seat);

/**
 * Booked seats as saved: ranks 1..winnerCount, sorted, one entry per rank (a pinned boat beats a
 * plain rank), and a boat pinned to one rank only. Two boats on a rank is refused, not guessed.
 */
function normaliseSeats(seats, winnerCount) {
  const byRank = new Map();
  const boats = new Set();
  for (const seat of seats) {
    const rank = seatRank(seat);
    if (!Number.isInteger(rank) || rank < 1 || rank > winnerCount) continue;
    const boatId = seat?.boatId ?? null;
    if (boatId == null) {
      if (!byRank.has(rank)) byRank.set(rank, rank);
      continue;
    }
    if (boats.has(String(boatId))) throw errors.INVALID_CONFIG({ reason: `boat ${boatId} is booked on two ranks` });
    if (byRank.get(rank)?.boatId != null) throw errors.INVALID_CONFIG({ reason: `rank ${rank} is booked for two boats` });
    boats.add(String(boatId));
    byRank.set(rank, { rank, boatId: Number(boatId) });
  }
  const out = [...byRank.values()].sort((a, b) => seatRank(a) - seatRank(b));
  // Seats are the top ranks with no gap (#1…#n): every real player then ranks under every seat and,
  // the ladder never rising, is paid no more than any seat (owner's rule, 22 Oct 2026).
  const gap = out.findIndex((seat, i) => seatRank(seat) !== i + 1);
  if (gap !== -1) throw errors.INVALID_CONFIG({ reason: `booked seats must be the top ranks with no gap: #1 to #${out.length} (got ${out.map(seatRank).map((r) => `#${r}`).join(', ')})` });
  return out;
}

class RaceService {
  constructor(deps) {
    const { models, db, logger, config, clients } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
    this.wallet = deps.wallet ?? new WalletService(deps);
    this.settings = operatorSettings(deps);
    /** Prizes are USD-designed; paid in the site's reward currency. */
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
  }

  /**
   * A prize row priced for payment. Rows denominated in USD/USDT (every row
   * this module writes — pools and points are USD) are converted into the
   * site's reward currency AT PAYMENT/DISPLAY, so an owner switching the
   * reward currency never re-denominates a pending prize. A row in any other
   * coin (legacy) pays as stated.
   */
  async #priced(amount, currency) {
    const code = String(currency || PRIZE_CURRENCY).toUpperCase();
    if (!USD_CODES.includes(code)) {
      return { currency: code, amount: money.toDecimalString(money.toMinor(String(amount ?? '0'))), usd: null };
    }
    return this.rewardMoney.fromUsd(String(amount ?? '0'));
  }

  /** The operator's `race_timezone`; the deployed RACE_TIMEZONE until they set one. */
  get timeZone() {
    return this.settings.value('race_timezone', this.config?.RACE_TIMEZONE || 'Asia/Kolkata');
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Configuration
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Both races, as a player's client needs them.
   *
   * One request for the whole feature's on/off state, so a front end has a
   * single source of truth for whether to render any of this at all. The
   * multipliers come with it because the "how it works" copy should be read
   * from the configuration rather than typed into the page — the reference's
   * marketing text promised "Sports 3.0x, Slots 4.0x" against a live config of
   * 2.5 and ZERO, and there was no mechanism by which it could ever have been
   * right.
   */
  async listConfigs() {
    const rows = await this.models.RaceConfig.findAll({ order: [['type', 'ASC']], raw: true });
    const byType = new Map(rows.map((r) => [r.type, r]));

    const out = [];
    for (const type of RACE_TYPES) {
      const row = byType.get(type);
      // A type with no row is OFF, not "on by default". The reference treated a
      // missing `enabled` as enabled, which meant a half-applied migration
      // opened a promotion nobody had configured.
      if (!row) {
        out.push({ type, enabled: false, configured: false });
        continue;
      }
      const config = this.#shapeConfig(row);
      out.push({ ...config, configured: true, payout: await this.#payoutOf(config) });
    }
    return out;
  }

  /**
   * The pool and the per-rank prizes as a player will be PAID them: in the
   * site's reward currency (`reward-currency` skill), converted at today's
   * rate. `prizePool` / `rankPrizes` stay USD-denominated beside it, because
   * that is what settlement stores; this is the figure a page should show.
   */
  async #payoutOf(config) {
    const { currency, price } = await this.#payoutPricer(config.currency);
    return {
      currency,
      prizePool: price(config.prizePool),
      netPrizePool: price(config.netPrizePool),
      ranks: config.rankPrizes.map((r) => ({ rank: r.rank, amount: price(r.amount), percentage: r.percentage })),
    };
  }

  /**
   * One conversion for a whole board. `#priced` per row would look the rate up
   * once per rank; this reads it once and divides, which is the same arithmetic
   * `rewardMoney.fromUsd` does (`usd / usd_rate`).
   */
  async #payoutPricer(currency) {
    const dec = (v) => money.toDecimalString(money.toMinor(String(v ?? '0')));
    const code = String(currency || PRIZE_CURRENCY).toUpperCase();
    // A legacy non-USD pool pays as stated, like `#priced`.
    if (!USD_CODES.includes(code)) return { currency: code, price: dec };

    const unit = await this.rewardMoney.fromUsd('1');
    if (USD_CODES.includes(String(unit.currency).toUpperCase())) return { currency: unit.currency, price: dec };
    const rate = await this.rewardMoney.toUsd('1', unit.currency);
    if (!rate || !money.gt(rate, '0')) return { currency: PRIZE_CURRENCY, price: dec };
    return {
      currency: unit.currency,
      price: (v) => money.toDecimalString(money.divide(dec(v), rate)),
    };
  }

  /** @returns the config row, or null. */
  async getConfig({ type }) {
    const row = await this.models.RaceConfig.findOne({ where: { type }, raw: true });
    return row ? this.#shapeConfig(row) : null;
  }

  /**
   * Save one race's configuration.
   *
   * The prize curve is recomputed here and stored. Every reader afterwards uses
   * the stored array — see `race.prizes.js` for why computing it twice was the
   * reference's bug rather than its design.
   */
  async updateConfig({ type, ...input }) {
    const existing = await this.models.RaceConfig.findOne({ where: { type } });
    if (!existing) throw errors.NOT_CONFIGURED({ type });

    const patch = {};
    const assign = (field, column, transform = (v) => v) => {
      if (input[field] !== undefined) patch[column] = transform(input[field]);
    };

    assign('enabled', 'enabled');
    assign('sportsPoints', 'sports_points', String);
    assign('casinoPoints', 'casino_points', String);
    assign('slotPoints', 'slot_points', String);
    assign('crashPoints', 'crash_points', String);
    assign('otherPoints', 'other_points', String);
    assign('prizePool', 'prize_pool');
    assign('platformFeePercent', 'platform_fee_percent', String);
    assign('winnerCount', 'winner_count');
    assign('top3Percentage', 'top3_percentage', String);
    assign('minPoints', 'min_points');
    assign('bookedSeatsEnabled', 'booked_seats_enabled');

    const merged = { ...existing.get({ plain: true }), ...patch };

    /**
     * Seats above the winner count can never be filled — the board is capped at
     * the paid ranks — so keeping them would leave the placement loop looking
     * for a rank that does not exist. Normalised on write, once, rather than
     * defensively re-parsed by every reader (the reference had two independent
     * parsers for this field, in two languages, that had to be kept in step).
     */
    if (input.bookedSeats !== undefined) {
      patch.booked_seats = normaliseSeats(input.bookedSeats, Number(merged.winner_count));
      merged.booked_seats = patch.booked_seats;
    }

    /**
     * The ladder that pays. Three ways, in order:
     *   `rankShares`   the operator's own ladder (sets the ranks paid to its length);
     *   a stored custom ladder, same rank count, no `resetLadder`: re-priced for the new pool;
     *   otherwise the computed curve.
     */
    const stored = Array.isArray(existing.rank_percentage) ? existing.rank_percentage : [];
    const keepCustom = !input.resetLadder && stored.length && stored.every((r) => r?.custom)
      && stored.length === Number(merged.winner_count);
    if (input.rankShares !== undefined || keepCustom) {
      const shares = input.rankShares ?? stored.map((r) => r.percentage);
      const ladder = buildCustomLadder({ prizePool: merged.prize_pool, platformFeePercent: merged.platform_fee_percent, shares });
      if (ladder.error) throw errors.INVALID_CONFIG({ reason: ladder.error });
      patch.rank_percentage = ladder.ranks;
      patch.winner_count = ladder.ranks.length;
      merged.winner_count = ladder.ranks.length;
      if (Array.isArray(merged.booked_seats)) {
        patch.booked_seats = merged.booked_seats.filter((seat) => seatRank(seat) <= ladder.ranks.length);
      }
    } else {
      const { ranks } = buildRankPrizes({
        prizePool: merged.prize_pool,
        winnerCount: merged.winner_count,
        platformFeePercent: merged.platform_fee_percent,
        top3Percentage: merged.top3_percentage,
      });
      patch.rank_percentage = ranks;
    }

    await this.models.RaceConfig.update(patch, { where: { type } });
    const row = await this.models.RaceConfig.findOne({ where: { type }, raw: true });

    /**
     * Switching a race ON opens its window immediately.
     *
     * Without this the promotion is live on the site but has no race to point
     * at until the next midnight — which reads to a player as a broken feature
     * and to an operator as a change that did not take.
     */
    if (patch.enabled === true) await this.openWindow({ type }).catch((error) => {
      this.logger?.error({ err: error, type }, 'Could not open a race window after enabling');
    });

    this.logger?.info({ type, changed: Object.keys(patch) }, 'Race configuration updated');
    // Seats show at once, not at the boat job's next tick (staff save, then look at the board).
    await this.#placeBoatsNow(type);
    return this.#shapeConfig(row);
  }

  async #placeBoatsNow(type) {
    await this.syncBoats({ type }).catch((error) => this.logger?.warn({ err: error, type }, 'Booked seats could not be placed now; the boat job retries'));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The board
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The current standings for one race.
   *
   * @param {object} options
   * @param {'daily'|'weekly'|'monthly'} options.type
   * @param {number|null} [options.userId]  when present, the caller's own row is
   *   resolved even if it falls below the payout line — a player wants to know
   *   where they are, not only whether they are winning.
   * @param {boolean} [options.live]  the window's own wagers even after End & pay (the daily
   *   quests count today's turnover, not the paid rows).
   */
  async leaderboard({ type, userId = null, live = false, staff = false }) {
    const config = await this.getConfig({ type });
    if (!config) throw errors.NOT_CONFIGURED({ type });

    /* The board always runs (owner, 2026-10-19): a switched-off race, or one whose window the job
       has not opened yet, ranks the current window's wagers with no prizes and a 0 pool rather than
       answering "not running". Only an enabled race with an open row is ever settled and paid. */
    const open = config.enabled ? await this.#activeRace(type) : null;
    const window = windowFor(type, new Date(), this.timeZone);

    /* Staff closed this window early (End & pay): it stays ended, with what it paid, until the
       next window opens — not an "Active" recount with a running clock and a 0 pool. */
    const closed = open || live ? null : await this.models.Race.findOne({ where: { type, starts_at: window.startsAt, status: RACE_STATUS.SETTLED }, raw: true });
    if (closed) {
      const board = await this.#settledBoard(closed, config);
      const mine = userId ? board.leaderboard.find((r) => String(r.userId) === String(userId)) : null;
      return {
        ...board,
        leaderboard: staff ? board.leaderboard : await this.#hideNames(board.leaderboard),
        settled: true,
        me: mine ? { rank: mine.rank, points: mine.points, usdWagered: mine.usdWagered, inPrizes: true, payout: mine.payout } : null,
      };
    }

    const race = open ?? { id: null, starts_at: window.startsAt, ends_at: window.endsAt };
    const official = Boolean(open);

    const { entries, unrated } = await this.#standings(race, config);

    const board = official ? await this.#applyBookedSeats(entries, config, type) : entries;
    const paid = board.slice(0, config.winnerCount);

    const prizeByRank = new Map(official ? config.rankPrizes.map((r) => [r.rank, r]) : []);
    const pool = official ? config.prizePool : '0';
    const netPool = official ? config.netPrizePool : '0';
    const payout = await this.#payoutPricer(config.currency);
    const shares = this.#shares(config);

    const rows = paid.map((entry, index) => {
      const rank = index + 1;
      const prize = prizeByRank.get(rank);
      return {
        rank,
        // Null for a decorative entry: it is not a player and has no id a
        // client could look up. `isBoat` says what it is instead.
        userId: entry.isBoat ? null : entry.userId,
        name: entry.name,
        points: entry.points,
        usdWagered: entry.usdWagered,
        bets: entry.bets,
        /**
         * A decorative entry is marked ON THE WIRE. The reference marked them
         * only in the operator's own console, so the player-facing board
         * rendered them identically to real people and no client could have
         * told the difference even if it wanted to.
         */
        isBoat: Boolean(entry.isBoat),
        // A booked seat shows its rank's prize like any player (the reference race); settle() keeps it for the house.
        reward: prize?.amount ?? '0',
        /** `reward` in the reward currency (`payoutCurrency`): what this rank is paid. */
        payout: payout.price(prize?.amount ?? '0'),
        /* The rank's share of the pool, as hash.game prints it beside every prize — also on a
           0 pool or a switched-off race, where the amount is 0 but the ladder still applies. */
        percentage: shares.get(rank) ?? 0,
      };
    });

    /** The caller's own standing, wherever it falls. */
    const meIndex = userId ? board.findIndex((e) => !e.isBoat && String(e.userId) === String(userId)) : -1;

    return {
      raceId: race.id,
      type,
      startsAt: race.starts_at,
      endsAt: race.ends_at,
      /**
       * GROSS and NET, both. The reference returned only the gross pool as
       * `prize_pool` while computing every rank's reward from the net — so the
       * headline said $100 and the ranks added up to $85, with nothing on the
       * wire to explain the gap.
       */
      /* False for the unofficial board above: nothing is paid for it. */
      official,
      prizePool: pool,
      netPrizePool: netPool,
      currency: config.currency,
      payoutCurrency: payout.currency,
      payoutPrizePool: payout.price(pool),
      payoutNetPrizePool: payout.price(netPool),
      multipliers: config.multipliers,
      minPoints: config.minPoints,
      winnerCount: config.winnerCount,
      leaderboard: staff ? rows : await this.#hideNames(rows),
      me:
        meIndex >= 0
          ? {
              rank: meIndex + 1,
              points: board[meIndex].points,
              usdWagered: board[meIndex].usdWagered,
              bets: board[meIndex].bets,
              inPrizes: meIndex < config.winnerCount,
              reward: prizeByRank.get(meIndex + 1)?.amount ?? '0',
              payout: payout.price(meIndex < config.winnerCount ? (prizeByRank.get(meIndex + 1)?.amount ?? '0') : '0'),
            }
          : null,
      /**
       * Turnover that could not be priced, rather than silently counted at 1:1.
       * Zero on a healthy platform; anything else is a currency missing from
       * `exchangerate` and a leaderboard that is quietly incomplete.
       */
      unratedCurrencies: unrated,
    };
  }

  /**
   * The last SETTLED race — hash.game's `<type>/last/`: its #1 is the Last Champion and its paid
   * rows are the History dialog. Read from the race's own reward rows, so an early End & pay shows
   * at once with what was actually paid, and a window where no race ran is an empty board rather
   * than a live recount of that day priced on today's ladder.
   */
  async lastLeaderboard({ type }) {
    const config = await this.getConfig({ type });
    if (!config) throw errors.NOT_CONFIGURED({ type });

    const race = await this.models.Race.findOne({
      where: { type, status: RACE_STATUS.SETTLED },
      // The latest PAID race: one ended early by End & pay keeps its window's later ends_at.
      order: [['settled_at', 'DESC NULLS LAST'], ['ends_at', 'DESC']],
      raw: true,
    });
    if (!race) {
      const payout = await this.#payoutPricer(config.currency);
      return {
        raceId: null, type, startsAt: null, endsAt: null, official: false,
        payoutCurrency: payout.currency, payoutPrizePool: payout.price('0'), winnerCount: 0, leaderboard: [],
      };
    }
    const board = await this.#settledBoard(race, config);
    return { ...board, leaderboard: await this.#hideNames(board.leaderboard) };
  }

  /** A settled race as a board: its paid rows in rank order, priced as the claim pays them. */
  async #settledBoard(race, config) {
    const rewards = await this.models.RaceReward.findAll({ where: { race_id: race.id }, order: [['rank', 'ASC']], raw: true });
    const names = await this.#namesFor(rewards.map((r) => r.user_id));
    // A settled race keeps the ladder it paid by.
    const shares = this.#shares(race.snapshot?.rankPrizes?.length ? { ...config, rankPrizes: race.snapshot.rankPrizes } : config);
    const payout = await this.#payoutPricer(config.currency);

    const rows = [];
    for (const r of rewards) {
      const points = money.toDecimalString(money.toMinor(r.points ?? '0'));
      rows.push({
        rank: Number(r.rank),
        userId: r.user_id,
        name: names.get(String(r.user_id)) ?? null,
        points,
        usdWagered: points,
        isBoat: false,
        payout: (await this.#priced(r.amount, r.currency)).amount,
        percentage: shares.get(Number(r.rank)) ?? 0,
      });
    }

    for (const b of race.snapshot?.boats ?? []) {
      const points = money.toDecimalString(money.toMinor(b.points ?? '0'));
      rows.push({
        rank: Number(b.rank),
        userId: null,
        name: b.name,
        points,
        usdWagered: points,
        isBoat: true,
        payout: (await this.#priced(b.amount ?? '0', config.currency)).amount,
        percentage: shares.get(Number(b.rank)) ?? 0,
      });
    }
    rows.sort((a, b) => a.rank - b.rank);

    return {
      raceId: race.id,
      type: race.type,
      startsAt: race.starts_at,
      endsAt: race.ends_at,
      settledAt: race.settled_at,
      official: true,
      payoutCurrency: payout.currency,
      payoutPrizePool: payout.price(race.prize_pool ?? '0'),
      winnerCount: Number(race.winner_count) || rows.length,
      leaderboard: rows,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Windows
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Make sure the window containing `at` exists and is open.
   *
   * Idempotent by construction: `uq_races_window` means a second caller for the
   * same window gets a unique violation rather than a duplicate, and a second
   * OPEN race of the same type is refused by `uq_races_open`. The reference
   * expressed both as follow-up UPDATE statements with nothing enforcing them.
   */
  async openWindow({ type, at = new Date() }) {
    const config = await this.getConfig({ type });
    if (!config?.enabled) return null;

    const { startsAt, endsAt } = windowFor(type, at, this.timeZone);

    const existing = await this.models.Race.findOne({ where: { type, starts_at: startsAt }, raw: true });
    if (existing) return existing;

    try {
      const created = await this.models.Race.create({
        type,
        starts_at: startsAt,
        ends_at: endsAt,
        status: RACE_STATUS.OPEN,
      });
      this.logger?.info({ type, raceId: created.id, startsAt, endsAt }, 'Race window opened');
      return created.get({ plain: true });
    } catch (error) {
      /**
       * Either index can reject this, and both mean the same thing: somebody
       * else opened this window first. That is the correct outcome of two
       * workers racing, not an error to propagate.
       */
      if (error?.name === 'SequelizeUniqueConstraintError') {
        return this.models.Race.findOne({ where: { type, status: RACE_STATUS.OPEN }, raw: true });
      }
      throw error;
    }
  }

  /**
   * A staff test race: the window staff pick instead of `windowFor`'s, marked `snapshot.test`.
   *
   * It is an ordinary OPEN race, so standings, booked seats, End & pay and `settleDue` need
   * nothing new. While it is open `openWindow` hits `uq_races_open` and returns it; once it is
   * settled the normal window opens again (daily: its starts_at differs from midnight's).
   */
  async startTestRace({ type, startsAt, endsAt }) {
    const config = await this.getConfig({ type });
    if (!config?.enabled) throw errors.NOT_RUNNING({ type });

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const maxMs = MAX_RACE_DAYS[type] * DAY_MS;
    if (!(end > new Date())) throw errors.INVALID_WINDOW({ reason: 'endsAt must be in the future' });
    if (!(start < end)) throw errors.INVALID_WINDOW({ reason: 'startsAt must be before endsAt' });
    if (end - start > maxMs) throw errors.INVALID_WINDOW({ reason: `a ${type} race is at most ${maxMs / DAY_MS} day(s)` });

    if (await this.#activeRace(type)) throw errors.ALREADY_OPEN({ type });
    if (await this.models.Race.findOne({ where: { type, starts_at: start }, attributes: ['id'], raw: true })) {
      throw errors.INVALID_WINDOW({ reason: 'a race of that type already starts at that time' });
    }

    try {
      const created = await this.models.Race.create({
        type, starts_at: start, ends_at: end, status: RACE_STATUS.OPEN, snapshot: { test: true },
      });
      this.logger?.info({ type, raceId: created.id, startsAt: start, endsAt: end }, 'Test race opened');
      await this.#placeBoatsNow(type);
      return created.get({ plain: true });
    } catch (error) {
      // Lost to the roll job (or a second click) opening a race between the checks and the insert.
      if (error?.name === 'SequelizeUniqueConstraintError') throw errors.ALREADY_OPEN({ type });
      throw error;
    }
  }

  /**
   * Close a finished window, write its prizes, and open the next.
   *
   * ── THE ORDER MATTERS ────────────────────────────────────────────────
   *
   * The next window is opened whether or not settlement succeeded. A race that
   * fails to settle must not also stop the promotion: the reference got this
   * right and it is worth keeping — an operator can re-run a settlement, but
   * nobody can retroactively give players back a day of racing.
   */
  async settleDue({ type, at = new Date() }) {
    const config = await this.getConfig({ type });
    if (!config?.enabled) return { settled: null, opened: null };

    const due = await this.models.Race.findOne({
      where: { type, status: RACE_STATUS.OPEN, ends_at: { [Op.lte]: at } },
      raw: true,
    });

    let settled = null;
    if (due) {
      try {
        settled = await this.settle({ raceId: due.id });
      } catch (error) {
        this.logger?.error({ err: error, type, raceId: due.id }, 'Race settlement failed — opening the next window anyway');
      }
    }

    const opened = await this.openWindow({ type, at });
    return { settled, opened };
  }

  /**
   * Settle one race: rank the board, write the prizes, close the window.
   *
   * ── ONE STATEMENT FOR EVERY REWARD ───────────────────────────────────
   *
   * The reference inserted rewards one row at a time, outside any transaction,
   * with `console.error` as the failure handler. Given `UNIQUE (race_id,
   * user_id)`, a run that died half way threw on every row it had already
   * written when retried — and because its re-entry check only asked whether
   * ANY reward existed for the race, a partial settlement could never be
   * completed. One `bulkCreate` with `ignoreDuplicates`, inside the same
   * transaction that closes the window.
   */
  async settle({ raceId }) {
    const race = await this.models.Race.findByPk(raceId, { raw: true });
    if (!race) throw errors.NO_ACTIVE_RACE({ raceId });
    // Only an OPEN race settles: a cancelled one was closed with no prizes on purpose, and a
    // settled one re-ranked later (a sports bet settling after the window) would pay new players.
    if (race.status !== RACE_STATUS.OPEN) throw errors.NOT_OPEN({ raceId, status: race.status });

    const config = await this.getConfig({ type: race.type });
    if (!config) throw errors.NOT_CONFIGURED({ type: race.type });

    // Re-seat the boats on the final standings first, so a player who overtook one in the last
    // minute before the close cannot take a booked rank (the boat job runs once a minute).
    if (config.bookedSeatsEnabled) await this.#placeBoatsNow(race.type);
    const { entries } = await this.#standings(race, config);

    /**
     * Paid as the board shows it, booked seats included (the reference race, playbro racePramotion):
     * a booked seat holds its rank and that rank's prize is kept by the house, and every real
     * player is paid the rank they see. Placed before the boats reset below.
     */
    const board = await this.#applyBookedSeats(entries, config, race.type);
    // Races sirf direct users ke (board pe child user aata hi nahi); B2B site par koi prize nahi.
    const payable = [];
    for (const e of board) {
      if (payable.length >= config.winnerCount) break;
      if (!e.isBoat && (!money.gte(e.points, config.minPoints) || (await promotionsBlocked(e.userId)))) continue;
      payable.push(e);
    }

    const prizeByRank = new Map(config.rankPrizes.map((r) => [r.rank, r]));

    /* A B2B site has no promotions for anybody: the window still closes (so the next one opens
       on time) but writes no prizes. A read that fails counts as B2B — it pays nothing. */
    const noPromotions = await siteHasNoPromotions().catch(() => true);
    if (noPromotions) this.logger?.info({ raceId: race.id, type: race.type }, 'Race settled without prizes: promotions are off on a B2B site');

    const rewards = [];
    for (let i = 0; i < (noPromotions ? 0 : payable.length); i += 1) {
      const prize = prizeByRank.get(i + 1);
      // A taper across hundreds of ranks reaches amounts below a cent. Those
      // rows cost a claim each and credit nothing.
      if (!prize || money.lt(prize.amount, MIN_REWARD)) break;
      if (payable[i].isBoat) continue; // the house keeps a booked seat's prize

      rewards.push({
        race_id: race.id,
        user_id: payable[i].userId,
        type: race.type,
        rank: i + 1,
        points: payable[i].points,
        currency: config.currency,
        amount: prize.amount,
      });
    }

    const totalAwarded = money.toDecimalString(money.sum(rewards.map((r) => r.amount)));
    // The booked seats as they stood at the close, so a finished race's board and history show them
    // where players saw them (the house keeps their prizes; no reward row is written for them).
    const seatedBoats = noPromotions ? [] : payable
      .map((e, i) => (e.isBoat ? { rank: i + 1, name: e.name, points: e.points, amount: prizeByRank.get(i + 1)?.amount ?? '0' } : null))
      .filter(Boolean);

    await this.db.transaction(async (transaction) => {
      /* The close is the claim: `status = open` in the WHERE, first, so of two settlements racing
         (the worker and staff's End & pay) exactly one closes the race and writes prizes; the
         other blocks on the row, matches nothing and rolls back. */
      const [closed] = await this.models.Race.update(
        {
          status: RACE_STATUS.SETTLED,
          settled_at: new Date(),
          /**
           * The configuration AS IT WAS. Changing the multipliers tomorrow must
           * not rewrite what this race paid, and a support desk asked "why did
           * rank 4 get $6.68" needs the answer that applied then.
           */
          snapshot: {
            multipliers: config.multipliers,
            top3Percentage: config.top3Percentage,
            minPoints: config.minPoints,
            rankPrizes: config.rankPrizes,
            bookedSeats: config.bookedSeatsEnabled ? config.bookedSeats : [],
            boats: seatedBoats,
            ...(race.snapshot?.test ? { test: true } : {}), // the TEST badge outlives settlement
          },
          prize_pool: config.prizePool,
          platform_fee_percent: config.platformFeePercent,
          winner_count: config.winnerCount,
          total_awarded: totalAwarded,
        },
        { where: { id: race.id, status: RACE_STATUS.OPEN }, transaction }
      );
      if (closed !== 1) throw errors.NOT_OPEN({ raceId: race.id, status: 'settled' });

      if (rewards.length) {
        await this.models.RaceReward.bulkCreate(rewards, { transaction, ignoreDuplicates: true });
      }

      /** Decorative entries reset with the race they were placed in. */
      if (config.bookedSeatsEnabled) {
        await this.models.RaceBoat.update(
          { [BOAT_FIELDS[race.type].points]: '0', [BOAT_FIELDS[race.type].rank]: null },
          { where: {}, transaction }
        );
      }
    });

    this.logger?.info(
      { raceId: race.id, type: race.type, winners: rewards.length, totalAwarded },
      'Race settled'
    );

    return { raceId: race.id, type: race.type, winners: rewards.length, totalAwarded };
  }

  /**
   * Close an open race with NO prizes (staff, audited): a race opened by mistake or with the
   * wrong pool. The window stays used (`uq_races_window`), so the next race opens with the next
   * window; switch the config off first to stop races altogether.
   */
  async cancel({ raceId, reason = null }) {
    const [count] = await this.models.Race.update(
      {
        status: RACE_STATUS.CANCELLED,
        settled_at: new Date(),
        total_awarded: '0',
        // Overwrites a test race's snapshot; acceptable, a cancelled race pays nothing anyway.
        snapshot: { cancelled: true, reason: reason || null },
      },
      { where: { id: raceId, status: RACE_STATUS.OPEN } }
    );
    if (!count) {
      const race = await this.models.Race.findByPk(raceId, { attributes: ['id', 'status'], raw: true });
      if (!race) throw errors.NO_ACTIVE_RACE({ raceId });
      throw errors.NOT_OPEN({ raceId, status: race.status });
    }
    const race = await this.models.Race.findByPk(raceId, { raw: true });
    const config = await this.getConfig({ type: race.type });
    if (config?.bookedSeatsEnabled) {
      await this.models.RaceBoat.update(
        { [BOAT_FIELDS[race.type].points]: '0', [BOAT_FIELDS[race.type].rank]: null },
        { where: {} }
      );
    }
    this.logger?.info({ raceId, type: race.type, reason }, 'Race cancelled');
    return { raceId: race.id, type: race.type, status: race.status };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Prizes
  // ══════════════════════════════════════════════════════════════════════

  /** A player's own prizes, claimed and not. */
  async myRewards({ userId, type, claimed, limit = 50, offset = 0 }) {
    const where = { user_id: userId };
    if (type) where.type = type;
    if (claimed !== undefined) where.claimed = claimed === 'true' || claimed === true;

    const { rows, count } = await this.models.RaceReward.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const races = await this.#racesByIds(rows.map((r) => r.race_id));

    /**
     * The unclaimed total, alongside the page.
     *
     * A client showing "you have prizes waiting" cannot compute that from one
     * page of rows, and the reference made it fetch every reward it had in
     * order to add them up.
     */
    const pending = await this.models.RaceReward.findAll({
      where: { user_id: userId, claimed: false },
      attributes: ['amount', 'currency'],
      raw: true,
    });

    let unclaimedTotal = '0.00000000';
    for (const p of pending) {
      const quote = await this.#priced(p.amount, p.currency);
      unclaimedTotal = money.toDecimalString(money.add(unclaimedTotal, quote.amount));
    }
    const shaped = [];
    for (const r of rows) {
      const row = this.#shapeReward(r, races.get(String(r.race_id)));
      const quote = await this.#priced(r.amount, r.currency);
      shaped.push({ ...row, amount: quote.amount, currency: quote.currency, amountUsd: quote.usd });
    }

    return {
      total: count,
      unclaimedTotal,
      unclaimedCount: pending.length,
      currency: await this.rewardMoney.currency(),
      rows: shaped,
    };
  }

  /**
   * Take a prize into the wallet.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ONE CONDITIONAL UPDATE, NOT A TRANSACTION ON A SHARED CONNECTION
   *
   * The reference did this:
   *
   *     await pg.query('BEGIN');
   *     … SELECT … FOR UPDATE … UPDATE credits … UPDATE race_rewards …
   *     await pg.query('COMMIT');
   *
   * on a single `pg.Client` shared by every module in the process. That opens
   * a transaction across the WHOLE PROCESS: any unrelated query issued by any
   * other request while a claim was in flight silently joined it, and rolled
   * back with it if the claim failed. Two claims arriving together interleaved
   * their BEGIN and COMMIT on the same connection, so there was no isolation
   * for the `FOR UPDATE` to provide.
   *
   * `UPDATE … WHERE id = ? AND claimed = false RETURNING *` decides the race in
   * Postgres, in one statement. Exactly one caller gets a row back; everyone
   * else gets zero and is refused. The wallet credit then runs through the one
   * code path on this platform that takes a row lock, writes a ledger row and
   * carries an idempotency key.
   *
   * ── AND THE FLAG IS SET BEFORE THE MONEY MOVES ─────────────────────────
   *
   * Deliberately. If the credit then fails, the prize is marked claimed and
   * unpaid — visible, and recoverable by an operator. The other order fails the
   * other way: paid and still claimable, which pays again on every retry. The
   * idempotency key makes the double-credit impossible anyway; this makes the
   * remaining failure the one that does not cost money.
   * ═══════════════════════════════════════════════════════════════════════
   */
  async claim({ userId, rewardId }) {
    const reward = await this.models.RaceReward.findOne({
      where: { id: rewardId, user_id: userId },
      raw: true,
    });

    // Scoped to the caller, so a reward belonging to someone else is a 404 and
    // not a 403 — an id-guessing probe learns nothing from the difference.
    if (!reward) throw errors.REWARD_NOT_FOUND({ rewardId });
    if (reward.claimed) throw errors.ALREADY_CLAIMED({ rewardId });

    const claimedAt = new Date();
    const [affected] = await this.models.RaceReward.update(
      { claimed: true, claimed_at: claimedAt },
      { where: { id: rewardId, user_id: userId, claimed: false } }
    );

    if (affected !== 1) throw errors.ALREADY_CLAIMED({ rewardId });

    const payout = await this.#priced(reward.amount, reward.currency);
    const movement = await this.wallet.credit(
      {
        userId,
        currency: payout.currency,
        amount: payout.amount,
        reason: REASON.CLAIM,
        /**
         * The reward's own id. Unlike a rakeback accrual — which has no
         * identity once consumed and has to bucket its key by the minute — a
         * race prize is a row, so the key is exact: a replay returns the
         * original movement no matter how much later it arrives.
         */
        idempotencyKey: `race-reward:${reward.id}`,
        refType: 'RACE_REWARD',
        refId: String(reward.id),
        description: `${RACE_LABEL[reward.type] ?? 'Daily'} race — rank ${reward.rank}`,
      },
      { sourceService: 'user-service' }
    );

    /** Recorded on the row so a support desk can see the movement without a join. */
    await this.models.RaceReward.update(
      { balance_before: movement.previousBalance ?? null, balance_after: movement.newBalance ?? null },
      { where: { id: reward.id } }
    );

    this.logger?.info(
      { userId: String(userId), rewardId: reward.id, amount: String(reward.amount), ledgerId: movement.ledgerId },
      'Race reward claimed'
    );
    void notifyBonus(userId, { key: `race-reward:${reward.id}`, title: 'Race reward claimed', amount: payout.amount, currency: payout.currency });

    return {
      rewardId: reward.id,
      type: reward.type,
      rank: reward.rank,
      amount: payout.amount,
      amountUsd: payout.usd,
      currency: payout.currency,
      newBalance: movement.newBalance,
      claimedAt,
    };
  }

  /** Every prize, for the operator's console. */
  async listRewards({ type, userId, raceId, claimed, limit = 50, offset = 0 }) {
    const where = {};
    if (type) where.type = type;
    if (raceId) where.race_id = raceId;
    if (userId) where.user_id = userId;
    if (claimed !== undefined) where.claimed = claimed === 'true' || claimed === true;

    const { rows, count } = await this.models.RaceReward.findAndCountAll({
      where,
      // Newest race first (ids are issued as races open), then its ranks in order.
      order: [['race_id', 'DESC'], ['rank', 'ASC']],
      limit,
      offset,
      raw: true,
    });

    const races = await this.#racesByIds(rows.map((r) => r.race_id));
    const names = await this.#namesFor(rows.map((r) => r.user_id));

    return {
      total: count,
      summary: await this.#rewardSummary(where),
      rows: rows.map((r) => ({
        ...this.#shapeReward(r, races.get(String(r.race_id))),
        userId: String(r.user_id),
        // A rewards list keyed only by numeric id cannot be read by a person.
        username: names.get(String(r.user_id)) ?? null,
      })),
    };
  }

  /**
   * Claimed / not claimed totals for the same filters as the list, every page.
   * Amounts are the stored prize amounts, in the rows' own currency (what the
   * table prints). shortcut: rows in another currency than the first are not
   * summed in; every row this module writes is USDT.
   */
  async #rewardSummary(where) {
    const { fn, col } = this.models.RaceReward.sequelize;
    const [groups, winners] = await Promise.all([
      this.models.RaceReward.findAll({
        where,
        attributes: ['claimed', 'currency', [fn('COUNT', col('id')), 'count'], [fn('SUM', col('amount')), 'amount']],
        group: ['claimed', 'currency'],
        raw: true,
      }),
      this.models.RaceReward.count({ where, distinct: true, col: 'user_id' }),
    ]);

    const currency = groups[0]?.currency || PRIZE_CURRENCY;
    const bucket = (claimed) => {
      const mine = groups.filter((g) => Boolean(g.claimed) === claimed && (g.currency || PRIZE_CURRENCY) === currency);
      return {
        count: mine.reduce((n, g) => n + Number(g.count), 0),
        amount: money.toDecimalString(mine.reduce((sum, g) => money.add(sum, String(g.amount ?? '0')), 0n)),
      };
    };
    const claimed = bucket(true);
    const unclaimed = bucket(false);

    return {
      winners,
      claimed,
      unclaimed,
      total: {
        count: claimed.count + unclaimed.count,
        amount: money.toDecimalString(money.add(claimed.amount, unclaimed.amount)),
      },
      currency,
    };
  }

  /** Past races, newest first. */
  async listRaces({ type, limit = 20, offset = 0 }) {
    const { rows, count } = await this.models.Race.findAndCountAll({
      where: type ? { type } : {},
      order: [['starts_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        type: r.type,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        status: r.status,
        settledAt: r.settled_at,
        prizePool: money.toDecimalString(money.toMinor(r.prize_pool ?? '0')),
        winnerCount: r.winner_count,
        totalAwarded: money.toDecimalString(money.toMinor(r.total_awarded ?? '0')),
        cancelReason: r.status === RACE_STATUS.CANCELLED ? (r.snapshot?.reason ?? null) : undefined,
        test: Boolean(r.snapshot?.test),
      })),
    };
  }

  /**
   * Finished races for the player-facing page, newest first.
   *
   * Public, like the board: what a race paid and who took the podium is the
   * same marketing as the live standings. Amounts are the stored prize rows
   * priced as `myRewards` prices them, so "rank 1 won $50" here and in the
   * winner's own rewards list are the same figure. A booked seat is never paid (see `settle`) but
   * shows on the podium where it stood, from the race's snapshot.
   *
   * @param {number|null} [options.userId]  adds the caller's own placing, if any.
   */
  async history({ type, limit = 10, userId = null }) {
    const where = { status: RACE_STATUS.SETTLED };
    if (type) where.type = type;

    // Newest PAID first, as Last Champion: an End & pay'd race keeps its window's later ends_at.
    const races = await this.models.Race.findAll({ where, order: [['settled_at', 'DESC NULLS LAST'], ['ends_at', 'DESC']], limit, raw: true });
    if (!races.length) return [];
    const ids = races.map((r) => r.id);

    const podium = await this.models.RaceReward.findAll({
      where: { race_id: ids, rank: { [Op.lte]: PODIUM_SIZE } },
      order: [['rank', 'ASC']],
      raw: true,
    });
    const counts = await this.models.RaceReward.count({ where: { race_id: ids }, group: ['race_id'] });
    const countBy = new Map((counts ?? []).map((c) => [String(c.race_id), Number(c.count)]));
    const mine = userId
      ? await this.models.RaceReward.findAll({ where: { race_id: ids, user_id: userId }, raw: true })
      : [];
    const mineBy = new Map(mine.map((r) => [String(r.race_id), r]));
    const real = await this.#namesFor(podium.map((r) => r.user_id));
    const names = new Map((await this.#hideNames([...real].map(([id, name]) => ({ userId: id, name })))).map((r) => [r.userId, r.name]));

    const out = [];
    for (const race of races) {
      const winners = [];
      for (const r of podium.filter((p) => String(p.race_id) === String(race.id))) {
        const quote = await this.#priced(r.amount, r.currency);
        winners.push({
          rank: r.rank,
          name: names.get(String(r.user_id)) ?? null,
          points: money.toDecimalString(money.toMinor(r.points ?? '0')),
          amount: quote.amount,
          currency: quote.currency,
        });
      }
      for (const b of (race.snapshot?.boats ?? []).filter((x) => Number(x.rank) <= PODIUM_SIZE)) {
        const quote = await this.#priced(b.amount ?? '0', PRIZE_CURRENCY);
        winners.push({ rank: Number(b.rank), name: b.name, points: money.toDecimalString(money.toMinor(b.points ?? '0')), amount: quote.amount, currency: quote.currency });
      }
      winners.sort((a, b) => a.rank - b.rank);
      const own = mineBy.get(String(race.id));
      const pool = await this.#priced(race.prize_pool ?? '0', PRIZE_CURRENCY);
      const awarded = await this.#priced(race.total_awarded ?? '0', PRIZE_CURRENCY);
      out.push({
        raceId: race.id,
        type: race.type,
        startsAt: race.starts_at,
        endsAt: race.ends_at,
        settledAt: race.settled_at,
        currency: pool.currency,
        prizePool: pool.amount,
        totalAwarded: awarded.amount,
        winnerCount: Number(race.winner_count ?? 0),
        paidCount: countBy.get(String(race.id)) ?? 0,
        winners,
        me: own ? { rank: own.rank, ...(await this.#priced(own.amount, own.currency)) } : null,
      });
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Decorative entries
  // ══════════════════════════════════════════════════════════════════════

  async listBoats() {
    const rows = await this.models.RaceBoat.findAll({ order: [['id', 'ASC']], raw: true });
    return rows.map((r) => this.#shapeBoat(r));
  }

  async addBoat({ name, isActive = true }) {
    const row = await this.models.RaceBoat.create({ name, is_active: isActive });
    return this.#shapeBoat(row.get({ plain: true }));
  }

  async updateBoat({ id, ...input }) {
    const patch = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const [affected] = await this.models.RaceBoat.update(patch, { where: { id } });
    if (!affected) throw errors.REWARD_NOT_FOUND({ id });

    const row = await this.models.RaceBoat.findByPk(id, { raw: true });
    return this.#shapeBoat(row);
  }

  async removeBoat({ id }) {
    const deleted = await this.models.RaceBoat.destroy({ where: { id } });
    if (!deleted) throw errors.REWARD_NOT_FOUND({ id });
    return { id, deleted: true };
  }

  /**
   * Park a decorative entry just above whoever holds each booked rank.
   *
   * Runs on a timer, so the placements track the real board as it moves. Walks
   * the booked ranks ASCENDING and re-sorts after each placement, because
   * placing a seat at rank 3 changes who is at rank 5.
   */
  async syncBoats({ type }) {
    const config = await this.getConfig({ type });
    if (!config?.enabled || !config.bookedSeatsEnabled || !config.bookedSeats.length) return { placed: 0 };

    const race = await this.#activeRace(type);
    if (!race) return { placed: 0 };

    const { entries } = await this.#standings(race, config);
    const pointsField = BOAT_FIELDS[type].points;
    const rankField = BOAT_FIELDS[type].rank;

    const boats = await this.models.RaceBoat.findAll({
      where: { is_active: true },
      order: [['id', 'ASC']],
      raw: true,
    });

    /**
     * Placement starts from the REAL board every tick.
     *
     * `#standings` returns players only, so there is never a decorative entry
     * already sitting at a booked rank to leave alone — the reference carried a
     * "is this seat already taken by one of ours" branch, and against a board
     * built the same way it could not fire. Recomputing is also the correct
     * behaviour rather than merely the simpler one: a seat is a position
     * relative to live players, and players move.
     */
    const board = [...entries].sort((a, b) => money.compare(b.points, a.points));
    const used = new Set();
    const writes = [];

    /* A pinned boat (`{ rank, boatId }`) is kept for its own rank, so a plain seat above it never
       takes it; an inactive or deleted pinned boat is not in `boats` and its seat gets any free one. */
    const pinned = new Set(config.bookedSeats.map((s) => s?.boatId).filter((b) => b != null).map(String));
    const seats = [...config.bookedSeats].sort((a, b) => seatRank(a) - seatRank(b));

    for (const entry of seats) {
      const seat = seatRank(entry);
      // A seat above the payout line can never be filled: the board is capped
      // at `winner_count`. Saved configs are already filtered, so this catches
      // a winner count that was lowered afterwards.
      if (seat > config.winnerCount) continue;

      const occupant = board[seat - 1];
      const free = (b) => !used.has(String(b.id));
      const boat = (entry?.boatId != null && boats.find((b) => String(b.id) === String(entry.boatId) && free(b)))
        || boats.find((b) => free(b) && !pinned.has(String(b.id)))
        || boats.find(free);
      if (!boat) {
        // Loud: the board silently stops honouring booked seats past this
        // point, which looks like the feature not working rather than a
        // shortage of rows to work with.
        this.logger?.warn({ type, seat }, 'Not enough race boats for the booked seats — add more');
        break;
      }
      used.add(String(boat.id));

      const points = this.#boostPoints(occupant?.points ?? '0', board[seat - 2]?.points ?? null);

      writes.push({ id: boat.id, points, rank: seat });
      board.splice(seat - 1, 0, {
        userId: null, boatId: boat.id, name: boat.name, points, usdWagered: points, bets: 0, isBoat: true,
      });
    }

    for (const write of writes) {
      await this.models.RaceBoat.update(
        { [pointsField]: write.points, [rankField]: write.rank },
        { where: { id: write.id } }
      );
    }

    /** Anything not placed this pass drops off the board rather than lingering. */
    const idle = boats.filter((b) => !used.has(String(b.id))).map((b) => b.id);
    if (idle.length) {
      await this.models.RaceBoat.update(
        { [pointsField]: '0', [rankField]: null },
        { where: { id: idle } }
      );
    }

    return { placed: writes.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Internals
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The open race of a type, if there is one.
   *
   * `status` is in the WHERE clause, not tested in JavaScript against a column
   * somebody might forget to select. That omission is exactly what left the
   * reference serving a three-day-old race as if it were live.
   */
  async #activeRace(type) {
    return this.models.Race.findOne({
      where: { type, status: RACE_STATUS.OPEN },
      order: [['starts_at', 'DESC']],
      raw: true,
    });
  }

  /**
   * Every player's points for a race, ranked.
   *
   * Casino and sports each report their own turnover for the window; this
   * converts to USD, applies the operator's per-bucket multipliers, and sums.
   */
  async #standings(race, config) {
    const window = { from: new Date(race.starts_at).toISOString(), to: new Date(race.ends_at).toISOString() };

    /**
     * Both services in parallel, and NEITHER is allowed to fail quietly.
     *
     * A leaderboard missing one source is not a smaller leaderboard, it is a
     * wrong one — the players who only bet on sports simply vanish. So a
     * failure propagates and the endpoint errors, rather than rendering a board
     * that looks complete.
     */
    const [casino, sports] = await Promise.all([
      this.clients.casino.get('/internal/casino/wager/race-points', { query: window }),
      this.clients.sports.get('/internal/sports/wager/race-points', { query: window }),
    ]);

    const rates = await this.#usdRates();
    const totals = new Map();
    const unrated = new Map();

    const add = (userId, usd, bucket, bets) => {
      const multiplier = config.multipliers[bucket] ?? '0';
      const key = String(userId);
      const current = totals.get(key) ?? { userId: key, usdWagered: 0n, points: 0n, bets: 0 };
      current.usdWagered += money.toMinor(usd);
      current.points += money.multiply(usd, multiplier);
      current.bets += bets;
      totals.set(key, current);
    };

    for (const row of casino?.rows ?? []) {
      const usd = this.#toUsd(row.amount, row.currency, rates);
      if (usd === null) {
        // Counted, not guessed. The reference's `COALESCE(usd_rate, 1)` treated
        // an unpriced currency as a dollar a unit, which for a low-value
        // currency is a points multiplier in the thousands.
        unrated.set(row.currency, (unrated.get(row.currency) ?? 0) + row.bets);
        continue;
      }
      add(row.userId, usd, row.bucket, row.bets);
    }

    // Sports is already priced — converted at stake time by the service that
    // placed the bet. See its `racePoints`.
    for (const row of sports?.rows ?? []) add(row.userId, row.usd, 'sports', row.bets);

    // Races are for direct users only: an agent-tree player is not on the board at all.
    const names = await this.#namesFor([...totals.keys()], { direct: true });

    const entries = [...totals.values()]
      .filter((t) => names.has(t.userId))
      .map((t) => ({
        userId: t.userId,
        name: names.get(t.userId) ?? null,
        points: money.toDecimalString(t.points),
        usdWagered: money.toDecimalString(t.usdWagered),
        bets: t.bets,
        isBoat: false,
      }))
      .filter((e) => money.gt(e.points, '0'))
      .sort((a, b) => money.compare(b.points, a.points) || Number(a.userId) - Number(b.userId));

    return {
      entries,
      unrated: [...unrated.entries()].map(([currency, bets]) => ({ currency, bets })),
    };
  }

  /**
   * Merge the currently-placed decorative entries into a ranked board.
   *
   * Reads their points from `race_boats` rather than recomputing a placement,
   * so what a player sees is what `syncBoats` last decided — two callers
   * computing a placement independently is how a board ends up showing a
   * different order to two people looking at the same race.
   */
  async #applyBookedSeats(entries, config, type) {
    if (!config.bookedSeatsEnabled) return entries;

    const pointsField = BOAT_FIELDS[type].points;
    const rankField = BOAT_FIELDS[type].rank;

    const placed = await this.models.RaceBoat.findAll({
      where: { is_active: true, [rankField]: { [Op.ne]: null } },
      order: [[rankField, 'ASC']],
      raw: true,
    });

    const board = [...entries];

    for (const row of placed) {
      const boat = { id: row.id, name: row.name, points: money.toDecimalString(money.toMinor(row[pointsField] ?? '0')) };
      if (money.lte(boat.points, '0')) continue;
      board.push({
        userId: null,
        boatId: boat.id,
        name: boat.name,
        points: boat.points,
        // Wager = points, as the reference race shows a booked seat (it has no bets behind it).
        usdWagered: boat.points,
        bets: 0,
        isBoat: true,
      });
    }

    return board.sort((a, b) => money.compare(b.points, a.points));
  }

  /** `usd_rate` is USD per 1 unit of the currency. */
  async #usdRates() {
    const rows = await this.models.Exchangerate.findAll({ raw: true });
    const rates = new Map();
    for (const row of rows) {
      const rate = Number(row.usd_rate);
      if (Number.isFinite(rate) && rate > 0) rates.set(String(row.currency).toUpperCase(), String(row.usd_rate));
    }
    return rates;
  }

  /** Null when the currency has no rate — the caller decides what that means. */
  #toUsd(amount, currency, rates) {
    const upper = String(currency).toUpperCase();
    if (upper === 'USD' || upper === 'USDT') return money.toDecimalString(money.toMinor(amount));

    const rate = rates.get(upper);
    if (!rate) return null;
    return money.toDecimalString(money.multiply(amount, rate));
  }

  /**
   * Where to place a decorative entry so it sits at a given rank.
   *
   * Between the rank above and the player it is displacing, so the ordering is
   * strict and the entry does not tie with anyone. With nobody above, a small
   * margin over the displaced player.
   */
  #boostPoints(realPoints, upperPoints) {
    const real = money.toMinor(realPoints ?? '0');

    if (upperPoints !== null && money.gt(upperPoints, realPoints)) {
      return money.toDecimalString((real + money.toMinor(upperPoints)) / 2n);
    }

    // A board where nobody has scored yet: any positive number ranks first.
    if (real <= 0n) return money.toDecimalString(money.toMinor('1'));

    const margin = money.percentOf(real, 5);
    return money.toDecimalString(real + (margin > 0n ? margin : 1n));
  }

  async #namesFor(userIds, { direct = false } = {}) {
    const ids = [...new Set(userIds.map(String))].filter(Boolean);
    if (!ids.length) return new Map();

    const users = await this.models.Users.findAll({
      where: { id: ids, ...(direct ? { parent_staff_id: null } : {}) },
      attributes: ['id', 'name'],
      raw: true,
    });
    return new Map(users.map((u) => [String(u.id), u.name ?? null]));
  }

  /**
   * Settings → Preferences → "Hide my username from public lists": on a board a PLAYER reads, those
   * players' names become '****' (the site prints "Hidden"). Staff boards and settlement keep names.
   */
  async #hideNames(rows) {
    const ids = [...new Set(rows.map((r) => r.userId).filter((id) => id != null).map(String))];
    if (!ids.length) return rows;
    const hiders = await this.models.Userconfig.findAll({ where: { uid: ids, hide_username: true }, attributes: ['uid'], raw: true });
    if (!hiders.length) return rows;
    const hidden = new Set(hiders.map((h) => String(h.uid)));
    return rows.map((r) => (r.userId != null && hidden.has(String(r.userId)) ? { ...r, name: '****' } : r));
  }

  async #racesByIds(raceIds) {
    const ids = [...new Set(raceIds.map(String))].filter(Boolean);
    if (!ids.length) return new Map();

    const rows = await this.models.Race.findAll({
      where: { id: ids },
      attributes: ['id', 'type', 'starts_at', 'ends_at'],
      raw: true,
    });
    return new Map(rows.map((r) => [String(r.id), r]));
  }

  /**
   * Rank -> % of the net pool. A curve on a 0 pool stores no ranks (`buildRankPrizes`), so its
   * shares come from a nominal pool: the split does not depend on the size.
   */
  #shares(config) {
    const ranks = config.rankPrizes?.length
      ? config.rankPrizes
      : buildRankPrizes({
          prizePool: '100',
          winnerCount: config.winnerCount,
          platformFeePercent: 0,
          top3Percentage: config.top3Percentage,
        }).ranks;
    return new Map(ranks.map((r) => [Number(r.rank), Number(r.percentage) || 0]));
  }

  #shapeConfig(row) {
    const prizePool = money.toDecimalString(money.toMinor(row.prize_pool ?? '0'));
    const fee = String(row.platform_fee_percent ?? '0');

    const stored = Array.isArray(row.rank_percentage) ? row.rank_percentage : [];
    /**
     * The STORED curve is the one that pays.
     *
     * It is recomputed here only when the column is empty — a row seeded by the
     * migration, before an operator has ever saved. Recomputing it on every
     * read is what let the reference's operator console and its player-facing
     * board disagree about the same race.
     */
    const rankPrizes = stored.length
      ? stored
      : buildRankPrizes({
          prizePool,
          winnerCount: row.winner_count,
          platformFeePercent: fee,
          top3Percentage: row.top3_percentage,
        }).ranks;

    return {
      type: row.type,
      enabled: Boolean(row.enabled),
      multipliers: Object.fromEntries(
        RACE_BUCKETS.map((bucket) => [bucket, String(row[BUCKET_COLUMN[bucket]] ?? '0')])
      ),
      prizePool,
      // What the ranks actually add up to. Both, so a headline and a prize
      // table cannot be presented as the same number.
      netPrizePool: money.toDecimalString(money.subtract(prizePool, money.percentOf(prizePool, fee))),
      currency: row.currency || PRIZE_CURRENCY,
      platformFeePercent: fee,
      winnerCount: Number(row.winner_count ?? 0),
      top3Percentage: String(row.top3_percentage ?? '0'),
      minPoints: money.toDecimalString(money.toMinor(row.min_points ?? '0')),
      rankPrizes,
      /** `custom`: the operator's own ladder (`rankShares`); `curve`: computed from the top-3 share. */
      ladder: stored.length && stored.every((r) => r?.custom) ? 'custom' : 'curve',
      bookedSeatsEnabled: Boolean(row.booked_seats_enabled),
      bookedSeats: Array.isArray(row.booked_seats) ? row.booked_seats : [],
    };
  }

  #shapeReward(row, race) {
    return {
      id: row.id,
      raceId: row.race_id,
      type: row.type,
      rank: row.rank,
      points: money.toDecimalString(money.toMinor(row.points ?? '0')),
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      currency: row.currency || PRIZE_CURRENCY,
      claimed: Boolean(row.claimed),
      claimedAt: row.claimed_at,
      createdAt: row.created_at,
      raceStartsAt: race?.starts_at ?? null,
      raceEndsAt: race?.ends_at ?? null,
    };
  }

  #shapeBoat(row) {
    return {
      id: row.id,
      name: row.name,
      isActive: Boolean(row.is_active),
      dailyPoints: money.toDecimalString(money.toMinor(row.daily_points ?? '0')),
      weeklyPoints: money.toDecimalString(money.toMinor(row.weekly_points ?? '0')),
      dailyRank: row.daily_rank,
      weeklyRank: row.weekly_rank,
    };
  }
}

module.exports = { RaceService };
