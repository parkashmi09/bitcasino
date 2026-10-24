'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');

/** Parent ↔ child len-den wale point ledger events (bet / commission nahi). */
const MONEY_EVENTS = ['Credit', 'Debit', 'Bank Deposite', 'Bank Withdraw', 'User creation'];

/** Zip ke naam → screen pe dikhne wala. */
const TYPE_LABEL = {
  Credit: 'Credit',
  Debit: 'Debit',
  'Bank Deposite': 'Settlement',
  'Bank Withdraw': 'Settlement',
  'User creation': 'User creation',
};

/**
 * Agent System deposit / withdraw — `mssports.point_ledger` se (Sports Exchange ka hisaab):
 *   deposit   delta > 0  (parent ne child ko diya)
 *   withdraw  delta < 0  (parent ne child se liya)
 * Child = `wallet_id` ka maalik (player ya staff), parent = `settled_with_wallet_id` ka staff.
 * Sirf woh entries jinka parent caller ke tree me hai (owner = poori site).
 */
class AgentLedgerService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  get sequelize() {
    return this.models.Staff.sequelize;
  }

  async list({ actor, direction, search, from, to, min, max, limit = 25, offset = 0 }) {
    const staffIds = (await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level })).map(Number);
    if (!staffIds.length) return { total: 0, sum: '0.00', rows: [] };

    const where = [
      'pl.bet_id IS NULL',
      'pl.event_type IN (:events)',
      direction === 'deposit' ? 'pl.delta > 0' : 'pl.delta < 0',
      'p.staff_id IN (:staffIds)',
    ];
    const replacements = { events: MONEY_EVENTS, staffIds, limit, offset };
    if (search) {
      where.push('(c.uid = :search OR c.staff_id = :search OR p.staff_id = :search)');
      replacements.search = search;
    }
    const optional = [
      ['from', from, 'pl.created_at >= :from'],
      ['to', to, 'pl.created_at <= :to'],
      ['min', min, 'ABS(pl.delta) >= :min'],
      ['max', max, 'ABS(pl.delta) <= :max'],
    ];
    for (const [key, value, sql] of optional) {
      if (value == null) continue;
      where.push(sql);
      replacements[key] = value;
    }

    const joins = `FROM mssports.point_ledger pl
      JOIN credits c ON c.id = pl.wallet_id
      JOIN credits p ON p.id = pl.settled_with_wallet_id`;
    const filter = `WHERE ${where.join(' AND ')}`;

    const [[agg], rows] = await Promise.all([
      this.sequelize.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(ABS(pl.delta)), 0) AS sum ${joins} ${filter}`, {
        replacements,
        type: QueryTypes.SELECT,
      }),
      this.sequelize.query(
        `SELECT pl.id, pl.created_at, pl.event_type, pl.delta, pl.all_point_after, pl.remark,
                c.uid AS child_uid, c.staff_id AS child_staff, p.staff_id AS parent_staff,
                cu.name AS child_user_name, cs.name AS child_staff_name, ps.name AS parent_name
           ${joins}
           LEFT JOIN users cu ON cu.id = c.uid
           LEFT JOIN staff cs ON cs.id = c.staff_id
           LEFT JOIN staff ps ON ps.id = p.staff_id
           ${filter}
          ORDER BY pl.created_at DESC, pl.id DESC LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);

    const show = (v) => money.fromStored(v ?? '0');
    const parent = (r) => ({ type: 'staff', id: String(r.parent_staff), name: r.parent_name ?? null });
    const child = (r) =>
      r.child_uid != null
        ? { type: 'user', id: String(r.child_uid), name: r.child_user_name ?? null }
        : { type: 'staff', id: String(r.child_staff), name: r.child_staff_name ?? null };

    return {
      total: agg.total,
      sum: show(agg.sum),
      rows: rows.map((r) => ({
        id: String(r.id),
        // Deposit: parent → child; withdraw: child → parent (paisa kis taraf gaya).
        from: direction === 'deposit' ? parent(r) : child(r),
        to: direction === 'deposit' ? child(r) : parent(r),
        type: TYPE_LABEL[r.event_type] ?? r.event_type,
        amount: show(String(r.delta).replace('-', '')),
        pointsAfter: r.all_point_after == null ? null : show(r.all_point_after),
        remark: r.remark ? r.remark.split('#')[0] || null : null,
        createdAt: r.created_at,
      })),
    };
  }
}

module.exports = { AgentLedgerService, MONEY_EVENTS };
