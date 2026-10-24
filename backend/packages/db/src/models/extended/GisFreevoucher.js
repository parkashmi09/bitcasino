'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 016.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A Slotegrator free voucher — live-casino table credit with a winnings cap.
 *
 * RECONSTRUCTED. `gis_freevouchers` was referenced by three live routes and
 * never existed. See migration 016.
 */
class GisFreevoucher extends Model {}

module.exports = (sequelize) => {
  GisFreevoucher.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      voucher_id: { type: DataTypes.STRING(190), allowNull: false, field: 'voucher_id' },
      title: { type: DataTypes.TEXT, allowNull: false, field: 'title' },
      currency: { type: DataTypes.STRING(10), allowNull: false, field: 'currency' },
      initial_balance: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'initial_balance' },
      max_winnings: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'max_winnings' },
      /** Remaining playable credit; seeded from initial_balance. */
      playable: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'playable' },
      valid_until: { type: DataTypes.DATE, allowNull: true, field: 'valid_until' },
      /** Which live tables it may be played at. */
      table_ids: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [], field: 'table_ids' },
      short_terms: { type: DataTypes.TEXT, allowNull: true, field: 'short_terms' },
      terms_and_conds: { type: DataTypes.TEXT, allowNull: true, field: 'terms_and_conds' },
      /** Active | Canceled | Forfeited — the provider's vocabulary, not ours. */
      state: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'Active', field: 'state' },
    },
    {
      sequelize,
      modelName: 'GisFreevoucher',
      tableName: 'gis_freevouchers',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return GisFreevoucher;
};
