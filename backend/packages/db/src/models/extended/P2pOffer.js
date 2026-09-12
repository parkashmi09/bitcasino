'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pOffer extends Model {}

module.exports = (sequelize) => {
  P2pOffer.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
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
    segment: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "segment",
    },
    price: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "price",
    },
    available_amount: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "available_amount",
    },
    min_limit: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "min_limit",
    },
    max_limit: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "max_limit",
    },
    payment_time: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "payment_time",
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "username",
    },
    avatar_letter: {
      type: DataTypes.STRING(4),
      allowNull: true,
      field: "avatar_letter",
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_verified",
    },
    is_kyc_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_kyc_verified",
    },
    is_featured: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_featured",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "status",
    },
  }, {
    sequelize,
    modelName: "P2pOffer",
    tableName: "p2p_offers",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return P2pOffer;
};
