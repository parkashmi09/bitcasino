'use strict';

const { money } = require('@ibitplay/common');

/**
 * PKR per INR at the site's exchange rates (`exchangerate.usd_rate` is USD per unit), as a decimal
 * string, or null when either rate is missing. Used by the owner's "INR games in PKR" policies
 * (gis.service.js for Slotegrator, jsGames.service.js for JSGames v2).
 */
async function pkrPerInr(db) {
  const rows = await db.sequelize.query(
    "SELECT UPPER(currency) AS currency, usd_rate FROM exchangerate WHERE UPPER(currency) IN ('INR', 'PKR')",
    { type: db.sequelize.QueryTypes.SELECT }
  );
  const rate = Object.fromEntries(rows.map((r) => [r.currency, String(r.usd_rate)]));
  if (!rate.INR || !rate.PKR || money.isZero(rate.PKR)) return null;
  return money.toDecimalString(money.divide(rate.INR, rate.PKR));
}

module.exports = { pkrPerInr };
