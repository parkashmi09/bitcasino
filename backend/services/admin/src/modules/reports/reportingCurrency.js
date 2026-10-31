'use strict';

const { defaultCurrencyOf } = require('@ibitplay/common');
const { effectiveStaffLevel, STAFF_LEVELS } = require('@ibitplay/auth');

/**
 * The coin "All currencies" totals are valued in: the site's DEFAULT COIN
 * (the owner's `default_currency` policy, USDT when unset) — the same coin
 * every admin money screen opens on, so a converted total reads in the unit
 * the operator actually runs the site in rather than in USD.
 *
 * Every session but the Super Admin's (and its executives') is the agent
 * system, which runs on INR (user, 2026-10-17): pass `staff` and it gets INR.
 */
async function reportingCurrency(models, staff) {
  const level = staff ? effectiveStaffLevel(staff) : null;
  if (Number.isFinite(level) && level > STAFF_LEVELS.SUPER_ADMIN) return 'INR';
  if (typeof models?.SiteFeature?.findByPk !== 'function') return defaultCurrencyOf(null);
  const row = await models.SiteFeature.findByPk('default_currency', { attributes: ['variant'], raw: true }).catch(() => null);
  return defaultCurrencyOf(row?.variant);
}

/**
 * `userwager` (and everything derived from it — VIP progress) is counted in USD.
 * For display it is carried into the site's default coin at today's rate, the way
 * every converted admin total is; USD when that coin has no rate.
 *
 * @returns {Promise<{ currency: string, of: (usd: string|number|null) => string|null }>}
 */
async function wagerValuer(models, staff) {
  // Required here, not at the top: the helpers module is the bigger one and this keeps the
  // dependency one-way for anything that only wants `reportingCurrency`.
  const { loadRates, createValuer, decimal } = require('./audienceStats.helpers');
  const [rates, target] = await Promise.all([loadRates(models), reportingCurrency(models, staff)]);
  const valuer = createValuer(rates, null, target);
  return {
    currency: valuer.currency,
    of: (usd) => (usd == null ? null : decimal(valuer.value(String(usd).replace(/,/g, ''), 'USD'))),
  };
}

module.exports = { reportingCurrency, wagerValuer };
