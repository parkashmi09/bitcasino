'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pOrderSell extends Model {}

module.exports = (sequelize) => {
  P2pOrderSell.init({
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
    payment_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "payment_type_id",
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
    account_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "account_name",
    },
    account_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "account_number",
    },
    ifsc_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "ifsc_code",
    },
    upi_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "upi_id",
    },
    qr_image: {
      type: DataTypes.BLOB,
      allowNull: true,
      field: "qr_image",
    },
    admin_note: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "admin_note",
    },
    admin_payment_proof: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "admin_payment_proof",
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
    released_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "released_at",
    },
  }, {
    sequelize,
    modelName: "P2pOrderSell",
    tableName: "p2p_orders_sell",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return P2pOrderSell;
};
