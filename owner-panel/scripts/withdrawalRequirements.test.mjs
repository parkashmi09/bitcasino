// Withdrawal requirements: the owner panel's policy entry mirrors the backend catalogue
// (backend/packages/common/src/featureCatalogue.js), so a save is accepted by the backend apply.
//   node --test scripts/withdrawalRequirements.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { featureByKey, isPolicy, isVariantOf } from '../src/configs/entitlementCatalogue.ts'
import { demoVariants } from './seed-owner.mjs'
import {
  cleanWithdrawalCap,
  DEFAULT_WITHDRAWAL_CAP,
  diffWithdrawalCap,
  switchesOf,
  variantOfSwitches,
  withdrawalCapLabel,
  withdrawalCapProblem
} from '../src/lib/entitlements/withdrawalCap.ts'

const require = createRequire(import.meta.url)
const backendCatalogue = require('../../backend/packages/common/src/featureCatalogue.js')

const KEY = 'withdrawal_requirements'

test('mirrors the backend: a policy, same default and variants', () => {
  const ours = featureByKey(KEY)
  const theirs = backendCatalogue.featureByKey(KEY)

  assert.equal(isPolicy(KEY), true)
  assert.equal(theirs.kind, 'policy')
  assert.equal(ours.category, 'business')
  assert.equal(ours.defaultVariant, 'kyc')
  assert.equal(theirs.defaultVariant, 'kyc')
  assert.deepEqual(ours.variants.map(v => v.key), ['none', 'kyc', 'wager', 'kyc_and_wager'])
  assert.deepEqual(ours.variants.map(v => v.key), theirs.variants.map(v => v.key))
  assert.deepEqual(ours.variants.map(v => v.label), theirs.variants.map(v => v.label))
  for (const v of ['none', 'kyc', 'wager', 'kyc_and_wager']) assert.equal(isVariantOf(KEY, v), true)
  assert.equal(isVariantOf(KEY, 'both'), false)
})

test('the demo seed keeps today’s behaviour: kyc', () => {
  assert.equal(demoVariants()[KEY], 'kyc')
})

// ── The switches: KYC × wagering = the variant, the deposit cap = `withdrawalCap` ──────────
const backendCap = require('../../backend/packages/common/src/withdrawalCap.js')

test('backward compatible: the four stored variants map onto the two switches and back', () => {
  const expect = { none: [false, false], kyc: [true, false], wager: [false, true], kyc_and_wager: [true, true] }

  for (const [variant, [kyc, wager]] of Object.entries(expect)) {
    assert.deepEqual(switchesOf(variant), { kyc, wager }, variant)
    assert.equal(variantOfSwitches({ kyc, wager }), variant)
  }

  // Today's setting (kyc) is KYC on, wagering off; an unknown or missing variant reads as the default.
  assert.deepEqual(switchesOf(undefined), { kyc: true, wager: false })
  assert.deepEqual(switchesOf('both'), { kyc: true, wager: false })
})

test('the cap block mirrors the backend: defaults, reading, strict save validation', () => {
  assert.deepEqual(DEFAULT_WITHDRAWAL_CAP, { ...backendCap.DEFAULTS })
  assert.deepEqual(cleanWithdrawalCap(undefined), { enabled: false, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 })

  const cases = [
    { enabled: true, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 },
    { enabled: true, depositMultiplier: 2.5, wagerBonus: false, wagerMultiplier: 100 },
    { enabled: false, depositMultiplier: 0, wagerBonus: true, wagerMultiplier: 5 },
    { enabled: true, depositMultiplier: -1, wagerBonus: true, wagerMultiplier: 5 },
    { enabled: true, depositMultiplier: 101, wagerBonus: true, wagerMultiplier: 5 },
    { enabled: true, depositMultiplier: 1.234, wagerBonus: true, wagerMultiplier: 5 },
    { enabled: true, depositMultiplier: '3', wagerBonus: true, wagerMultiplier: 5 },
    { enabled: 'yes', depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 },
    { enabled: true, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5, cap: 1 },
    { enabled: true, depositMultiplier: Infinity, wagerBonus: true, wagerMultiplier: 5 },
    null
  ]

  for (const c of cases) {
    assert.equal(withdrawalCapProblem(c), backendCap.withdrawalCapProblem(c), JSON.stringify(c))
    assert.deepEqual(cleanWithdrawalCap(c), backendCap.cleanWithdrawalCap(c), JSON.stringify(c))
  }

  assert.equal(withdrawalCapProblem(cases[0]), null)
  assert.equal(withdrawalCapProblem(cases[1]), null)
  assert.match(withdrawalCapProblem(cases[2]), /depositMultiplier must be a number above 0/)
  assert.match(withdrawalCapProblem(cases[4]), /at most 100/)
  assert.match(withdrawalCapProblem(cases[5]), /2 decimals/)
  assert.match(withdrawalCapProblem(cases[7]), /enabled must be true or false/)
  assert.match(withdrawalCapProblem(cases[8]), /withdrawalCap.cap is not a field/)
})

test('an older document (no withdrawalCap) is not a change; switching the cap on is one audited change', () => {
  assert.equal(diffWithdrawalCap(undefined, cleanWithdrawalCap(undefined)), null)

  const on = { enabled: true, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 }

  assert.deepEqual(diffWithdrawalCap(undefined, on), { kind: 'withdrawal_cap', key: 'withdrawalCap', from: cleanWithdrawalCap(undefined), to: on })
  assert.deepEqual(diffWithdrawalCap({ ...on, depositMultiplier: 2 }, on).from.depositMultiplier, 2)
  assert.equal(withdrawalCapLabel(on), '3× deposits + wagering up to 5×')
  assert.equal(withdrawalCapLabel({ ...on, wagerBonus: false }), '3× deposits')
  assert.equal(withdrawalCapLabel(cleanWithdrawalCap(undefined)), 'Off')
})
