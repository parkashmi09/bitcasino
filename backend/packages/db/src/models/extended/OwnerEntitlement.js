'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 142.
// Domain: extended/admin — owned by admin-service (the owner's signed document, one row per version).
// Never holds a secret: the owner panel's keys and password stay in env.

const { Model, DataTypes } = require('sequelize');

class OwnerEntitlement extends Model {}

module.exports = (sequelize) => {
  OwnerEntitlement.init(
    {
      version: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false, field: 'version' },
      site: { type: DataTypes.STRING(100), allowNull: true, field: 'site' },
      doc: { type: DataTypes.JSONB, allowNull: false, field: 'doc' },
      signature: { type: DataTypes.STRING(128), allowNull: true, field: 'signature' },
      signature_ed25519: { type: DataTypes.STRING(200), allowNull: true, field: 'signature_ed25519' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'OwnerEntitlement',
      tableName: 'owner_entitlements',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  return OwnerEntitlement;
};
