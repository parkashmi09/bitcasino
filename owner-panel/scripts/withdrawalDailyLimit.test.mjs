// Daily withdrawal limit per currency: the owner panel's reader / saver mirror the backend's
// (backend/packages/common/src/withdrawalDailyLimit.js), so a save is accepted by the backend apply.
//   node --test scripts/withdrawalDailyLimit.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { buildDraft } from '../src/lib/entitlements/draft.ts'
import {
  cleanWithdrawalDailyLimit,
  DEFAULT_WITHDRAWAL_DAILY_LIMIT,
  diffWithdrawalDailyLimit,
  isDailyLimit,
  withdrawalDailyLimitLabel,
  withdrawalDailyLimitProblem
} from '../src/lib/entitlements/withdrawalDailyLimit.ts'

const require = createRequire(import.meta.url)
const backend = require('../../backend/packages/common/src/withdrawalDailyLimit.js')

const SAMPLES = [
  null,
  { enabled: true, limits: { INR: '50000' } },
  { enabled: true, limits: { INR: '50000', USDT: '0.5' } },
  { enabled: false, limits: {} },
  { enabled: true, limits: {} },
  { enabled: true, limits: { inr: '1000' } },
  { enabled: true, limits: { INR: '0' } },
  { enabled: true, limits: { INR: '-5' } },
  { enabled: true, limits: { INR: '1.123456789' } },
  { enabled: true, limits: { INR: '1000000000001' } },
  { enabled: true, limits: { INR: 'abc' } },
  { enabled: 'yes', limits: { INR: '1' } },
  { enabled: true, limits: { INR: '1' }, extra: 1 },
  { enabled: true, limits: [] }
]

test('an older document (no block) reads as off', () => {
  assert.deepEqual(cleanWithdrawalDailyLimit(undefined), DEFAULT_WITHDRAWAL_DAILY_LIMIT)
  assert.deepEqual(backend.cleanWithdrawalDailyLimit(undefined), { enabled: false, limits: {} })
})

test('the saver agrees with the backend on what is accepted', () => {
  for (const v of SAMPLES) {
    assert.equal(withdrawalDailyLimitProblem(v) === null, backend.withdrawalDailyLimitProblem(v) === null, JSON.stringify(v))
  }
})

test('the reader keeps the same currencies and amounts as the backend', () => {
  for (const v of SAMPLES) {
    const ours = cleanWithdrawalDailyLimit(v)
    const theirs = backend.cleanWithdrawalDailyLimit(v)

    assert.equal(ours.enabled, theirs.enabled, JSON.stringify(v))
    assert.deepEqual(Object.keys(ours.limits).sort(), Object.keys(theirs.limits).sort(), JSON.stringify(v))
    for (const [code, amount] of Object.entries(ours.limits)) assert.equal(Number(amount), Number(theirs.limits[code]))
  }
})

test('amount rule: above 0, at most 8 decimals, at most a trillion', () => {
  for (const ok of ['1', '0.00000001', '50000', '1000000000000']) assert.equal(isDailyLimit(ok), true, ok)
  for (const bad of ['0', '0.000', '-1', '1e3', '1.123456789', '1000000000000.01', '', ' ']) assert.equal(isDailyLimit(bad), false, bad)
})

test('on with no currency is refused, off with none is fine', () => {
  assert.match(withdrawalDailyLimitProblem({ enabled: true, limits: {} }), /add at least one currency/)
  assert.equal(withdrawalDailyLimitProblem({ enabled: false, limits: {} }), null)
})

test('diff: none when only formatting or order differs, one change otherwise', () => {
  assert.equal(diffWithdrawalDailyLimit(undefined, { enabled: false, limits: {} }), null)
  assert.equal(diffWithdrawalDailyLimit({ enabled: true, limits: { INR: '50000.00', USDT: '5' } }, { enabled: true, limits: { USDT: '5', INR: '50000' } }), null)

  const c = diffWithdrawalDailyLimit({ enabled: true, limits: { INR: '50000' } }, { enabled: true, limits: { INR: '20000' } })

  assert.equal(c.kind, 'withdrawal_daily_limit')
  assert.equal(withdrawalDailyLimitLabel(c.from), 'INR 50,000 per 24 h')
  assert.equal(withdrawalDailyLimitLabel(c.to), 'INR 20,000 per 24 h')
})

test('the working copy carries the block: the saved one, then the owner\'s edit', () => {
  const doc = { template: 't', features: {}, flags: {}, variants: {}, options: {}, withdrawalDailyLimit: { enabled: true, limits: { INR: '1000' } } }

  assert.deepEqual(buildDraft(doc, null).withdrawalDailyLimit, doc.withdrawalDailyLimit)
  assert.deepEqual(buildDraft(doc, { withdrawalDailyLimit: { enabled: false, limits: {} } }).withdrawalDailyLimit, { enabled: false, limits: {} })
})
