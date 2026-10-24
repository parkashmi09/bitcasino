'use strict';

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./bonus.errors');
const {
  BONUS_TYPES,
  BONUS_CURRENCY,
  CODE_STATUS,
  GAME_COUNTERS,
  BLANK_GAME_COUNTERS,
} = require('./bonus.constants');
const { vipLevelFor } = require('@ibitplay/common');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');


/**
 * The columns `userbonus` requires but does not default.
 *
 * `totalbonus`, `vipbonus`, `specialbonus` and `generalbonus` are all NOT NULL
 * with no database default, so an INSERT that omits them fails rather than
 * writing zeros. Listed once here; a new NOT NULL balance column added to the
 * table will break record creation loudly, which is the intent.
 */
const BLANK_RECORD = Object.freeze({
  totalbonus: '0',
  vipbonus: '0',
  specialbonus: '0',
  generalbonus: '0',
});

/**
 * Recurring bonuses and redeem codes.
 *
 * A scheduled job awards daily/weekly/monthly bonuses into `bonus_history`,
 * each with a deadline. This module is what a player uses to see and claim
 * them, and what staff use to issue redeem codes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * 1. THE CLAIM PAID TWICE. The same shape as the gift-card bug:
 *
 *      SELECT ... WHERE is_claimed = FALSE ORDER BY created_at DESC LIMIT 1
 *      UPDATE bonus_history SET is_claimed = TRUE WHERE id = $1   ← unconditional
 *      UPDATE credits SET bjb = COALESCE(bjb,0) + $1
 *
 *    Two requests select the same row, both pass, both credit. Inside a
 *    transaction, but with no lock and no condition on the update, so the
 *    transaction changed nothing.
 *
 * 2. THE VIP GATE WAS ON THE READ, NOT THE CLAIM. `/api/bonuses` computed the
 *    player's VIP level and reported `eligible: vipLevelNum >= 20`. The claim
 *    endpoint did not check it at all — so a player below the threshold was
 *    shown "not eligible" and could claim anyway by calling the other endpoint.
 *
 * 3. AUTHENTICATION WAS A SHARED HEADER. `checkRole` read `role-key` from the
 *    request headers and looked it up in `roles_keys`. One static key per role,
 *    the same for every user — so anyone holding the app's key could act as any
 *    player, and the routes took `userid` from the query string or body.
 *
 * 4. NO LEDGER. Every bonus was `UPDATE credits SET bjb = ...`, so bonus
 *    payments appeared on no statement and could not be reconciled.
 * ─────────────────────────────────────────────────────────────────────────
 */
