'use strict';

/**
 * A whitelabel copy's plan — the products and features the parent's Super Admin sold it
 * (docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md).
 *
 *   {
 *     products: { casino, sports, originals },
 *     features: { branch_management, bonus, affiliate, vip, promotions },
 *     payments: { manual, gateways: { ccpayment, f2pay, upi } },
 *   }
 *
 * Stored on the parent (`whitelabels.plan`) and on the copy (`whitelabel_settings.plan`). On the
 * copy it is a ceiling over the owner's document: whatever the plan leaves out reads as not
 * entitled, whatever the owner document says. A copy with no stored plan is not limited.
 */

const PRODUCTS = Object.freeze(['casino', 'sports', 'originals']);
const FEATURES = Object.freeze(['branch_management', 'bonus', 'affiliate', 'vip', 'promotions']);
/** The payment gateways (owner flags `gateway_<key>`). A copy's gateway runs on the parent's account. */
const GATEWAYS = Object.freeze(['ccpayment', 'f2pay', 'upi']);
/** Not integrated on the parent (owner, 2026-11-01): never offered to a copy. */
const NOT_OFFERED = Object.freeze(['apay', 'waypay', 'cricpay']);

/** Plan key → the entitlement flags it covers. */
const PRODUCT_FLAGS = Object.freeze({
  casino: ['casino'],
  sports: ['sports', 'sportsexchange', 'sportsbook'],
  originals: ['originals'],
});

/** Plan feature → the catalogue features (and flags) it covers. Policies are not here. */
const FEATURE_KEYS = Object.freeze({ bonus: ['bonus'], affiliate: ['affiliate'], vip: ['vip'], promotions: ['promotions'] });
const FEATURE_FLAGS = Object.freeze({ bonus: ['bonus'], affiliate: ['affiliate'], vip: ['vipclub'] });

/** Gateway deposits / payouts (`automatic`), manual ones, or both. */
function cashierMode(payments) {
  const gateways = Object.values(payments.gateways).some(Boolean);
  return gateways && payments.manual ? 'both' : gateways ? 'automatic' : 'manual';
}

/** Policy variants the plan decides (written to the copy's site_features). */
function policiesOf(plan) {
  const mode = cashierMode(plan.payments);
  return {
    branch_management: plan.features.branch_management ? 'on' : 'off',
    whitelabel: 'off',
    deposit_mode: mode,
    withdrawal_mode: mode,
  };
}

/** A complete plan with every key a boolean, or null when `value` is not a plan object. */
function cleanPlan(value) {
  if (!value || typeof value !== 'object') return null;
  const pick = (keys, from) => Object.fromEntries(keys.map((k) => [k, from?.[k] === true]));
  return {
    products: pick(PRODUCTS, value.products),
    features: pick(FEATURES, value.features),
    payments: { manual: value.payments?.manual === true, gateways: pick(GATEWAYS, value.payments?.gateways) },
  };
}

/**
 * The owner's entitlements with the plan as a ceiling: every flag and feature the plan leaves
 * out is set false. Policy variants are overridden only where the document carries variants
 * (a document without them is not applied to site_features at all).
 */
function applyPlan(current, plan) {
  const p = cleanPlan(plan);
  if (!p) return current;
  const flags = { ...current.flags };
  const features = { ...current.features };
  for (const [product, keys] of Object.entries(PRODUCT_FLAGS)) {
    if (!p.products[product]) for (const k of keys) flags[k] = false;
  }
  for (const [feature, keys] of Object.entries(FEATURE_KEYS)) {
    if (p.features[feature]) continue;
    for (const k of keys) features[k] = false;
    for (const k of FEATURE_FLAGS[feature] ?? []) flags[k] = false;
  }
  if (!p.products.casino) features.casino_lobby = false;
  for (const g of GATEWAYS) if (!p.payments.gateways[g]) flags[`gateway_${g}`] = false;
  for (const g of NOT_OFFERED) flags[`gateway_${g}`] = false;
  const variants = current.variants ? { ...current.variants, ...policiesOf(p) } : current.variants;
  return { ...current, flags, features, variants, plan: p };
}

/**
 * The parent's commercial terms with a copy (never sent to it):
 *
 *   { fees: { <gateway>: { deposit, withdraw } }, revenueShare: { casino, sports, originals } }
 *
 * Every value a percentage as a string, 0–100 with at most 2 decimals. A gateway deposit of A
 * adds A − A·deposit% to the company's Direct balance; a gateway withdrawal of A takes
 * A + A·withdraw%. The revenue share is reported per product on GGR (stakes − wins), not collected.
 */
function cleanTerms(value) {
  const pct = (v) => (typeof v === 'string' && /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100 ? v : '0');
  return {
    fees: Object.fromEntries(GATEWAYS.map((g) => [g, { deposit: pct(value?.fees?.[g]?.deposit), withdraw: pct(value?.fees?.[g]?.withdraw) }])),
    revenueShare: Object.fromEntries(PRODUCTS.map((p) => [p, pct(value?.revenueShare?.[p])])),
  };
}

module.exports = { cleanTerms, PRODUCTS, FEATURES, GATEWAYS, PRODUCT_FLAGS, cleanPlan, applyPlan, policiesOf, cashierMode };
