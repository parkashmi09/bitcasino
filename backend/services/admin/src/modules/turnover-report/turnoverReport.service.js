'use strict';

const { Op, QueryTypes } = require('sequelize');
const { AppError, withdrawalCapFigures } = require('@ibitplay/common');

const escapeLike = (v) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Turnover Report — zip `TurnoverReport` / `all-wagers` jaisa, sirf DIRECT users (parent nahi):
 *   wager, total deposit (INR, `withdrawalCapFigures` — withdrawal cap wale hi figures),
 *   target = deposit × TargetX, % achieved.
 * TargetX: user ka apna (`turnover_targets`) warna default (`turnover_settings`).
 */
class TurnoverReportService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
    this.figures = withdrawalCapFigures.createCapFigures({ db: { sequelize: models.Staff.sequelize } });
  }

  get sequelize() {
    return this.models.Staff.sequelize;
  }

  async #defaultMultiplier() {
    const [row] = await this.sequelize.query('SELECT multiplier FROM turnover_settings WHERE id = 1', { type: QueryTypes.SELECT });
    return row ? Number(row.multiplier) : 3;
  }

  async settings() {
    return { defaultMultiplier: await this.#defaultMultiplier() };
  }

  async list({ search, limit = 25, offset = 0 }) {
    const where = { parent_staff_id: null, is_demo: false };
    if (search) {
      const term = `%${escapeLike(search.trim())}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        ...(/^\d+$/.test(search.trim()) ? [{ id: Number(search.trim()) }] : []),
      ];
    }

    const [{ rows, count }, defaultX] = await Promise.all([
      this.models.Users.findAndCountAll({ where, attributes: ['id', 'name', 'email'], order: [['id', 'DESC']], limit, offset, raw: true }),
      this.#defaultMultiplier(),
    ]);

    const ids = rows.map((r) => r.id);
    const own = ids.length
      ? await this.sequelize.query('SELECT user_id, multiplier, locked FROM turnover_targets WHERE user_id IN (:ids)', {
          replacements: { ids },
          type: QueryTypes.SELECT,
        })
      : [];
    const byUser = new Map(own.map((t) => [String(t.user_id), t]));

    const out = await Promise.all(
      rows.map(async (u) => {
        const f = await this.figures.figures(u.id, 'INR');
        const t = byUser.get(String(u.id));
        const multiplier = t ? Number(t.multiplier) : defaultX;
        const deposit = Number(f.deposited) || 0;
        const wager = Number(f.wagered) || 0;
        const target = deposit * multiplier;
        return {
          id: String(u.id),
          name: u.name ?? null,
          email: u.email ?? null,
          wager: wager.toFixed(2),
          totalDeposit: deposit.toFixed(2),
          multiplier,
          target: target.toFixed(2),
          targetPercentage: target > 0 ? Number(((wager * 100) / target).toFixed(2)) : 0,
          locked: Boolean(t?.locked),
        };
      })
    );

    return { total: count, rows: out };
  }

  /** "Update All TargetX" — default badlo, aur jinka TargetX locked nahi unka bhi. */
  async setAll({ actor, multiplier }) {
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(
        `INSERT INTO turnover_settings (id, multiplier, updated_by, updated_at) VALUES (1, :m, :by, now())
         ON CONFLICT (id) DO UPDATE SET multiplier = EXCLUDED.multiplier, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        { replacements: { m: multiplier, by: actor.id }, transaction }
      );
      await this.sequelize.query(
        'UPDATE turnover_targets SET multiplier = :m, updated_by = :by, updated_at = now() WHERE locked = FALSE',
        { replacements: { m: multiplier, by: actor.id }, transaction }
      );
      /* The SAME figure is the withdrawal rollover (user-service wager.service: users.wager_multiplier,
         else wager_multiplier_common) — one TargetX, not a report that disagrees with what blocks a
         withdrawal. Direct users whose TargetX is not locked here or there. */
      await this.sequelize.query(
        `UPDATE users SET wager_multiplier = :m
          WHERE parent_staff_id IS NULL AND COALESCE(lock_targetx, FALSE) = FALSE
            AND id NOT IN (SELECT user_id FROM turnover_targets WHERE locked = TRUE)`,
        { replacements: { m: multiplier }, transaction }
      );
      await this.sequelize.query('INSERT INTO wager_multiplier_common (multiplier) VALUES (:m)', { replacements: { m: multiplier }, transaction });
    });
    return { defaultMultiplier: multiplier };
  }

  /** Ek user ka TargetX aur / ya lock. */
  async setUser({ actor, userId, multiplier, locked }) {
    const user = await this.models.Users.findByPk(userId, { attributes: ['id', 'parent_staff_id'], raw: true });
    if (!user) throw new AppError('User not found', 404, 'TURNOVER_USER_NOT_FOUND');
    if (user.parent_staff_id != null) throw new AppError('Turnover targets are for direct users only', 400, 'TURNOVER_NOT_DIRECT');

    const m = multiplier ?? (await this.#defaultMultiplier());
    await this.sequelize.query(
      `INSERT INTO turnover_targets (user_id, multiplier, locked, updated_by, updated_at)
       VALUES (:id, :m, :locked, :by, now())
       ON CONFLICT (user_id) DO UPDATE SET
         multiplier = COALESCE(:newM, turnover_targets.multiplier),
         locked     = COALESCE(:newLocked, turnover_targets.locked),
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      {
        replacements: { id: userId, m, locked: locked ?? false, newM: multiplier ?? null, newLocked: locked ?? null, by: actor.id },
      }
    );
    const [row] = await this.sequelize.query('SELECT multiplier, locked FROM turnover_targets WHERE user_id = :id', {
      replacements: { id: userId },
      type: QueryTypes.SELECT,
    });
    // Mirrored onto the withdrawal rollover (users.wager_multiplier / lock_targetx) — one TargetX.
    await this.sequelize.query('UPDATE users SET wager_multiplier = :m, lock_targetx = :locked WHERE id = :id', {
      replacements: { id: userId, m: row.multiplier, locked: Boolean(row.locked) },
    });
    return { id: String(userId), multiplier: Number(row.multiplier), locked: row.locked };
  }
}

module.exports = { TurnoverReportService };
