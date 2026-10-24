'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 026.
// Domain: extended — written by admin-service, read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A push notification that was sent to one player.
 *
 * The companion to `user_fcm_tokens`, which holds the devices. Neither existed
 * when the routes over them were written — the tokens table was created by
 * migration 019 for the club broadcasts, and this one by 026.
 */
class UserNotifications extends Model {}

module.exports = (sequelize) => {
  UserNotifications.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      title: { type: DataTypes.STRING(200), allowNull: false, field: 'title' },
      body: { type: DataTypes.TEXT, allowNull: true, field: 'body' },
      type: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'general', field: 'type' },
      /** What the app routes on — which screen to open, which match. */
      additional_data: { type: DataTypes.JSONB, allowNull: true, field: 'additional_data' },
      is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_read' },
      /** WHEN it was read. Legacy stored only the boolean. */
      read_at: { type: DataTypes.DATE, allowNull: true, field: 'read_at' },
      /** Whether the push actually reached a device, and why not. */
      delivered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'delivered' },
      delivery_error: { type: DataTypes.TEXT, allowNull: true, field: 'delivery_error' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'UserNotifications',
      tableName: 'user_notifications',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return UserNotifications;
};