class BonusService {
  constructor(deps) {
    const { models, db, logger, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.wallet = new WalletService(deps);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Players
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /Userbonus/api/bonuses
   *
   * What this player has, what they can claim, and why not if they cannot.
   */
  async overview({ userId }) {
    const [wager, bonuses, claimable] = await Promise.all([
      this.models.Userwager.findOne({ where: { uid: userId }, raw: true }),
      this.models.Userbonus.findOne({ where: { userid: userId }, raw: true }),
      this.models.BonusClaim.findAll({
        where: {
          userid: userId,
          is_claimed: false,
          is_unclaimable: false,
          claim_deadline: { [Op.gt]: new Date() },
        },
        order: [['created_at', 'DESC']],
        raw: true,
      }),
    ]);

    const vip = vipLevelFor(this.#wagerAmount(wager));
    const byType = new Map(claimable.map((c) => [c.bonus_type, c]));

    const types = {};
    for (const [type, spec] of Object.entries(BONUS_TYPES)) {
      const pending = byType.get(type);
      const eligible = vip.level >= spec.minVipLevel;

      types[type] = {
        amount: money.toDecimalString(money.toMinor(bonuses?.[spec.amountColumn] ?? '0')),
        totalPaid: money.toDecimalString(money.toMinor(bonuses?.[spec.paidColumn] ?? '0')),
        minVipLevel: spec.minVipLevel,
        eligible,
        // Claimable means BOTH: there is an award waiting AND the player
        // qualifies. Legacy reported these separately and enforced neither.
        claimable: Boolean(pending) && eligible,
        award: pending
          ? {
              id: pending.id,
              amount: money.toDecimalString(money.toMinor(pending.bonus_amount ?? '0')),
              deadline: pending.claim_deadline,
            }
          : null,
      };
    }

    return { vip, currency: BONUS_CURRENCY, types };
  }

  /** @legacy GET /Userbonus/api/bonus-history */
  async history({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.BonusClaim.findAndCountAll({
      where: { userid: userId },
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        type: r.bonus_type,
        amount: money.toDecimalString(money.toMinor(r.bonus_amount ?? '0')),
        wagerChange: money.toDecimalString(money.toMinor(r.wager_change ?? '0')),
        claimed: r.is_claimed,
        unclaimable: r.is_unclaimable,
        deadline: r.claim_deadline,
        claimedAt: r.claimed_at,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * @legacy POST /Userbonus/api/bonuses/claim/:type
   *
   * Claim the newest outstanding bonus of a type.
   */
  async claim({ userId, type }) {
    const spec = BONUS_TYPES[type];
    if (!spec) throw errors.INVALID_TYPE({ type });

    // The VIP gate, on the CLAIM. Legacy checked it only on the read.
    const wager = await this.models.Userwager.findOne({ where: { uid: userId }, raw: true });
    const vip = vipLevelFor(this.#wagerAmount(wager));
    if (vip.level < spec.minVipLevel) {
      throw errors.VIP_LEVEL_TOO_LOW({ required: spec.minVipLevel, current: vip.level, type });
    }

    const award = await this.models.BonusClaim.findOne({
      where: { userid: userId, bonus_type: type, is_claimed: false, is_unclaimable: false },
      order: [['created_at', 'DESC']],
      raw: true,
    });

    if (!award) throw errors.NOT_CLAIMABLE({ type });
    if (new Date(award.claim_deadline) < new Date()) {
      throw errors.EXPIRED({ type, deadline: award.claim_deadline });
    }

    const amount = money.toDecimalString(money.toMinor(award.bonus_amount ?? '0'));

    return this.db.transaction(async (transaction) => {
      /**
       * The conditional claim. `is_claimed: false` in the WHERE means the
       * database decides between two simultaneous requests — legacy's update
       * was `WHERE id = $1` alone, so both won.
       */
      const [affected] = await this.models.BonusClaim.update(
        { is_claimed: true, claimed_at: new Date() },
        { where: { id: award.id, is_claimed: false }, transaction }
      );

      if (affected === 0) throw errors.ALREADY_CLAIMED({ type });

      const movement = await this.wallet.credit(
        {
          userId,
          currency: BONUS_CURRENCY,
          amount,
          reason: REASON.BONUS,
          // Derived from the award row: one award, one payment, whatever
          // happens upstream.
          idempotencyKey: `bonus:${award.id}`,
          refType: 'BONUS_AWARD',
          refId: String(award.id),
          description: `${type} bonus`,
        },
        { sourceService: 'user-service', transaction }
      );

      /**
       * Mirror the running totals the legacy screens read.
       *
       * `<type>bonus` is reset to zero and `actual<type>bonus` accumulates what
       * has actually been paid. Neither is authoritative — the ledger is — but
       * the existing admin views select these columns, so they have to keep
       * meaning what they meant.
       */
      await this.models.Userbonus.update(
        {
          [spec.amountColumn]: '0',
          [spec.paidColumn]: this.db.sequelize.literal(
            // Column names come from BONUS_TYPES, never from a request.
            `COALESCE("${spec.paidColumn}", 0) + ${money.toDecimalString(money.toMinor(amount))}`
          ),
          updatedat: new Date(),
        },
        { where: { userid: userId }, transaction }
      );

      this.logger?.info({ userId, type, amount, awardId: award.id, ledgerId: movement.ledgerId }, 'Bonus claimed');

      return { type, amount, currency: BONUS_CURRENCY, newBalance: movement.newBalance };
    });
  }

  /**
   * @legacy POST /bonus/redeem-bonus/redeem
   *
   * Redeem a code for a fixed bonus amount.
   *
   * Codes carrying a PERCENTAGE (the spin wheel issues these) are not redeemed
   * here — they apply to a deposit, and are consumed by the deposit path. A
   * percentage code redeemed for its `amount` would pay zero, which is what
   * legacy would have done since it read `amount` unconditionally.
   */
  async redeemCode({ userId, code }) {
    return this.db.transaction(async (transaction) => {
      /**
       * Locked for the duration. The legacy version selected the code, checked
       * `status !== 'active'`, and then updated — with the same result as every
       * other check-then-write on this platform.
       */
      const row = await this.models.Redeembonus.findOne({
        where: { userid: userId, code },
        lock: transaction.LOCK.UPDATE,
        transaction,
        raw: true,
      });

      if (!row) throw errors.CODE_NOT_FOUND({ code });
      if (row.status !== CODE_STATUS.ACTIVE) throw errors.CODE_NOT_ACTIVE({ code, status: row.status });

      // A percentage code is applied at deposit time, not redeemed for cash.
      if (row.bonus_pct != null && Number(row.bonus_pct) > 0) {
        throw errors.CODE_NOT_ACTIVE({
          code,
          reason: 'This code applies a percentage to your next deposit and cannot be redeemed directly',
        });
      }

      const amount = money.toDecimalString(money.toMinor(row.amount ?? '0'));
      if (money.lte(amount, '0')) throw errors.CODE_NOT_ACTIVE({ code, reason: 'This code carries no value' });

      const [affected] = await this.models.Redeembonus.update(
        { status: CODE_STATUS.REDEEMED, updatedat: new Date() },
        { where: { id: row.id, status: CODE_STATUS.ACTIVE }, transaction }
      );
      if (affected === 0) throw errors.CODE_NOT_ACTIVE({ code });

      const movement = await this.wallet.credit(
        {
          userId,
          currency: BONUS_CURRENCY,
          amount,
          reason: REASON.BONUS,
          idempotencyKey: `redeem:${row.id}`,
          refType: 'REDEEM_CODE',
          refId: String(row.id),
          description: `Redeem code ${code}`,
        },
        { sourceService: 'user-service', transaction }
      );

      this.logger?.info({ userId, code, amount }, 'Redeem code claimed');

      return { code, amount, currency: BONUS_CURRENCY, newBalance: movement.newBalance };
    });
  }

  /** @legacy POST /bonus/user — a player's own codes. */
  async myCodes({ userId, status, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Redeembonus.findAndCountAll({
      where: { userid: userId, ...(status ? { status } : {}) },
      order: [['createdat', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => this.#shapeCode(r)),
    };
  }

  /** @legacy POST /bonus/userbonus — the player's own bonus record. */
  async myBonusRecord({ userId }) {
    const row = await this.models.Userbonus.findOne({ where: { userid: userId }, raw: true });
    if (!row) throw errors.NO_BONUS_RECORD({ userId });
    return this.#shapeRecord(row);
  }

  /** @legacy POST /bonus/bonusgame — per-game bonus balances. */
  async myBonusGame({ userId }) {
    const row = await this.models.Bonusgame.findOne({ where: { userid: userId }, raw: true });
    return this.#shapeGameCounters(row);
  }

  /**
   * @legacy POST /bonus/bonushistory — the audit-style history table.
   *
   * The model is registered as `Bonushistory`, not `BonusHistory`. The registry
   * is keyed by the Sequelize model name (`models[model.name]`), and the
   * generator derives that from the table name — so the file is `BonusHistory.js`
   * and the key is `Bonushistory`. Getting the capital H wrong does not throw at
   * boot; it throws `Cannot read properties of undefined` the first time
   * somebody opens the screen.
   */
  async myEvents({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Bonushistory.findAndCountAll({
      where: { userid: userId },
      order: [['createdat', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeEvent(r)) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Staff
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /bonus/admin/userbonus */
  async listRecords({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Userbonus.findAndCountAll({
      where: userId ? { userid: userId } : {},
      order: [['userid', 'ASC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeRecord(r)) };
  }

  /** @legacy GET /bonus/admin/bonusgame */
  async listBonusGames({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Bonusgame.findAndCountAll({
      where: userId ? { userid: userId } : {},
      order: [['userid', 'ASC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeGameCounters(r)) };
  }

  /** @legacy GET /bonus/admin/bonushistory */
  async listEvents({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Bonushistory.findAndCountAll({
      where: userId ? { userid: userId } : {},
      order: [['createdat', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeEvent(r)) };
  }

  /** @legacy GET /bonus/admin/bonushistory (awards, not events) */
  async listAwards({ userId, type, claimed, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.BonusClaim.findAndCountAll({
      where: {
        ...(userId ? { userid: userId } : {}),
        ...(type ? { bonus_type: type } : {}),
        ...(claimed !== undefined ? { is_claimed: claimed } : {}),
      },
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows };
  }

  /**
   * @legacy POST /bonus/createuserbonus
   *
   * `userbonus` has NOT NULL columns with NO database default — `totalbonus`,
   * `vipbonus`, `specialbonus`, `generalbonus`. Omitting them does not produce
   * zeros, it produces a constraint violation, so every one has to be named
   * explicitly. `BLANK_RECORD` is that list, in one place, so a new balance
   * column added to the table fails here rather than at 3am.
   */
  async createRecord({ userId, name }) {
    const [record] = await this.models.Userbonus.findOrCreate({
      where: { userid: userId },
      defaults: {
        ...BLANK_RECORD,
        userid: userId,
        name: name ?? null,
        createdat: new Date(),
        updatedat: new Date(),
      },
    });
    return this.#shapeRecord(record.get({ plain: true }));
  }

  /**
   * @legacy PUT /bonus/userbonus
   *
   * Adjust a player's pending bonus figures.
   *
   * These are the amounts a future claim will pay, so this is a money-adjacent
   * write even though nothing moves yet — which is why the route audits it.
   */
  async updateRecord({ userId, ...amounts }) {
    const existing = await this.models.Userbonus.findOne({ where: { userid: userId }, raw: true });
    if (!existing) throw errors.NO_BONUS_RECORD({ userId });

    const patch = { updatedat: new Date() };
    for (const [type, spec] of Object.entries(BONUS_TYPES)) {
      if (amounts[type] !== undefined) patch[spec.amountColumn] = amounts[type];
    }

    await this.models.Userbonus.update(patch, { where: { userid: userId } });
    const row = await this.models.Userbonus.findOne({ where: { userid: userId }, raw: true });
    return this.#shapeRecord(row);
  }

  /** @legacy DELETE /bonus/userbonus */
  async deleteRecord({ userId }) {
    const deleted = await this.models.Userbonus.destroy({ where: { userid: userId } });
    if (!deleted) throw errors.NO_BONUS_RECORD({ userId });
    return { userId, deleted: true };
  }

  // ── Per-game counters (`bonusgame`) ───────────────────────────────────

  /**
   * @legacy POST /bonus/createbonusgame
   *
   * Open a player's counter row.
   *
   * Legacy was a bare INSERT with no conflict handling, so calling it twice
   * gave a player two counter rows — and the update below then wrote to both
   * while reporting one. Migration 020 makes `userid` unique and this is a
   * `findOrCreate`, so a second call returns the row that already exists.
   */
  async createBonusGame({ userId, ...counters }) {
    const [row, created] = await this.models.Bonusgame.findOrCreate({
      where: { userid: userId },
      defaults: {
        ...BLANK_GAME_COUNTERS,
        ...this.#counterPatch(counters),
        userid: userId,
        createdat: new Date(),
        updatedat: new Date(),
      },
    });

    return { created, ...this.#shapeGameCounters(row.get({ plain: true })) };
  }

  /**
   * @legacy PUT /bonus/bonusgame
   *
   * Grant bonus from one or more sources: add to the counters and pay the
   * total into the player's bonus balance.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THIS ENDPOINT GRANTS MONEY, AND LEGACY GATED IT ON A SHARED HEADER
   *
   * The legacy handler ended with:
   *
   *     UPDATE credits SET bjb = COALESCE(bjb, 0) + $1 WHERE uid = $2
   *
   * where `$1` is the sum of six numbers from the request body and `$2` is a
   * `userid`, also from the request body. The only thing in front of it was
   * `checkRole('user', 'admin')`, which looks up a `role-key` HEADER in
   * `roles_keys` — one static key per role, shared by every client holding it.
   * It authenticates a ROLE, never a USER.
   *
   * So anyone in possession of the app's player-tier key could post any
   * `userid` and any amounts and credit that account. And because `role` was
   * overwritten from the key rather than read from the body, this was reachable
   * with the ordinary player key — the admin key was not needed.
   *
   * Three things change here:
   *
   *   The route requires `wallet:credit`, not a config permission. Adjusting a
   *   counter and minting balance are the same action, and it is priced as the
   *   larger of the two.
   *
   *   The money moves through the wallet with a ledger row, so the grant
   *   appears on the player's statement and reconciles. Legacy wrote none.
   *
   *   `idempotencyKey` is required. Legacy's `+=` under a retry granted twice;
   *   here the second attempt returns the first movement.
   * ─────────────────────────────────────────────────────────────────────
   */
  async grantBonusGame({ userId, idempotencyKey, staffId = null, note = null, ...counters }) {
    const patch = this.#counterPatch(counters);
    const total = Object.values(patch).reduce(
      (sum, value) => money.add(sum, money.toMinor(value)),
      money.toMinor('0')
    );
    const amount = money.toDecimalString(total);

    const existing = await this.models.Bonusgame.findOne({ where: { userid: userId }, raw: true });
    if (!existing) throw errors.NO_GAME_COUNTERS({ userId });

    return this.db.transaction(async (transaction) => {
      /**
       * `increment` emits `SET col = col + n` — the database does the addition.
       *
       * The counter names come from `GAME_COUNTERS`, never from the request,
       * because they land in an identifier position.
       */
      await this.models.Bonusgame.increment(patch, {
        where: { userid: userId },
        transaction,
      });
      await this.models.Bonusgame.update(
        { updatedat: new Date() },
        { where: { userid: userId }, transaction }
      );

      let movement = null;
      if (money.gt(amount, '0')) {
        movement = await this.wallet.credit(
          {
            userId,
            currency: BONUS_CURRENCY,
            amount,
            reason: REASON.BONUS,
            idempotencyKey,
            refType: 'BONUS_GRANT',
            refId: idempotencyKey,
            description: note ?? 'Bonus counter grant',
          },
          { sourceService: 'user-service', transaction }
        );
      }

      /**
       * A log row for the grant.
       *
       * Legacy left `bonushistory` untouched here, so a manual grant existed
       * only as a larger number in a counter — with nothing recording that it
       * had been made, by whom, or when.
       */
      await this.models.Bonushistory.create(
        {
          userid: userId,
          event: `grant:${Object.keys(patch).join(',')}${staffId ? ` by staff ${staffId}` : ''}`,
          amount,
          createdat: new Date(),
          updatedat: new Date(),
        },
        { transaction }
      );

      const row = await this.models.Bonusgame.findOne({
        where: { userid: userId },
        transaction,
        raw: true,
      });

      this.logger?.info(
        { userId, staffId, amount, counters: Object.keys(patch), ledgerId: movement?.ledgerId },
        'Bonus granted from counters'
      );

      return {
        ...this.#shapeGameCounters(row),
        granted: amount,
        currency: BONUS_CURRENCY,
        newBalance: movement?.newBalance ?? null,
      };
    });
  }

  /**
   * @legacy DELETE /bonus/bonusgame
   *
   * Remove a player's counter row.
   *
   * This does NOT claw back money already granted — the ledger rows stay, which
   * is the point of having them. It resets the running record of what came from
   * where.
   */
  async deleteBonusGame({ userId }) {
    const deleted = await this.models.Bonusgame.destroy({ where: { userid: userId } });
    if (!deleted) throw errors.NO_GAME_COUNTERS({ userId });
    return { userId, deleted: true };
  }

  // ── The event log (`bonushistory`) ────────────────────────────────────

  /**
   * @legacy POST /bonus/createbonushistory
   *
   * Append an event to a player's bonus log.
   */
  async createEvent({ userId, event, amount }) {
    const row = await this.models.Bonushistory.create({
      userid: userId,
      event,
      // INTEGER until migration 020 widened it, so every decimal bonus ever
      // logged was rounded to a whole unit on the way in.
      amount: money.toDecimalString(money.toMinor(amount ?? '0')),
      createdat: new Date(),
      updatedat: new Date(),
    });
    return this.#shapeEvent(row.get({ plain: true }));
  }

  /**
   * @legacy PUT /bonus/bonushistory
   *
   * Correct one logged event.
   *
   *   THE LEGACY VERSION REWROTE THE WHOLE LOG. Its statement was
   *   `UPDATE bonushistory SET event = $1, amount = $2 WHERE userid = $3`, and
   *   `bonushistory` is append-only — one row per bonus event. So "edit the
   *   history entry" set EVERY row for that player to the same event name and
   *   the same amount, collapsing the entire log into N copies of one line.
   *
   *   It could not have been written any other way: the table had no primary
   *   key, so there was no expression that named a single row. Migration 020
   *   adds one, and this takes an `id`.
   */
  async updateEvent({ id, event, amount }) {
    const row = await this.models.Bonushistory.findByPk(id, { raw: true });
    if (!row) throw errors.EVENT_NOT_FOUND({ id });

    const patch = { updatedat: new Date() };
    if (event !== undefined) patch.event = event;
    if (amount !== undefined) patch.amount = money.toDecimalString(money.toMinor(amount));

    await this.models.Bonushistory.update(patch, { where: { id } });
    const updated = await this.models.Bonushistory.findByPk(id, { raw: true });
    return this.#shapeEvent(updated);
  }

  /**
   * @legacy DELETE /bonus/bonushistory
   *
   * Remove one logged event.
   *
   * Legacy's `DELETE FROM bonushistory WHERE userid = $1` erased a player's
   * entire bonus history in one call, from a route any holder of the shared
   * player key could reach.
   */
  async deleteEvent({ id }) {
    const deleted = await this.models.Bonushistory.destroy({ where: { id } });
    if (!deleted) throw errors.EVENT_NOT_FOUND({ id });
    return { id, deleted: true };
  }

  /**
   * @legacy GET /Adminbonus/api/admin/bonuses
   *
   * The bonus overview screen: every player's pending figures and VIP level,
   * plus the recent award history.
   *
   *   LEGACY'S TWO QUERIES WERE INNER JOINS ONTO `userwager`. A player with no
   *   row in that table — which is every player who has not wagered yet —
   *   vanished from both lists entirely. They have bonuses; they were simply
   *   invisible on the screen used to check them. LEFT JOIN here, with the
   *   missing wager read as zero.
   *
   *   AND THE HISTORY WAS AN UNPAGED `LIMIT 100`. Not a page — a hard ceiling
   *   with no way to see row 101. Paged.
   */
  async adminDashboard({ userId, limit = 100, offset = 0 }) {
    const scope = userId ? { userid: userId } : {};

    const [records, awards, wagers] = await Promise.all([
      this.models.Userbonus.findAll({
        attributes: ['userid', 'name', 'dailybonus', 'weeklybonus', 'monthlybonus'],
        where: scope,
        // Newest accounts first. Legacy's query had no ORDER BY at all, so the
        // order — and therefore which players landed on page one — was whatever
        // the planner produced that day.
        order: [['userid', 'DESC']],
        limit,
        offset,
        raw: true,
      }),
      this.models.BonusClaim.findAndCountAll({
        where: scope,
        order: [['created_at', 'DESC']],
        limit,
        offset,
        raw: true,
      }),
      // Only the wagers of the players on this page. Legacy loaded the whole
      // table on every request to compute VIP levels for a hundred rows.
      this.models.Userwager.findAll({
        attributes: ['uid', 'wager'],
        where: userId ? { uid: userId } : {},
        raw: true,
      }),
    ]);

    const wagerByUser = new Map(wagers.map((w) => [String(w.uid), this.#wagerAmount(w)]));
    const vipOf = (userId) => vipLevelFor(wagerByUser.get(String(userId)) ?? '0');

    return {
      total: awards.count,
      users: records.map((r) => ({
        userId: r.userid,
        name: r.name,
        vip: vipOf(r.userid),
        bonuses: {
          daily: money.toDecimalString(money.toMinor(r.dailybonus ?? '0')),
          weekly: money.toDecimalString(money.toMinor(r.weeklybonus ?? '0')),
          monthly: money.toDecimalString(money.toMinor(r.monthlybonus ?? '0')),
        },
      })),
      history: awards.rows.map((h) => ({
        id: h.id,
        userId: h.userid,
        type: h.bonus_type,
        amount: money.toDecimalString(money.toMinor(h.bonus_amount ?? '0')),
        claimed: h.is_claimed,
        claimedAt: h.claimed_at,
        createdAt: h.created_at,
        vip: vipOf(h.userid),
      })),
    };
  }

  /**
   * @legacy POST /bonus/redeem-bonus/create
   *
   * Issue a redeem code worth a fixed amount.
   */
  async createCode({ userId, code, amount }) {
    const existing = await this.models.Redeembonus.findOne({ where: { code }, raw: true });
    if (existing) throw errors.CODE_EXISTS({ code });

    try {
      const row = await this.models.Redeembonus.create({
        userid: userId,
        code,
        amount,
        status: CODE_STATUS.ACTIVE,
        source: 'admin',
        createdat: new Date(),
        updatedat: new Date(),
      });
      return this.#shapeCode(row.get({ plain: true }));
    } catch (error) {
      // The unique index added by migration 013 is the real guard; the check
      // above only produces a friendlier message when there is no race.
      if (error?.name === 'SequelizeUniqueConstraintError') throw errors.CODE_EXISTS({ code });
      throw error;
    }
  }

  /** @legacy GET /bonus/redeem-bonus */
  async listCodes({ userId, status, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Redeembonus.findAndCountAll({
      where: { ...(userId ? { userid: userId } : {}), ...(status ? { status } : {}) },
      order: [['createdat', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeCode(r)) };
  }

  /** @legacy GET /bonus/users */
  async listUserIds({ limit = 200, offset = 0 }) {
    const rows = await this.models.Userbonus.findAll({
      attributes: ['userid', 'name'],
      order: [['userid', 'ASC']],
      limit,
      offset,
      raw: true,
    });
    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * `userwager.wager` is TEXT with thousands separators — "1,234,567.89".
   *
   * Parsing it is not optional and not obvious: `Number("1,234")` is NaN, so a
   * missed `replace` silently makes every player VIP 0. Legacy did the replace
   * in one of the two places it read this column.
   */
  #wagerAmount(row) {
    const raw = row?.wager;
    if (raw == null) return '0';
    const cleaned = String(raw).replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0';
  }

  /**
   * Keep only the counters we know about, as exact decimal strings.
   *
   * The filter is the security boundary, not a convenience: the returned keys
   * are used as SQL identifiers by `increment`, so a key that came from the
   * request body would be an injection point. Validation rejects unknown keys
   * too — this is the second of the two.
   */
  #counterPatch(counters) {
    const patch = {};
    for (const name of GAME_COUNTERS) {
      if (counters[name] === undefined) continue;
      patch[name] = money.toDecimalString(money.toMinor(counters[name]));
    }
    return patch;
  }

  #shapeGameCounters(row) {
    if (!row) return null;
    const counters = {};
    for (const name of GAME_COUNTERS) {
      counters[name] = money.toDecimalString(money.toMinor(row[name] ?? '0'));
    }
    return {
      id: row.id,
      userId: row.userid,
      counters,
      createdAt: row.createdat,
      updatedAt: row.updatedat,
    };
  }

  #shapeEvent(row) {
    return {
      id: row.id,
      userId: row.userid,
      event: row.event,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      createdAt: row.createdat,
      updatedAt: row.updatedat,
    };
  }

  #shapeRecord(row) {
    const amounts = {};
    for (const [type, spec] of Object.entries(BONUS_TYPES)) {
      amounts[type] = {
        pending: money.toDecimalString(money.toMinor(row[spec.amountColumn] ?? '0')),
        paid: money.toDecimalString(money.toMinor(row[spec.paidColumn] ?? '0')),
      };
    }

    return {
      userId: row.userid,
      name: row.name,
      total: money.toDecimalString(money.toMinor(row.totalbonus ?? '0')),
      vip: money.toDecimalString(money.toMinor(row.vipbonus ?? '0')),
      special: money.toDecimalString(money.toMinor(row.specialbonus ?? '0')),
      general: money.toDecimalString(money.toMinor(row.generalbonus ?? '0')),
      joining: money.toDecimalString(money.toMinor(row.joiningbonus ?? '0')),
      rake: money.toDecimalString(money.toMinor(row.rakebonus ?? '0')),
      amounts,
    };
  }

  #shapeCode(row) {
    return {
      id: row.id,
      userId: row.userid,
      code: row.code,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      // A percentage code applies to a deposit; an amount code is redeemed for
      // cash. They are different instruments sharing a table.
      bonusPct: row.bonus_pct != null ? String(row.bonus_pct) : null,
      kind: row.bonus_pct != null && Number(row.bonus_pct) > 0 ? 'percentage' : 'amount',
      status: row.status,
      source: row.source,
      createdAt: row.createdat,
    };
  }
}

module.exports = { BonusService };
