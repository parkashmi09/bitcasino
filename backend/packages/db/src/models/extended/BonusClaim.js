'use strict';

// HAND-WRITTEN model (not generated). Table is in 000_baseline_schema.sql.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A bonus that has been AWARDED and is waiting to be claimed.
 *
 * ── WHY THIS IS HAND-WRITTEN, AND CALLED SOMETHING ELSE ──────────────────
 *
 * The table is `bonus_history`. There is also a `bonushistory` table — a
 * different thing entirely, holding `event`/`amount` audit rows. The model
 * generator normalises table names to PascalCase, so both wanted to be
 * `BonusHistory`, and the second one silently overwrote the first.
 *
 * The result was that `bonus_history` — the table the daily/weekly/monthly
 * bonus claim path reads and writes — had NO model at all, and
 * `tools/verify-models.js` reported "every model matches" because it only
 * checked models against tables and never tables against models. It does both
 * now, which is how this was found.
 *
 * Named `BonusClaim` rather than fighting over `BonusHistory`: the name
 * describes what a row IS, and the collision cannot come back.
 *
 * ── THE CLAIM RACE ───────────────────────────────────────────────────────
 * Legacy claimed a bonus by selecting the newest unclaimed row and then running
 * an unconditional `UPDATE ... SET is_claimed = TRUE WHERE id = $1`. Two
 * simultaneous requests selected the same row and both credited. The claim path
 * in `modules/bonus` uses a conditional update guarded by `is_claimed = false`,
 * so the database picks a winner.
 */
class BonusClaim extends Model {}

module.exports = (sequelize) => {
  BonusClaim.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      userid: { type: DataTypes.BIGINT, allowNull: false, field: 'userid' },
      /** daily | weekly | monthly */
      bonus_type: { type: DataTypes.TEXT, allowNull: false, field: 'bonus_type' },
      bonus_amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: '0', field: 'bonus_amount' },
      /** How much the player's wager moved over the period that earned this. */
      wager_change: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: '0', field: 'wager_change' },
      /** After this, the bonus can no longer be claimed. */
      claim_deadline: { type: DataTypes.DATE, allowNull: false, field: 'claim_deadline' },
      is_claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_claimed' },
      /**
       * Awarded but never claimable — the cron writes these so a player can see
       * a period they did not qualify for, rather than a gap in their history.
       */
      is_unclaimable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_unclaimable' },
      claimed_at: { type: DataTypes.DATE, allowNull: true, field: 'claimed_at' },
    },
    {
      sequelize,
      modelName: 'BonusClaim',
      tableName: 'bonus_history',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return BonusClaim;
};
