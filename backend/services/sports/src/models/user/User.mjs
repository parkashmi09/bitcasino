// model/user/User.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes4 } from "sequelize";
import bcrypt from "bcryptjs";
var User = db_default.define("User", {
  user_id: {
    type: DataTypes4.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes4.STRING,
    allowNull: false,
    unique: true
  },
  fullname: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  city: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes4.STRING,
    allowNull: true,
    unique: true
  },
  phone_number: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  country: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  telegramChatId: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  telegram2FAEnabled: {
    type: DataTypes4.BOOLEAN,
    defaultValue: false
  },
  // Base32 TOTP secret for Google Authenticator. Written when the user starts
  // the setup (so the QR survives a refresh) but only ACTIVE once
  // securityAuthType === 'google'.
  googleAuthSecret: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  // Which secure-auth method the account uses at login:
  // 'android' | 'telegram' | 'google', or null when 2FA is off.
  // This is the single source of truth — telegram2FAEnabled only records that
  // a Telegram chat is linked.
  securityAuthType: {
    type: DataTypes4.STRING,
    allowNull: true,
    defaultValue: null,
    comment: "Active 2FA method: 'android' | 'telegram' | 'google' | null"
  },
  //  Removed coin_type
  password: {
    type: DataTypes4.STRING,
    allowNull: false
  },
  passwordChanged: {
    type: DataTypes4.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: "Indicates whether user has changed default password"
  },
  // Operator-set permission, ticked on the create-account form. false = this
  // account may NOT change its own password once the mandatory first-login
  // change (passwordChanged: false -> true) is done. Default true so every
  // pre-existing account keeps behaving exactly as before.
  passwordChangeAllowed: {
    type: DataTypes4.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "false = account cannot change its own password after the first-login change"
  },
  //  Role ID reference
  role_id: {
    type: DataTypes4.INTEGER,
    allowNull: false,
    comment: "FK to roles table"
  },
  credit_limit: {
    type: DataTypes4.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0,
    comment: "Maximum credit allowed for this user"
  },
  //  Hierarchy columns
  parent_staff_id: {
    type: DataTypes4.INTEGER,
    allowNull: true,
    comment: "References Staff table (who created this user)"
  },
  parent_owner_id: {
    type: DataTypes4.INTEGER,
    allowNull: true,
    comment: "If user was created by an owner, reference owner ID"
  },
  //  Keep role name for readability
  role: {
    type: DataTypes4.STRING,
    allowNull: false,
    defaultValue: "USER"
  },
  percentage: {
    type: DataTypes4.DECIMAL(8, 3),
    allowNull: true,
    defaultValue: 0
  },
  net_win: {
    type: DataTypes4.DECIMAL(18, 2),
    allowNull: true,
    defaultValue: 0
  },
  net_loss: {
    type: DataTypes4.DECIMAL(18, 2),
    allowNull: true,
    defaultValue: 0
  },
  profit: {
    type: DataTypes4.DECIMAL(18, 2),
    allowNull: true,
    defaultValue: 0
  },
  status: {
    type: DataTypes4.ENUM("Active", "InActive", "Pending"),
    defaultValue: "Active"
  },
  bet_locked: {
    type: DataTypes4.BOOLEAN,
    defaultValue: false,
    comment: "If true, user cannot place bets"
  },
  exp_limit: {
    type: DataTypes4.DECIMAL(20, 2),
    allowNull: true,
    defaultValue: null,
    comment: "Max exposure limit for the user"
  },
  login_id: {
    type: DataTypes4.STRING,
    allowNull: true,
    comment: "Unique ID for the current active login session"
  },
  user_gt: {
    type: DataTypes4.STRING,
    allowNull: true
  },
  rules_accepted: {
    type: DataTypes4.BOOLEAN,
    defaultValue: false,
    comment: "True once the rules modal has been accepted after login"
  },
  // Demo account (see server/demo/README.md). A demo user is a REAL row that
  // bets and settles through the normal engine; it only differs in that it
  // lives under the dedicated demo owner, its P&L never rolls up
  // (walletService.updateAllPointHierarchy skips it), the tracker ignores it,
  // and it is deactivated at demo_expires_at then purged by demoCleanup.
  is_demo: {
    type: DataTypes4.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: "true = throwaway demo account minted by POST /api/user/demo-login"
  },
  demo_expires_at: {
    type: DataTypes4.DATE,
    allowNull: true,
    comment: "Demo session end; authMiddleware rejects the token past this"
  }
}, {
  tableName: "users",
  timestamps: true
});
var User_default = User;

export { User_default };
