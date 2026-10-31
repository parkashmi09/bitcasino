'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 099.
// Domain: extended/admin — owned by admin-service.
//
// Staff aur owner ka wallet. Ye `credits` table ki hi rows hain (player wali
// rows ke saath), bas pehchaan `staff_id` se hoti hai, `uid` se nahi:
//
//   user_type 'OWNER'  → Super Admin (level 1) ka wallet
//   user_type 'STAFF'  → baaki sab staff (Admin … Agent)
//
// Player ki row ke liye `Credits` model use karo (uid se).

const { Model, DataTypes } = require('sequelize');

class StaffCredits extends Model {}

module.exports = (sequelize) => {
  StaffCredits.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
      staff_id: { type: DataTypes.BIGINT, allowNull: false, unique: true, field: 'staff_id' },
      user_type: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'STAFF', field: 'user_type' },

      // Asli balance (INR)
      inr: { type: DataTypes.DECIMAL, allowNull: false, defaultValue: '0', field: 'inr' },

      // Kitna minus me ja sakta hai jab player ko paisa de (agent ki credit line)
      credit_limit: { type: DataTypes.DECIMAL, allowNull: false, defaultValue: '0', field: 'credit_limit' },
      exposure_limit: { type: DataTypes.DECIMAL, allowNull: false, defaultValue: '0', field: 'exposure_limit' },

      // Zip ke points: parent ne kitna diya, aur point ledger ka jod
      credit: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: '0', field: 'credit' },
      all_point: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: '0', field: 'all_point' },
    },
    {
      sequelize,
      modelName: 'StaffCredits',
      tableName: 'credits',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );
  return StaffCredits;
};
