'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pOrder extends Model {}

module.exports = (sequelize) => {
  P2pOrder.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
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
    offer_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "offer_id",
    },
    payment_account_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "payment_account_id",
    },
    coin: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "coin",
    },
    fiat: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "fiat",
    },
    price: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "price",
    },
    crypto_amount: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "crypto_amount",
    },
    fiat_amount: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "fiat_amount",
    },
    utr_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "utr_number",
    },
    payment_proof: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "payment_proof",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "status",
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "expires_at",
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "paid_at",
    },
    released_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "released_at",
    },
  }, {
    sequelize,
    modelName: "P2pOrder",
    tableName: "p2p_orders",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return P2pOrder;
};
