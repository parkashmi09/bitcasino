'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 067.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * The site admin's settings for one lobby provider: on/off, logo, display name
 * and order. No row means enabled with no logo — see migration 067.
 */
class CasinoProviderSetting extends Model {}

module.exports = (sequelize) => {
  CasinoProviderSetting.init(
    {
      /** The catalogue's provider name, lowercased and trimmed. */
      provider: { type: DataTypes.STRING(190), primaryKey: true, allowNull: false, field: 'provider' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'enabled' },
      display_name: { type: DataTypes.STRING(80), allowNull: true, field: 'display_name' },
      sort_order: { type: DataTypes.INTEGER, allowNull: true, field: 'sort_order' },
      logo_data: { type: DataTypes.BLOB, allowNull: true, field: 'logo_data' },
      logo_content_type: { type: DataTypes.STRING(40), allowNull: true, field: 'logo_content_type' },
      logo_byte_size: { type: DataTypes.INTEGER, allowNull: true, field: 'logo_byte_size' },
      logo_updated_at: { type: DataTypes.DATE, allowNull: true, field: 'logo_updated_at' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'CasinoProviderSetting',
      tableName: 'casino_provider_settings',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return CasinoProviderSetting;
};
