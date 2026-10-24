'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 019.
// Domain: extended/club — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A club banner image and its title.
 *
 * RECONSTRUCTED. `club_banners` was referenced by mounted routes and never existed.
 */
class ClubBanner extends Model {}

module.exports = (sequelize) => {
  ClubBanner.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      club_id: { type: DataTypes.BIGINT, allowNull: false, field: 'club_id' },
      title: { type: DataTypes.STRING(200), allowNull: false, field: 'title' },
      /** `<clubKey>/<name>` relative to the banner root — never absolute. */
      image_path: { type: DataTypes.TEXT, allowNull: false, field: 'image_path' },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    },
    {
      sequelize,
      modelName: 'ClubBanner',
      tableName: 'club_banners',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return ClubBanner;
};
