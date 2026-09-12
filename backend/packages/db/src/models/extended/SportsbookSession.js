'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 031.
// Domain: extended — written and read by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A launched third-party sportsbook session.
 *
 * Legacy minted a session id and discarded it, which left `logout` and
 * `refresh-token` operating on whatever the request body named. See migration
 * 031 for what that made possible.
 */
class SportsbookSession extends Model {}

module.exports = (sequelize) => {
  SportsbookSession.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      /** The id WE generate and hand to the provider — not the provider's token. */
      session_id: { type: DataTypes.UUID, allowNull: false, field: 'session_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      sportsbook_uuid: { type: DataTypes.STRING(64), allowNull: false, field: 'sportsbook_uuid' },
      /** The provider's token. Never returned to anyone but the session's owner. */
      token: { type: DataTypes.TEXT, allowNull: true, field: 'token' },
      launch_url: { type: DataTypes.TEXT, allowNull: true, field: 'launch_url' },
      currency: { type: DataTypes.STRING(20), allowNull: false, field: 'currency' },
      language: { type: DataTypes.STRING(10), allowNull: true, field: 'language' },
      /** open | closed */
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open', field: 'status' },
      ip_address: { type: DataTypes.STRING(64), allowNull: true, field: 'ip_address' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
      closed_at: { type: DataTypes.DATE, allowNull: true, field: 'closed_at' },
    },
    {
      sequelize,
      modelName: 'SportsbookSession',
      tableName: 'sportsbook_sessions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return SportsbookSession;
};
