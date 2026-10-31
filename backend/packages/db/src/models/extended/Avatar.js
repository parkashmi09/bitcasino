'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 115.
// Domain: extended — owned by admin-service (written), read by admin-service only; user-service
// reaches it through `/internal/admin/avatars`.

const { Model, DataTypes } = require('sequelize');

/** An avatar a player may pick, unlocked from `min_level` (the computed VIP level). */
class Avatar extends Model {}

module.exports = (sequelize) => {
  Avatar.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      image_data: { type: DataTypes.BLOB, allowNull: false, field: 'image_data' },
      content_type: { type: DataTypes.TEXT, allowNull: false, field: 'content_type' },
      byte_size: { type: DataTypes.INTEGER, allowNull: false, field: 'byte_size' },
      /** Short sha256 of the bytes — the `?v=` of an immutable image URL. */
      version: { type: DataTypes.TEXT, allowNull: false, field: 'version' },
      min_level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'min_level' },
      sort: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'enabled' },
      updated_by: { type: DataTypes.INTEGER, allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'Avatar',
      tableName: 'avatars',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Avatar;
};
