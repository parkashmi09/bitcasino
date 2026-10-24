'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 019.
// Domain: extended/club — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A notification announcing a club banner.
 *
 * RECONSTRUCTED. `club_banner_notifications` was referenced by mounted routes and never existed.
 */
class ClubBannerNotification extends Model {}

module.exports = (sequelize) => {
  ClubBannerNotification.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      club_id: { type: DataTypes.BIGINT, allowNull: false, field: 'club_id' },
      sender_id: { type: DataTypes.BIGINT, allowNull: false, field: 'sender_id' },
      title: { type: DataTypes.STRING(200), allowNull: false, field: 'title' },
      body: { type: DataTypes.TEXT, allowNull: true, field: 'body' },
      type: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'general', field: 'type' },
      additional_data: { type: DataTypes.JSONB, allowNull: true, field: 'additional_data' },
      banner_id: { type: DataTypes.BIGINT, allowNull: false, field: 'banner_id' },
    },
    {
      sequelize,
      modelName: 'ClubBannerNotification',
      tableName: 'club_banner_notifications',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return ClubBannerNotification;
};
