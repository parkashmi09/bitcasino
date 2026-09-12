'use strict';

const crypto = require('node:crypto');
const { fn, col, literal } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./house.errors');
const { DEFAULT_MAX, WIN_PROBABILITY, MAX_COUNTER } = require('./house.constants');

/**
 * The `house` counters, and the ticker that walks them.
 */
class HouseService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
  }

  /** @legacy GET /gethouse */
  async list({ limit = 100, offset = 0 }) {
    const { rows, count } = await this.models.House.findAndCountAll({
      order: [['uid', 'ASC']],
      limit,
      offset,
      raw: true,
    });

    const players = await this.models.Users.findAll({
      where: { id: rows.map((r) => r.uid).filter((id) => id != null) },
      attributes: ['id', 'name'],
      raw: true,
    });
    const names = new Map(players.map((p) => [String(p.id), p.name]));

    return {
      total: count,
      rows: rows.map((row) => ({
        id: row.id,
        userId: row.uid != null ? String(row.uid) : null,
        name: names.get(String(row.uid)) ?? null,
        max: money.toDecimalString(money.toMinor(row.max ?? '0')),
        current: money.toDecimalString(money.toMinor(row.current ?? '0')),
      })),
    };
  }

  /** @legacy POST /updatehouse */
  async update({ actor, userId, max, current }) {
    const [affected] = await this.models.House.update(
      { max, current },
      { where: { uid: userId } }
    );

    /**
     * The row count is the answer.
     *
     * Legacy ran the UPDATE and answered "House updated successfully" whether
     * or not it matched anything, so setting the counters for a uid with no
     * `house` row reported success and did nothing.
     */
    if (!affected) throw errors.NO_SUCH_ROW({ userId });

    this.logger?.info({ actorStaffId: actor?.id, userId, max, current }, 'House counters set');
    return { userId: String(userId), max, current };
  }

  /**
   * @legacy GET /reset-house
   * @legacy GET /win-house
   *
   * ─────────────────────────────────────────────────────────────────────
   * THESE TWO REWRITE EVERY ROW IN THE TABLE
   *
   *     await pg.query('UPDATE house SET max = 50, current = 0');
   *     await pg.query('UPDATE house SET max = 0,  current = 0');
   *
   * No WHERE clause, on unauthenticated GET routes. `scope` is required here
   * so the caller has to say "all" out loud, and the affected count comes back
   * so the answer is not silent about how much it touched.
   * ─────────────────────────────────────────────────────────────────────
   */
  async bulkSet({ actor, preset, scope, userIds }) {
    const values = preset === 'win' ? { max: '0', current: '0' } : { max: String(DEFAULT_MAX), current: '0' };

    const where = scope === 'all' ? {} : { uid: userIds };
    if (scope !== 'all' && !userIds?.length) throw errors.NO_TARGET();

    const [affected] = await this.models.House.update(values, { where });

    this.logger?.warn(
      { actorStaffId: actor?.id, preset, scope, affected },
      // WARN because "all" is every player on the platform.
      'House counters bulk-set'
    );

    return { preset, scope, affected, ...values };
  }

  /**
   * One tick of the ticker.
   *
   * The arithmetic is legacy's, unchanged — including the 70/30 split and the
   * draw special-cases — because changing what the counters do is a product
   * decision and this is a port. What changes is HOW it runs: one statement
   * instead of a full read plus one UPDATE per row, and a bound on the
   * counters so they cannot run away.
   *
   * `crypto.randomInt` rather than `Math.random`, not because this decides
   * anything — nothing reads these counters — but because a casino codebase
   * should not contain a `Math.random` that looks like it might.
   */
  async tick() {
    const rows = await this.models.House.findAll({ attributes: ['id', 'max', 'current'], raw: true });
    if (!rows.length) return { updated: 0 };

    const updates = rows.map((row) => {
      const max = Number(row.max ?? 0);
      const current = Number(row.current ?? 0);

      // 0..9999 -> a 70% branch without floating point.
      const won = crypto.randomInt(0, 10_000) < WIN_PROBABILITY * 10_000;

      let nextMax = max;
      let nextCurrent = current;

      if (won) {
        if (max > current) nextCurrent += 1;
        else if (max < current) nextMax -= 1;
        else nextCurrent -= 1;
      } else {
        if (max > current) nextCurrent -= 1;
        else if (max < current) nextMax += 1;
        else nextCurrent += 1;
      }

      return {
        id: row.id,
        // Legacy clamped at zero. Clamped at both ends here: the loss branch
        // increments `max` without limit, so a row that sits in it long enough
        // grows unbounded.
        max: Math.min(Math.max(nextMax, 0), MAX_COUNTER),
        current: Math.min(Math.max(nextCurrent, 0), MAX_COUNTER),
      };
    });

    /**
     * One statement.
     *
     * Legacy issued a SELECT plus one UPDATE per row every minute, on the
     * single shared connection — with n copies of the cron job running, that is
     * n × rows statements a minute, serialised ahead of every player request.
     */
    await this.models.House.bulkCreate(updates, {
      updateOnDuplicate: ['max', 'current'],
    });

    return { updated: updates.length };
  }
}

module.exports = { HouseService };
