'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 014.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A player's place in a club.
 *
 * The table did not exist. `legacy/clubmembership/membershipController.js`
 * references it fourteen times, and the club routes are mounted — so joining a
 * club, changing a role and counting members have all been failing with
 * "relation does not exist" since deployment. See migration 014 for where each
 * column's name comes from.
 *
 * `role` is text rather than an enum on purpose: the legacy queries compare it
 * as text (`role != 'owner'`, `role = 'agent'`) and an enum would break those
 * during a cutover.
 */
class ClubMembership extends Model {}

module.exports = (sequelize) => {
  ClubMembership.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      club_id: { type: DataTypes.BIGINT, allowNull: false, field: 'club_id' },
      role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'member', field: 'role' },
      /** An agent's own recruitment code. Unique where present. */
      unique_agent_code: { type: DataTypes.STRING(50), allowNull: true, field: 'unique_agent_code' },
      /** Who recruited this member. Null for an owner. */
      agent_id: { type: DataTypes.BIGINT, allowNull: true, field: 'agent_id' },
      parent_club_id: { type: DataTypes.BIGINT, allowNull: true, field: 'parent_club_id' },
      joined_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'joined_at' },
    },
    {
      sequelize,
      modelName: 'ClubMembership',
      tableName: 'club_memberships',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return ClubMembership;
};
