'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class UserLoginHistory extends Model {}

module.exports = (sequelize) => {
  UserLoginHistory.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    ip_address: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "ip_address",
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "user_agent",
    },
  }, {
    sequelize,
    modelName: "UserLoginHistory",
    tableName: "user_login_history",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_user_login_history_user_created",
        fields: ["user_id", "created_at"],
      },
      {
        name: "idx_user_login_history_user_ip",
        fields: ["user_id", "ip_address"],
      },
    ],
  });

  return UserLoginHistory;
};
