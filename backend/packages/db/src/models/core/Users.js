'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// Foreign keys:
//   parent_staff_id -> staff(id)

const { Model, DataTypes } = require('sequelize');

class Users extends Model {}

module.exports = (sequelize) => {
  Users.init({
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "name",
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: "unique_email",
      field: "email",
    },
    password: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "password",
    },
    balance: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "balance",
    },
    profit: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "profit",
    },
    avatar: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "avatar",
    },
    wallet: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "wallet",
    },
    profit_high: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "profit_high",
    },
    profit_low: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "profit_low",
    },
    muted: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "muted",
    },
    games_played: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: "0",
      field: "games_played",
    },
    level: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: "1",
      field: "level",
    },
    friends: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "friends",
    },
    slot_uid: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: "0",
      field: "slot_uid",
    },
    slot_coin: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "slot_coin",
    },
    password2: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "password2",
    },
    isb: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "isb",
    },
    two_fa: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "two_fa",
    },
    two_fa_status: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "two_fa_status",
    },
    rakeback: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "rakeback",
    },
    rakeamount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "rakeamount",
    },
    referalcode: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "referalcode",
    },
    refree: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "refree",
    },
    referral_link: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "referral_link",
    },
    phone: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "phone",
    },
    country: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "country",
    },
    parent_staff_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "staff", key: "id" },
      field: "parent_staff_id",
    },
    role_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "role_id",
    },
    bonus_type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bonus_type",
    },
    wager_multiplier: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "3",
      field: "wager_multiplier",
    },
    is_locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "is_locked",
    },
    lock_targetx: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "lock_targetx",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "active",
      field: "status",
    },
    bet_status: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "active",
      field: "bet_status",
    },
    sports_betlocked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "sports_betlocked",
    },
    casino_locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "casino_locked",
    },
    system_locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "system_locked",
    },
    gt: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "gt",
    },
    exposure_limit: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "exposure_limit",
    },
    last_ip: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "last_ip",
    },
    last_login_at: {
      type: 'TIMESTAMP',
      allowNull: true,
      field: "last_login_at",
    },
    net_win: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: "0",
      field: "net_win",
    },
    net_loss: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: "0",
      field: "net_loss",
    },
    total_profit: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: "0",
      field: "total_profit",
    },
    casino_gt: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "casino_gt",
    },
    created_estimated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "created_estimated",
    },
  }, {
    sequelize,
    modelName: "Users",
    tableName: "users",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_users_created",
        fields: ["created"],
      },
      {
        name: "idx_users_created_estimated",
        fields: ["created_estimated"],
      },
      {
        name: "idx_users_parent_staff_id",
        fields: ["parent_staff_id"],
      },
    ],
  });

  return Users;
};
