'use strict';

const { QueryTypes } = require('sequelize');
const { AppError, manualPayments } = require('@ibitplay/common');

const { assertTransactionPassword } = require('../staff-auth/transactionPassword');

const onlyOwner = () => new AppError('Only the Super Admin can switch manual payments', 403, 'MANUAL_PAYMENTS_OWNER_ONLY');

/** Manual deposit / withdrawal ON / OFF (`manual_payment_control`). Badalna sirf owner, transaction password ke saath. */
class ManualPaymentsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  get sequelize() {
    return this.models.Staff.sequelize;
  }

  async read() {
    const [state, [row]] = await Promise.all([
      manualPayments.readManualPayments(this.sequelize),
      this.sequelize.query(
        `SELECT m.updated_at, m.updated_by, s.name AS updated_by_name
           FROM manual_payment_control m LEFT JOIN staff s ON s.id = m.updated_by
          WHERE m.id = 1`,
        { type: QueryTypes.SELECT }
      ),
    ]);
    return {
      deposit: state.deposit,
      withdraw: state.withdraw,
      updatedAt: row?.updated_by != null ? row.updated_at : null,
      updatedBy: row?.updated_by != null ? { id: String(row.updated_by), name: row.updated_by_name ?? null } : null,
    };
  }

  async set({ actor, deposit, withdraw, transactionPassword }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    await assertTransactionPassword(this.models, actor.id, transactionPassword, { required: true });

    const now = await this.read();
    const next = { deposit: deposit ?? now.deposit, withdraw: withdraw ?? now.withdraw };
    await this.sequelize.query(
      `INSERT INTO manual_payment_control (id, manual_deposit_enabled, manual_withdraw_enabled, updated_by, updated_at)
       VALUES (1, :deposit, :withdraw, :staffId, now())
       ON CONFLICT (id) DO UPDATE
         SET manual_deposit_enabled = EXCLUDED.manual_deposit_enabled,
             manual_withdraw_enabled = EXCLUDED.manual_withdraw_enabled,
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
      { replacements: { ...next, staffId: actor.id } }
    );

    this.logger?.warn({ actorStaffId: actor.id, ...next }, 'Manual payments switched');
    return this.read();
  }
}

module.exports = { ManualPaymentsService };
