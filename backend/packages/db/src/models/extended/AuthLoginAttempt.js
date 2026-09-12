'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 001-auth-sessions.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * Append-only log of login attempts, successful and not.
 *
 * Two jobs: throttle brute-force attempts (count recent failures per identifier
 * and per IP), and give support a record when a player disputes access.
 * Rows are written for identifiers that do not exist too — otherwise the table
 * itself would reveal which accounts are real.
 */
class AuthLoginAttempt extends Model {}

module.exports = (sequelize) => {
  AuthLoginAttempt.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      identifier: { type: DataTypes.STRING(190), allowNull: false, field: 'identifier' },
      ip_address: { type: DataTypes.STRING(64), allowNull: true, field: 'ip_address' },
      successful: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'successful' },
      failure_reason: { type: DataTypes.STRING(64), allowNull: true, field: 'failure_reason' },
    },
    {
      sequelize,
      modelName: 'AuthLoginAttempt',
      tableName: 'auth_login_attempts',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [
        { name: 'idx_login_attempts_identifier', fields: ['identifier', 'created_at'] },
        { name: 'idx_login_attempts_ip', fields: ['ip_address', 'created_at'] },
      ],
    }
  );

  return AuthLoginAttempt;
};
