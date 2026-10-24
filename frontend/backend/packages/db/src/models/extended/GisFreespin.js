'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 016.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A Slotegrator freespin campaign.
 *
 * RECONSTRUCTED. `gis_freespins` was referenced by three live routes and never
 * existed — the shape here is inferred from the INSERT that failed against it.
 * See migration 016.
 */
class GisFreespin extends Model {}

module.exports = (sequelize) => {
  GisFreespin.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** The campaign id, ours to choose and the provider's to echo back. */
      freespin_id: { type: DataTypes.STRING(190), allowNull: false, field: 'freespin_id' },
      game_uuid: { type: DataTypes.STRING(190), allowNull: false, field: 'game_uuid' },
      currency: { type: DataTypes.STRING(10), allowNull: false, field: 'currency' },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'quantity' },
      quantity_left: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'quantity_left' },
      valid_from: { type: DataTypes.DATE, allowNull: true, field: 'valid_from' },
      valid_until: { type: DataTypes.DATE, allowNull: true, field: 'valid_until' },
      /** Either (bet_id + denomination) or total_bet_id — never both. */
      bet_id: { type: DataTypes.STRING(190), allowNull: true, field: 'bet_id' },
      total_bet_id: { type: DataTypes.STRING(190), allowNull: true, field: 'total_bet_id' },
      denomination: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'denomination' },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', field: 'status' },
      is_canceled: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: 'is_canceled' },
    },
    {
      sequelize,
      modelName: 'GisFreespin',
      tableName: 'gis_freespins',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return GisFreespin;
};
