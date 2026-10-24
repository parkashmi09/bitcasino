'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 142.
// Domain: extended/admin — owned by admin-service (branding images by content hash, immutable).

const { Model, DataTypes } = require('sequelize');

class OwnerBrandingAsset extends Model {}

module.exports = (sequelize) => {
  OwnerBrandingAsset.init(
    {
      file: { type: DataTypes.STRING(80), primaryKey: true, allowNull: false, field: 'file' },
      content_type: { type: DataTypes.STRING(40), allowNull: false, field: 'content_type' },
      byte_size: { type: DataTypes.INTEGER, allowNull: false, field: 'byte_size' },
      bytes: { type: DataTypes.BLOB, allowNull: false, field: 'bytes' },
    },
    {
      sequelize,
      modelName: 'OwnerBrandingAsset',
      tableName: 'owner_branding_assets',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  return OwnerBrandingAsset;
};
