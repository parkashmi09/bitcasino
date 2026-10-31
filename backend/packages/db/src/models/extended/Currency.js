'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 061.
// Domain: extended/admin — owned by admin-service (the coin registry).

const { Model, DataTypes } = require('sequelize');

class Currency extends Model {}

module.exports = (sequelize) => {
  Currency.init(
    {
      code: { type: DataTypes.STRING(10), primaryKey: true, allowNull: false, field: 'code' },
      kind: { type: DataTypes.STRING(10), allowNull: false, field: 'kind' },
      decimals: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 8, field: 'decimals' },
      builtin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'builtin' },
      owner_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'owner_enabled' },
      site_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'site_enabled' },
      name: { type: DataTypes.STRING(60), allowNull: false, field: 'name' },
      symbol: { type: DataTypes.STRING(12), allowNull: false, defaultValue: '', field: 'symbol' },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000, field: 'sort_order' },
      image_asset: { type: DataTypes.STRING(64), allowNull: true, field: 'image_asset' },
      image_data: { type: DataTypes.BLOB, allowNull: true, field: 'image_data' },
      image_content_type: { type: DataTypes.STRING(40), allowNull: true, field: 'image_content_type' },
      image_byte_size: { type: DataTypes.INTEGER, allowNull: true, field: 'image_byte_size' },
      networks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'networks' },
      // migration 065: the owner's fixed USD value of one unit (custom coins; NULL for built-in ones).
      usd_rate: { type: DataTypes.DECIMAL(24, 8), allowNull: true, field: 'usd_rate' },
      retired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'retired' },
      managed_by: { type: DataTypes.STRING(20), allowNull: true, field: 'managed_by' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'Currency',
      tableName: 'currencies',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  return Currency;
};
