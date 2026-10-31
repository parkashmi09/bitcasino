'use strict';

const { money } = require('@ibitplay/common');
const { Op, fn, col } = require('@ibitplay/db');

const errors = require('./wager.errors');

/**
 * Wagering requirements ("targetX").
 *
 * A player who deposits must wager some multiple of that deposit before
 * withdrawing. The multiplier is per-player, defaulting to a platform-wide
 * figure, and can be LOCKED so a bulk change does not override a negotiated
 * rate.
 *
 * Replaces the six targetX endpoints in `legacy/fiatdeposit/controller.js` —
 * they lived in the deposit controller because the target is derived from
 * deposits, but they are a distinct concern and are separated here.
 *
 * Two things to know about the schema:
 *
 *  - `users.wager_multiplier` and `users.lock_targetx` were added at RUNTIME by
 *    `ensureWagerSchema()`, an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` the
 *    legacy controller ran on request. That is why they are absent from the
 *    baseline. Schema changes belong in migrations, so this module reads them
 *    defensively and migration 008 declares them properly.
 *
 *  - `wager_multiplier_common.multiplier` is an INTEGER column, so the
 *    platform default cannot express 2.5x. Per-player values live on
 *    `users.wager_multiplier`, which is numeric.
 */
const DEFAULT_MULTIPLIER = '3';

