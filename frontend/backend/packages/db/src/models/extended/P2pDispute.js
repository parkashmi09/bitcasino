'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pDispute extends Model {}

module.exports = (sequelize) => {
  P2pDispute.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    order_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "order_id",
    },
    order_no: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "order_no",
    },
    user_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "user_id",
    },
    order_type: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "order_type",
    },
    reason: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "reason",
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "message",
    },
    screenshot: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "screenshot",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "status",
    },
    admin_note: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "admin_note",
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "resolved_at",
    },
  }, {
    sequelize,
    modelName: "P2pDispute",
    tableName: "p2p_disputes",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return P2pDispute;
};
