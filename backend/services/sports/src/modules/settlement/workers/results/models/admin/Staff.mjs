// model/admin/Staff.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";
import { Role_default } from "./Role.mjs";

import { DataTypes as DataTypes10 } from "sequelize";
var Staff = db_default.define("Staff", {
  staff_id: {
    type: DataTypes10.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes10.STRING,
    allowNull: false,
    unique: true
  },
  fullname: {
    type: DataTypes10.STRING,
    allowNull: true
  },
  city: {
    type: DataTypes10.STRING,
    allowNull: true
  },
  // "Mobile Number" on the admin create-account form. The form has always
  // sent it for staff too, but there was no column to keep it in, so More →
  // Additional Information showed a blank Mobile Number for every staff
  // account (user, 2026-09-21). Added by ensureStaffPhoneNumberColumn() in
  // config/dbInit.js, the same idempotent way the other late columns were.
  phone_number: {
    type: DataTypes10.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes10.STRING,
    allowNull: true,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes10.STRING,
    allowNull: false
  },
  role_id: {
    type: DataTypes10.INTEGER,
    allowNull: false,
    references: {
      model: Role_default,
      key: "role_id"
    }
  },
  role: {
    type: DataTypes10.STRING,
    allowNull: false,
    comment: "Denormalized role name for quick lookup (e.g., SUPER_ADMIN, ADMIN, USER)"
  },
  level: {
    type: DataTypes10.STRING,
    allowNull: false,
    comment: "Denormalized level (L1, L2, ..., L6)"
  },
  parent_id: {
    type: DataTypes10.INTEGER,
    allowNull: true
    // ✅ REMOVED the references block - let associations handle it
  },
  parent_owner_id: {
    type: DataTypes10.INTEGER,
    allowNull: true,
    comment: "ID of the owner who created this staff member (if applicable)"
  },
  percentage: {
    type: DataTypes10.DECIMAL(8, 3),
    allowNull: true,
    defaultValue: null
  },
  credit_limit: {
    type: DataTypes10.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0,
    comment: "Maximum credit allowed for this staff member"
  },
  active: {
    type: DataTypes10.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "Indicates if the staff member is active"
  },
  first_login: {
    type: DataTypes10.BOOLEAN,
    defaultValue: false
  },
  // Operator-set permission, ticked on the create-account form. false = this
  // account may NOT change its own password once the mandatory first-login
  // change (first_login: false -> true) is done. Default true so every
  // pre-existing account keeps behaving exactly as before.
  passwordChangeAllowed: {
    type: DataTypes10.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "false = account cannot change its own password after the first-login change"
  },
  rules_accepted: {
    type: DataTypes10.BOOLEAN,
    defaultValue: false,
    comment: "True once the rules modal has been accepted after login"
  },
  transaction_password: {
    type: DataTypes10.STRING,
    allowNull: true,
    comment: "Stored as plain text"
  },
  txn_password_attempts: {
    type: DataTypes10.INTEGER,
    allowNull: true,
    defaultValue: 10,
    comment: "Transaction password attempts left; 0 locks txn actions + login until the parent changes this staff password (which resets it to 10)"
  },
  // ── Secure auth (2FA) ────────────────────────────────────────────────
  // securityAuthType is the source of truth for HOW this account logs in:
  // 'telegram' | 'google' | null. telegram2FAEnabled/telegramChatId stay as
  // the Telegram transport; googleAuthSecret is the base32 TOTP secret.
  googleAuthSecret: {
    type: DataTypes10.STRING,
    allowNull: true
  },
  securityAuthType: {
    type: DataTypes10.STRING,
    allowNull: true,
    defaultValue: null
  },
  telegramChatId: {
    type: DataTypes10.STRING,
    allowNull: true
  },
  telegram2FAEnabled: {
    type: DataTypes10.BOOLEAN,
    defaultValue: false
  },
  bet_locked: {
    type: DataTypes10.BOOLEAN,
    defaultValue: false,
    comment: "If true, this staff and all downline cannot place bets"
  },
  exp_limit: {
    type: DataTypes10.DECIMAL(20, 2),
    allowNull: true,
    defaultValue: null,
    comment: "Max exposure limit for the staff"
  },
  bal_down: {
    type: DataTypes10.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: 0,
    comment: "Balance down value for the staff member"
  },
  bal_up: {
    type: DataTypes10.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: 0,
    comment: "Balance up value for the staff member"
  },
  login_id: {
    type: DataTypes10.STRING,
    allowNull: true,
    comment: "Unique ID for the current active login session (single-session enforcement)"
  }
}, {
  tableName: "staff",
  // ✅ Explicitly set lowercase table name
  timestamps: true,
  paranoid: true
});
Staff.belongsTo(Role_default, {
  foreignKey: "role_id",
  as: "roleDetails"
});
Staff.belongsTo(Staff, {
  foreignKey: "parent_id",
  as: "parent"
});
Staff.hasMany(Staff, {
  foreignKey: "parent_id",
  as: "children"
});
var Staff_default = Staff;

export { Staff_default };
