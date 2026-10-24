'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pPaymentAccount extends Model {}

module.exports = (sequelize) => {
  P2pPaymentAccount.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    payment_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "payment_type_id",
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
    extra_details: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "extra_details",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_active",
    },
  }, {
    sequelize,
    modelName: "P2pPaymentAccount",
    tableName: "p2p_payment_accounts",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return P2pPaymentAccount;
};
