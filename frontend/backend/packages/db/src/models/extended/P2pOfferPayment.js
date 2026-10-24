'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pOfferPayment extends Model {}

module.exports = (sequelize) => {
  P2pOfferPayment.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
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
  }, {
    sequelize,
    modelName: "P2pOfferPayment",
    tableName: "p2p_offer_payments",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return P2pOfferPayment;
};
