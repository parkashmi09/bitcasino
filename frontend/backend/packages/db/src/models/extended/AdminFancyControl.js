'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 024.
// Domain: extended — read by sports-service.

const { Model, DataTypes } = require('sequelize');

/**
 * Whether a fancy market is open to players.
 *
 * The upstream feed returns every fancy market an event has. This table is how
 * an operator closes one — a market with `show_fancy = false` is filtered out
 * of the feed response before it reaches a player, so it cannot be bet.
 *
 * ── THE TABLE DID NOT EXIST ──────────────────────────────────────────────
 *
 * `sportsApiAdminFancyController.js` references `admin_fancy_control` seven
 * times across five mounted routes and no migration ever created it. Every one
 * of them has returned "relation does not exist" since it was written, so no
 * fancy market has ever actually been closed — the endpoint that would close
 * one errored and the market stayed live. See migration 024.
 *
 * ── ON THE ID COLUMNS BEING TEXT ─────────────────────────────────────────
 *
 * `event_id` and `market_id` are the provider's, and the provider sends them as
 * strings. The legacy controller does `String(marketId).trim()` before every
 * use, which is the right instinct — some are numeric and some are not, and
 * comparing a varchar to a number in Postgres is a type error rather than an
 * empty result.
 */
class AdminFancyControl extends Model {}

module.exports = (sequelize) => {
  AdminFancyControl.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
        field: 'id',
      },
      event_id: { type: DataTypes.STRING(64), allowNull: false, field: 'event_id' },
      event_name: { type: DataTypes.STRING(255), allowNull: true, field: 'event_name' },
      market_id: { type: DataTypes.STRING(64), allowNull: false, field: 'market_id' },
      market_name: { type: DataTypes.STRING(255), allowNull: true, field: 'market_name' },
      /** TRUE means players may see and bet this market. */
      show_fancy: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'show_fancy' },
      /** The staff member who last changed it, from a verified token. */
      updated_by: { type: DataTypes.BIGINT, allowNull: true, field: 'updated_by' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'AdminFancyControl',
      tableName: 'admin_fancy_control',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      /**
       * Declared so `bulkCreate({ updateOnDuplicate })` can build its
       * `ON CONFLICT` target. Sequelize derives that from the model's unique
       * keys, not from the indexes the database happens to have — an index that
       * exists only in the migration produces a conflict clause naming the
       * wrong column, and the bulk update fails at the first duplicate.
       */
      indexes: [{ name: 'uq_admin_fancy_control_market', unique: true, fields: ['market_id'] }],
    }
  );

  return AdminFancyControl;
};
