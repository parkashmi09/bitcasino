'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 142.
// Domain: extended/admin — owned by admin-service (one row per owner save).

const { Model, DataTypes } = require('sequelize');

class OwnerAudit extends Model {}

module.exports = (sequelize) => {
  OwnerAudit.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
      version: { type: DataTypes.INTEGER, allowNull: false, field: 'version' },
      at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'at' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
      entry: { type: DataTypes.JSONB, allowNull: false, field: 'entry' },
    },
    {
      sequelize,
      modelName: 'OwnerAudit',
      tableName: 'owner_audit',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  return OwnerAudit;
};
