// model/admin/Owner.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes17 } from "sequelize";
var Owner = db_default.define(
  "Owner",
  {
    owner_id: {
      type: DataTypes17.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    website_name: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    domain_name: {
      type: DataTypes17.STRING,
      allowNull: false,
      unique: true
    },
    website_ui: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    country: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    logo: {
      type: DataTypes17.STRING,
      // Store the file path or URL
      allowNull: false
    },
    favicon: {
      type: DataTypes17.STRING,
      // Store the file path or URL
      allowNull: false
    },
    game_providers: {
      type: DataTypes17.JSON,
      // Store as JSON for multiple providers
      allowNull: false
    },
    subscription_plan: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    platform_configurations: {
      type: DataTypes17.JSON,
      // Store as JSON for multiple configurations
      allowNull: false
    },
    payment_methods: {
      type: DataTypes17.JSON,
      // Store as JSON for multiple payment methods
      allowNull: false
    },
    site_email_address: {
      type: DataTypes17.STRING,
      allowNull: false,
      unique: true
      // Ensure email is unique
    },
    password: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    platform_name: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes17.ENUM("OWNER"),
      allowNull: false
    },
    account_status: {
      type: DataTypes17.BOOLEAN,
      defaultValue: true
    },
    unlimited_balance: {
      type: DataTypes17.BOOLEAN,
      defaultValue: true,
      comment: "If true, owner has unlimited balance and no deductions occur. If false, balance is deducted."
    },
    first_login: {
      type: DataTypes17.BOOLEAN,
      defaultValue: false
    },
    rules_accepted: {
      type: DataTypes17.BOOLEAN,
      defaultValue: false,
      comment: "True once the rules modal has been accepted after login"
    },
    transaction_password: {
      type: DataTypes17.STRING,
      allowNull: true,
      comment: "Stored as plain text"
    },
    txn_password_attempts: {
      type: DataTypes17.INTEGER,
      allowNull: true,
      defaultValue: 10,
      comment: "Transaction password attempts left; reset to 10 on a successful attempt"
    },
    // ── Secure auth (2FA) ────────────────────────────────────────────────
    // securityAuthType is the source of truth for HOW this account logs in:
    // 'telegram' | 'google' | null. telegram2FAEnabled/telegramChatId stay as
    // the Telegram transport; googleAuthSecret is the base32 TOTP secret.
    googleAuthSecret: {
      type: DataTypes17.STRING,
      allowNull: true
    },
    securityAuthType: {
      type: DataTypes17.STRING,
      allowNull: true,
      defaultValue: null
    },
    telegramChatId: {
      type: DataTypes17.STRING,
      allowNull: true
    },
    telegram2FAEnabled: {
      type: DataTypes17.BOOLEAN,
      defaultValue: false
    },
    login_id: {
      type: DataTypes17.STRING,
      allowNull: true,
      comment: "Unique ID for the current active login session (single-session enforcement)"
    }
  }
);
var Owner_default = Owner;

export { Owner_default };
