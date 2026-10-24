// The reward currency policy — what PUT /api/owner/entitlements accepts for variants.reward_currency,
// and that the owner panel's list mirrors the backend's (backend/packages/common/src/currencies.js).
//   node --test scripts/rewardCurrency.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { FEATURE_CATALOGUE, REWARD_CURRENCIES, featureByKey, isPolicy, isVariantOf, variantLabel } from '../src/configs/entitlementCatalogue.ts'

const require = createRequire(import.meta.url)
const backend = require('../../backend/packages/common/src/currencies.js')
const backendCatalogue = require('../../backend/packages/common/src/featureCatalogue.js')

test('reward_currency is a policy, default USDT, with no Off', () => {
  const f = featureByKey('reward_currency')

  assert.ok(f)
  assert.equal(isPolicy('reward_currency'), true)
  assert.equal(f.defaultVariant, 'USDT')
  assert.equal(f.variants.some(v => v.key === 'none'), false, 'rewards always pay in something')
  assert.match(f.note, /All rewards — VIP, bonuses, rakeback, affiliate, spin wheel — are calculated and paid in this currency/)
  assert.equal(variantLabel('reward_currency', 'INR'), 'INR — Indian rupee')
})

test('the store accepts only creditable coins (isVariantOf is the PUT validation)', () => {
  for (const code of ['USDT', 'INR', 'EUR', 'BTC']) assert.equal(isVariantOf('reward_currency', code), true, code)
  for (const code of ['BJB', 'NC', 'USD', 'inr', 'QAC', 'none', '']) assert.equal(isVariantOf('reward_currency', code), false, code)
})

test('mirrors the backend: same codes, same order, same names, same catalogue entry', () => {
  assert.deepEqual(REWARD_CURRENCIES.map(c => c.code), [...backend.REWARD_CURRENCY_CHOICES])
  for (const c of REWARD_CURRENCIES) assert.equal(c.name, backend.REWARD_CURRENCY_NAMES[c.code], c.code)

  for (const c of REWARD_CURRENCIES) {
    assert.equal(backend.isRetiredCurrency(c.code), false, `${c.code} is retired`)
    assert.equal(backend.isBuiltinCurrency(c.code), true, `${c.code} has no credits column`)
  }

  const ours = featureByKey('reward_currency')
  const theirs = backendCatalogue.featureByKey('reward_currency')

  assert.equal(theirs.kind, 'policy')
  assert.equal(theirs.defaultVariant, ours.defaultVariant)
  assert.deepEqual(ours.variants, theirs.variants.map(v => ({ key: v.key, label: v.label, description: v.description })))
})

test('every backend policy is in the owner catalogue', () => {
  const backendPolicies = backendCatalogue.FEATURES.filter(f => f.kind === 'policy').map(f => f.key)
  const ownerPolicies = FEATURE_CATALOGUE.filter(f => f.policy).map(f => f.key)

  assert.deepEqual(ownerPolicies, backendPolicies)
})

test('default_currency: a policy separate from the reward currency, default USDT, mirrors the backend', () => {
  const ours = featureByKey('default_currency')
  const theirs = backendCatalogue.featureByKey('default_currency')

  assert.ok(ours)
  assert.equal(isPolicy('default_currency'), true)
  assert.equal(ours.defaultVariant, 'USDT')
  assert.equal(ours.variants.some(v => v.key === 'none'), false)
  assert.equal(variantLabel('default_currency', 'INR'), 'INR — Indian rupee')
  for (const code of ['USDT', 'INR', 'BTC']) assert.equal(isVariantOf('default_currency', code), true, code)
  for (const code of ['BJB', 'NC', 'none', '']) assert.equal(isVariantOf('default_currency', code), false, code)
  assert.equal(theirs.kind, 'policy')
  assert.equal(theirs.defaultVariant, ours.defaultVariant)
  assert.deepEqual(ours.variants, theirs.variants.map(v => ({ key: v.key, label: v.label, description: v.description })))
  assert.deepEqual(ours.variants.map(v => v.key), [...backend.DEFAULT_CURRENCY_CHOICES])
})
