'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Siteconfig extends Model {}

module.exports = (sequelize) => {
  Siteconfig.init({
    registerbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "registerbonus",
    },
    createdat: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "createdat",
    },
    updatedat: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "updatedat",
    },
    affiliatebonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "20",
      field: "affiliatebonus",
    },
    comissionpercent: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "5",
      field: "comissionpercent",
    },
    inr: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "inr",
    },
    mvr: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "mvr",
    },
    aed: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "aed",
    },
    pkr: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "pkr",
    },
    cryptocoin: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "cryptocoin",
    },
    bjb: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "bjb",
    },
    casino: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "casino",
    },
    lotto: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "lotto",
    },
    vipclub: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "vipclub",
    },
    clubmembership: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "clubmembership",
    },
    bonus: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "bonus",
    },
    affiliate: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "affiliate",
    },
    crash: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "crash",
    },
    originals: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "originals",
    },
    livegames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "livegames",
    },
    slotsgames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "slotsgames",
    },
    alllivegames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "alllivegames",
    },
    allslotsgames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "allslotsgames",
    },
    lotterygames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "lotterygames",
    },
    indiangames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "indiangames",
    },
    cards: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "cards",
    },
    jilli: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "jilli",
    },
    bdt: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "bdt",
    },
    clubrake: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "clubrake",
    },
    instantgames: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "instantgames",
    },
    btc: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "btc",
    },
    eth: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "eth",
    },
    ltc: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "ltc",
    },
    bch: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "bch",
    },
    usdt: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "usdt",
    },
    trx: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "trx",
    },
    doge: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "doge",
    },
    ada: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "ada",
    },
    xrp: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "xrp",
    },
    bnb: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "bnb",
    },
    usdp: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "usdp",
    },
    nexo: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "nexo",
    },
    mkr: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "mkr",
    },
    tusd: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "tusd",
    },
    usdc: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "usdc",
    },
    busd: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "busd",
    },
    nc: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "nc",
    },
    npr: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "npr",
    },
    shib: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "shib",
    },
    matic: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "matic",
    },
    sc: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "sc",
    },
    spribe: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "spribe",
    },
    evolution: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "evolution",
    },
    pragmaticslots: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "pragmaticslots",
    },
    pragmaticlive: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "pragmaticlive",
    },
    ideal: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "ideal",
    },
    microgaming: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "microgaming",
    },
    pgsoft: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "pgsoft",
    },
    hacksawgaming: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "hacksawgaming",
    },
    jili: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "jili",
    },
    netent: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "netent",
    },
    provablyfair: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "provablyfair",
    },
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    apaynotificationemail: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: "salvin.dev.cfz@gmail.com",
      field: "apaynotificationemail",
    },
    gmailuser: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "gmailuser",
    },
    gmailapppassword: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "gmailapppassword",
    },
    welcomepack: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "welcomepack",
    },
    wheelspin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "wheelspin",
    },
    home_latestwins: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_latestwins",
    },
    home_paymentbanner: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_paymentbanner",
    },
    home_livecasino: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_livecasino",
    },
    home_popularslots: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_popularslots",
    },
    home_crashgames: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_crashgames",
    },
    home_leaderboard: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_leaderboard",
    },
    home_welcomebanner: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_welcomebanner",
    },
    home_heroSection: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_heroSection",
    },
    giftcards: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "giftcards",
    },
    home_gamingcards: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_gamingcards",
    },
    home_bonus500banner: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_bonus500banner",
    },
    home_promocards: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "home_promocards",
    },
  }, {
    sequelize,
    modelName: "Siteconfig",
    tableName: "siteconfig",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Siteconfig;
};
