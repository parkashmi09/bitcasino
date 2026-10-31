// Payment gateway methods per currency (the document's `paymentMethods`): reading drops anything
// malformed, saving refuses it, and the change list compares cleaned blocks.
//   node --test scripts/paymentMethods.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { buildDraft } from '../src/lib/entitlements/draft.ts'
import {
  cleanPaymentMethods,
  DEFAULT_PAYMENT_METHODS,
  diffPaymentMethods,
  isMethodCode,
  MAX_METHODS_PER_CURRENCY,
  paymentMethodsLabel,
  paymentMethodsProblem
} from '../src/lib/entitlements/paymentMethods.ts'

const GOOD = { f2pay: { INR: [{ code: 'UpiMixed', active: true }], IDR: [{ code: 'QRIS', active: true }, { code: 'DANA', active: false }] } }

test('an older document (no block) lists no methods', () => {
  assert.deepEqual(cleanPaymentMethods(undefined), DEFAULT_PAYMENT_METHODS)
  assert.deepEqual(cleanPaymentMethods(null), {})
  assert.deepEqual(cleanPaymentMethods([]), {})
})

test('a good block reads as it is, code case kept', () => {
  assert.deepEqual(cleanPaymentMethods(GOOD), GOOD)
  assert.equal(paymentMethodsProblem(GOOD), null)
  assert.equal(isMethodCode('UpiMixed'), true)
  assert.equal(isMethodCode('BRI VA'), false)
})

test('reading drops a bad gateway, currency, method or repeat', () => {
  const read = cleanPaymentMethods({
    F2PAY: { INR: [{ code: 'UpiMixed', active: true }] },
    f2pay: {
      idr: [{ code: 'QRIS', active: true }],
      IDR: [{ code: 'QRIS', active: true }, { code: 'QRIS', active: false }, { code: 'BRI VA', active: true }, { code: 'DANA', active: 'yes' }, 'BNI'],
      INR: 'UpiMixed'
    }
  })

  assert.deepEqual(read, { f2pay: { IDR: [{ code: 'QRIS', active: true }] } })
})

test('reading keeps at most the per-currency maximum', () => {
  const many = Array.from({ length: MAX_METHODS_PER_CURRENCY + 5 }, (_, i) => ({ code: `M${i}`, active: true }))

  assert.equal(cleanPaymentMethods({ f2pay: { IDR: many } }).f2pay.IDR.length, MAX_METHODS_PER_CURRENCY)
})

test('saving refuses anything malformed with a clear problem', () => {
  const cases = [
    [[], /must be an object/],
    [{ F2Pay: {} }, /not a gateway name/],
    [{ f2pay: [] }, /currency → methods/],
    [{ f2pay: { idr: [] } }, /not a currency code/],
    [{ f2pay: { IDR: {} } }, /list of methods/],
    [{ f2pay: { IDR: [{ code: 'QRIS' }] } }, /active must be true or false/],
    [{ f2pay: { IDR: [{ code: 'QR IS', active: true }] } }, /not a method code/],
    [{ f2pay: { IDR: [{ code: 'QRIS', active: true, extra: 1 }] } }, /each method is \{ code, active \}/],
    [{ f2pay: { IDR: [{ code: 'QRIS', active: true }, { code: 'QRIS', active: false }] } }, /listed twice/],
    [{ f2pay: { IDR: Array.from({ length: MAX_METHODS_PER_CURRENCY + 1 }, (_, i) => ({ code: `M${i}`, active: true })) } }, /at most/]
  ]

  for (const [value, expected] of cases) assert.match(paymentMethodsProblem(value) ?? '', expected, JSON.stringify(value).slice(0, 80))
})

test('the change list compares cleaned blocks, key order ignored', () => {
  assert.equal(diffPaymentMethods(undefined, {}), null)
  assert.equal(diffPaymentMethods(GOOD, { f2pay: { IDR: GOOD.f2pay.IDR, INR: GOOD.f2pay.INR } }), null)

  const change = diffPaymentMethods(GOOD, { f2pay: { ...GOOD.f2pay, IDR: [{ code: 'QRIS', active: false }] } })

  assert.equal(change?.kind, 'payment_methods')
  assert.equal(change?.key, 'paymentMethods')
  assert.match(paymentMethodsLabel(change.to), /f2pay IDR: QRIS \(off\)/)
  assert.equal(paymentMethodsLabel({}), 'None')
})

test('the draft carries the edited block, else the loaded one', () => {
  const doc = { template: 't', features: {}, flags: {}, variants: {}, options: {}, paymentMethods: GOOD }

  assert.deepEqual(buildDraft(doc, null).paymentMethods, GOOD)
  assert.deepEqual(buildDraft(doc, { features: {}, flags: {}, variants: {}, options: {}, paymentMethods: {} }).paymentMethods, {})
})

// The backend's reader (backend/packages/common/src/paymentMethods.js), once it exists, reads the same.
const backendPath = new URL('../../backend/packages/common/src/paymentMethods.js', import.meta.url)

test('the backend reads a block the same way', { skip: !existsSync(backendPath) && 'backend paymentMethods.js not there yet' }, () => {
  const backend = createRequire(import.meta.url)(backendPath.pathname)
  const clean = backend.cleanPaymentMethods

  for (const sample of [undefined, GOOD, { f2pay: { IDR: [{ code: 'QRIS', active: true }, { code: 'QRIS', active: false }] } }]) {
    assert.deepEqual(clean(sample), cleanPaymentMethods(sample))
  }
})
