'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 047.
// Domain: extended/admin — owned by admin-service.

const { Model, DataTypes } = require('sequelize');

class SiteFeature extends Model {}

module.exports = (sequelize) => {
  SiteFeature.init(
    {
      feature: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false, field: 'feature' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'enabled' },
      variant: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'none', field: 'variant' },
      config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'config' },
      secrets: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'secrets' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
      /** The owner document's on/off when last applied (migration 146); a Super Admin switch stands until it changes. */
      owner_enabled: { type: DataTypes.BOOLEAN, allowNull: true, field: 'owner_enabled' },
    },
    {
      sequelize,
      modelName: 'SiteFeature',
      tableName: 'site_features',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  return SiteFeature;
};
