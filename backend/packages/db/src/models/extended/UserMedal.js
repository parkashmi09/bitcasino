'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 093.
// Domain: extended — written and read by user-service (`medals`).

const { Model, DataTypes } = require('sequelize');

/**
 * One profile medal a player holds. The catalogue and rules are code
 * (`modules/medals/medals.constants.js`); this row is only the fact of holding
 * it and since when. Composite key: (user_id, medal_type, sub_type).
 */
class UserMedal extends Model {}

module.exports = (sequelize) => {
  UserMedal.init(
    {
      user_id: { type: DataTypes.BIGINT, allowNull: false, primaryKey: true, field: 'user_id' },
      medal_type: { type: DataTypes.SMALLINT, allowNull: false, primaryKey: true, field: 'medal_type' },
      sub_type: { type: DataTypes.STRING(8), allowNull: false, primaryKey: true, defaultValue: '0', field: 'sub_type' },
      unlocked_at: { type: DataTypes.DATE, allowNull: false, field: 'unlocked_at' },
    },
    {
      sequelize,
      modelName: 'UserMedal',
      tableName: 'user_medals',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: false,
    }
  );

  return UserMedal;
};
