// Owner-only feature options (e.g. when the spin wheel grants a spin): the owner panel's list
// mirrors the backend's (backend/packages/common/src/featureOptions.js), a missing key reads as
// its default, and an option has a readable label for the change list and audit.
//   node --test scripts/featureOptions.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { FEATURE_OPTIONS, optionLabel, resolveOptions } from '../src/configs/entitlementCatalogue.ts'

const require = createRequire(import.meta.url)
const backend = require('../../backend/packages/common/src/featureOptions.js')

test('mirrors the backend: same features, same option keys, same defaults', () => {
  assert.deepEqual(Object.keys(FEATURE_OPTIONS), Object.keys(backend.FEATURE_OPTIONS))
  for (const [feature, entries] of Object.entries(FEATURE_OPTIONS)) {
    assert.deepEqual(Object.fromEntries(entries.map(o => [o.key, o.default])), { ...backend.FEATURE_OPTIONS[feature] }, feature)
  }
})

test("the spin wheel's defaults are today's behaviour", () => {
  assert.deepEqual(resolveOptions(undefined).spin_wheel, {
    grant_on_registration: true,
    grant_on_first_deposit: false,
    grant_on_every_deposit: true,
    bonus_on_first_deposit: true,
    bonus_on_later_deposits: true
  })
})

test('the bonus wagering lock is on by default', () => {
  assert.deepEqual(resolveOptions(undefined).bonus, { wagering_lock: true })
})

test('the Tournaments page is on by default wherever races are on', () => {
  assert.deepEqual(resolveOptions(undefined).races, { tournaments_page: true })
  assert.equal(resolveOptions({ races: { tournaments_page: false } }).races.tournaments_page, false)
})

test('a missing key reads as its default; unknown keys and non-booleans are dropped', () => {
  const out = resolveOptions({ spin_wheel: { grant_on_registration: false, grant_on_first_deposit: 'yes', bogus: true }, other: { x: true } })

  assert.equal(out.spin_wheel.grant_on_registration, false)
  assert.equal(out.spin_wheel.grant_on_first_deposit, false)
  assert.equal('bogus' in out.spin_wheel, false)
  assert.equal('other' in out, false)
})

test('an option has a readable label for the change list', () => {
  assert.equal(optionLabel('spin_wheel.grant_on_registration'), 'Spin wheel: Free spin on registration')
})
