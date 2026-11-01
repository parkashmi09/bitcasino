'use strict';

/**
 * A whitelabel copy's plan — the products and features the parent's Super Admin sold it
 * (docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md).
 *
 *   { products: { casino, sports, originals }, features: { branch_management, bonus, affiliate, vip, promotions } }
 *
 * Stored on the parent (`whitelabels.plan`) and on the copy (`whitelabel_settings.plan`). On the
 * copy it is a ceiling over the owner's document: whatever the plan leaves out reads as not
 * entitled, whatever the owner document says. A copy with no stored plan is not limited.
 */

const PRODUCTS = Object.freeze(['casino', 'sports', 'originals']);
const FEATURES = Object.freeze(['branch_management', 'bonus', 'affiliate', 'vip', 'promotions']);

/** Plan key → the entitlement flags it covers. */
const PRODUCT_FLAGS = Object.freeze({
  casino: ['casino'],
  sports: ['sports', 'sportsexchange', 'sportsbook'],
  originals: ['originals'],
});

/** Plan feature → the catalogue features (and flags) it covers. Policies are not here. */
const FEATURE_KEYS = Object.freeze({ bonus: ['bonus'], affiliate: ['affiliate'], vip: ['vip'], promotions: ['promotions'] });
const FEATURE_FLAGS = Object.freeze({ bonus: ['bonus'], affiliate: ['affiliate'], vip: ['vipclub'] });

/** Policy variants the plan decides (written to the copy's site_features). */
function policiesOf(plan) {
  return { branch_management: plan.features.branch_management ? 'on' : 'off', whitelabel: 'off' };
}

/** A complete plan with every key a boolean, or null when `value` is not a plan object. */
function cleanPlan(value) {
  if (!value || typeof value !== 'object') return null;
  const pick = (keys, from) => Object.fromEntries(keys.map((k) => [k, from?.[k] === true]));
  return { products: pick(PRODUCTS, value.products), features: pick(FEATURES, value.features) };
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
  const variants = current.variants ? { ...current.variants, ...policiesOf(p) } : current.variants;
  return { ...current, flags, features, variants, plan: p };
}

module.exports = { PRODUCTS, FEATURES, PRODUCT_FLAGS, cleanPlan, applyPlan, policiesOf };
