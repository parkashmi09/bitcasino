'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 019.
// Domain: extended/club — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One member's delivery and read state for a club notification.
 *
 * RECONSTRUCTED. `club_notification_status` was referenced by mounted routes and never existed.
 */
class ClubNotificationStatus extends Model {}

module.exports = (sequelize) => {
  ClubNotificationStatus.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      notification_id: { type: DataTypes.BIGINT, allowNull: false, field: 'notification_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      is_sent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_sent' },
      sent_at: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
      is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_read' },
      /** WHEN it was read. Legacy stored only the boolean. */
      read_at: { type: DataTypes.DATE, allowNull: true, field: 'read_at' },
    },
    {
      sequelize,
      modelName: 'ClubNotificationStatus',
      tableName: 'club_notification_status',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      /**
       * The composite unique key MUST be declared here, not only in the
       * migration.
       *
       * `bulkCreate({ updateOnDuplicate })` builds its `ON CONFLICT` target
       * from the model's declared unique keys. Without this it emits one
       * single-column target per field and Postgres rejects it — so a resend
       * fails with "notification_id must be unique" instead of upserting, and
       * the upsert path is dead code until the day it is needed.
       */
      indexes: [
        {
          name: 'uq_club_notification_status',
          unique: true,
          fields: ['notification_id', 'user_id'],
        },
      ],
    }
  );

  return ClubNotificationStatus;
};