class WagerService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
  }

  /** The platform-wide default. */
  async getCommonMultiplier() {
    const row = await this.models.WagerMultiplierCommon.findOne({
      order: [['id', 'DESC']],
      raw: true,
    });
    return row ? String(row.multiplier) : DEFAULT_MULTIPLIER;
  }

  /**
   * A player's own wagering progress.
   *
   * @legacy GET /api/deposits/check-wager/:uid
   */
  async getProgress(userId) {
    const [user, wagered] = await Promise.all([
      this.models.Users.findByPk(userId, {
        attributes: ['id', 'wager_multiplier', 'lock_targetx'],
        raw: true,
      }),
      this.models.Userwager.findOne({ where: { uid: userId }, raw: true }),
    ]);

    if (!user) throw errors.USER_NOT_FOUND({ userId });

    const multiplier = user.wager_multiplier != null ? String(user.wager_multiplier) : await this.getCommonMultiplier();
    const deposited = await this.#totalApprovedDeposits(userId);
    const target = money.toDecimalString(money.multiply(deposited, multiplier));
    const achieved = money.toDecimalString(money.toMinor(wagered?.wager ?? '0'));

    const remaining = money.gte(achieved, target)
      ? '0.00000000'
      : money.toDecimalString(money.subtract(target, achieved));

    return {
      userId,
      multiplier,
      locked: Boolean(user.lock_targetx),
      totalDeposited: deposited,
      target,
      wagered: achieved,
      remaining,
      // A zero target means nothing has been deposited — that is complete, not
      // a division by zero. Legacy guarded this with a CASE in SQL.
      met: money.lte(target, '0') || money.gte(achieved, target),
    };
  }

  /**
   * @legacy GET /api/deposits/admin/all-wagers
   *
   * Every player's multiplier, lock AND standing against the target.
   *
   * The money columns are the point of the screen — an operator setting a
   * multiplier is deciding whether a player is close enough to withdraw — so
   * they are part of the listing rather than something the caller assembles by
   * calling `getProgress` once per row. That shape is where legacy's version of
   * this page came from and it is one request per player per refresh.
   *
   * Deposits and the wagered figure are two grouped reads for the whole page,
   * and both use the same definitions as `getProgress`: the list and the
   * per-player read cannot disagree about the same player.
   */
  async listMultipliers({ search, lockedOnly, channel = 'direct', limit, offset }) {
    const where = {
      ...(lockedOnly ? { lock_targetx: true } : {}),
      ...(search ? { name: { [Op.iLike]: `%${search}%` } } : {}),
      // `parent_staff_id IS NULL` is a direct signup; not null is an agent's
      // player. See `wager.validators.js` for why direct is the default.
      ...(channel === 'direct' ? { parent_staff_id: null } : {}),
      ...(channel === 'agent' ? { parent_staff_id: { [Op.ne]: null } } : {}),
    };

    const result = await this.models.Users.findAndCountAll({
      attributes: ['id', 'name', 'email', 'wager_multiplier', 'lock_targetx'],
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = result.rows.map((r) => r.id);
    const [common, deposits, wagered] = await Promise.all([
      this.getCommonMultiplier(),
      this.#depositTotalsFor(ids),
      this.#wageredFor(ids),
    ]);

    return {
      count: result.count,
      common,
      rows: result.rows.map((r) => {
        const multiplier = r.wager_multiplier != null ? String(r.wager_multiplier) : common;
        const deposited = deposits.get(String(r.id)) ?? '0.00000000';
        const target = money.toDecimalString(money.multiply(deposited, multiplier));
        const achieved = wagered.get(String(r.id)) ?? '0.00000000';

        return {
          userId: r.id,
          username: r.name,
          email: r.email ?? null,
          multiplier,
          locked: Boolean(r.lock_targetx),
          totalDeposited: deposited,
          target,
          wagered: achieved,
          remaining: money.gte(achieved, target)
            ? '0.00000000'
            : money.toDecimalString(money.subtract(target, achieved)),
          /**
           * Percent of the target met, as a string to two places.
           *
           * A zero target means nothing has been deposited. That is complete,
           * not a division by zero — the same rule `getProgress` applies to
           * `met`, so a player at 100 here is a player `met: true` there.
           */
          percentage: money.lte(target, '0')
            ? '100.00'
            : (
                (Number(money.toMinor(achieved)) / Number(money.toMinor(target))) * 100
              ).toFixed(2),
          met: money.lte(target, '0') || money.gte(achieved, target),
        };
      }),
    };
  }

  /**
   * Approved deposits per player, grouped in the database.
   *
   * Same filter as `#totalApprovedDeposits`, which is the single-player form.
   */
  async #depositTotalsFor(ids) {
    if (!ids.length) return new Map();

    const rows = await this.models.FiatDeposits.findAll({
      attributes: ['user_id', [fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
      where: { user_id: ids, status: 'approved' },
      group: ['user_id'],
      raw: true,
    });

    // `toMinorQuantised`, not `toMinor`: a SUM over a bare `numeric` column
    // carries whatever precision the widest row had, and `toMinor` refuses more
    // than eight places — one over-precise deposit would 400 the whole listing.
    return new Map(
      rows.map((r) => [String(r.user_id), money.toDecimalString(money.toMinorQuantised(r.total ?? '0'))])
    );
  }

  /** What each player has actually wagered. */
  async #wageredFor(ids) {
    if (!ids.length) return new Map();

    const rows = await this.models.Userwager.findAll({
      attributes: ['uid', 'wager'],
      where: { uid: ids },
      raw: true,
    });

    return new Map(
      rows.map((r) => [String(r.uid), money.toDecimalString(money.toMinorQuantised(r.wager ?? '0'))])
    );
  }

  /** @legacy POST /api/deposits/admin/targetx/:id */
  async setForUser({ userId, multiplier }) {
    const user = await this.models.Users.findByPk(userId);
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    await user.update({ wager_multiplier: multiplier });
    this.logger?.info({ userId, multiplier }, 'Wager multiplier set for player');

    return { userId, multiplier, locked: Boolean(user.lock_targetx) };
  }

  /**
   * @legacy POST /api/deposits/admin/update-all-targetx
   *
   * Skips locked accounts. Legacy got this right and flagged it in a comment as
   * a critical fix; keeping the behaviour and the reason visible.
   */
  async setForAll({ multiplier }) {
    return this.db.transaction(async (transaction) => {
      const [affected] = await this.models.Users.update(
        { wager_multiplier: multiplier },
        {
          where: { [Op.or]: [{ lock_targetx: null }, { lock_targetx: false }] },
          transaction,
        }
      );

      const skipped = await this.models.Users.count({ where: { lock_targetx: true }, transaction });

      await this.models.WagerMultiplierCommon.create(
        { multiplier: Math.round(Number.parseFloat(multiplier)) },
        { transaction }
      );

      this.logger?.warn({ multiplier, affected, skipped }, 'Wager multiplier bulk-updated');
      return { multiplier, updated: affected, skippedLocked: skipped };
    });
  }

  /** @legacy POST /api/deposits/admin/targetx/:id/lock */
  async setLock({ userId, locked }) {
    const user = await this.models.Users.findByPk(userId);
    if (!user) throw errors.USER_NOT_FOUND({ userId });

    await user.update({ lock_targetx: locked });
    this.logger?.info({ userId, locked }, 'Wager multiplier lock changed');

    return { userId, locked };
  }

  /**
   * Total approved deposits, in USD-equivalent terms.
   *
   * Only APPROVED fiat deposits count — a pending request is not money the
   * platform has received, and counting it would let a player inflate their
   * target denominator without depositing anything.
   */
  async #totalApprovedDeposits(userId) {
    const rows = await this.models.FiatDeposits.findAll({
      attributes: ['amount'],
      where: { user_id: userId, status: 'approved' },
      raw: true,
    });

    return money.toDecimalString(money.sum(rows.map((r) => r.amount ?? '0')));
  }
}

module.exports = { WagerService, DEFAULT_MULTIPLIER };
