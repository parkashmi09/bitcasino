// The default / reward coin must be a coin the site offers: the owner store refuses a switched-off one.
//   node --test scripts/coinGate.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import { coinSwitchedOff } from '../src/lib/entitlements/coinGate.ts'

const FIAT = new Set(['inr', 'pkr'])

test('a coin whose own flag is off is switched off', () => {
  assert.equal(coinSwitchedOff('inr', { inr: false }, FIAT), true)
  assert.equal(coinSwitchedOff('usdt', { usdt: false, cryptocoin: true }, FIAT), true)
})

test('a crypto coin is off when the crypto master switch is off; a fiat coin is not', () => {
  assert.equal(coinSwitchedOff('usdt', { usdt: true, cryptocoin: false }, FIAT), true)
  assert.equal(coinSwitchedOff('inr', { inr: true, cryptocoin: false }, FIAT), false)
})

test('an allowed coin (or one with no flag yet) is on', () => {
  assert.equal(coinSwitchedOff('usdt', { usdt: true, cryptocoin: true }, FIAT), false)
  assert.equal(coinSwitchedOff('btc', {}, FIAT), false)
})
