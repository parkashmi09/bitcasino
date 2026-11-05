// This client's UI profile (src/configs/siteUi.ts): every catalogue feature classified, every pinned
// variant real, the hash_game template naming real variants, and pinToUi enforcing the three classes.
import assert from 'node:assert/strict'
import test from 'node:test'

import { FEATURE_CATALOGUE, isVariantOf } from '../src/configs/entitlementCatalogue.ts'
import { pinnedVariant, pinToUi, SITE_UI } from '../src/configs/siteUi.ts'
import { DEFAULT_TEMPLATE, templateByKey } from '../src/configs/templateCatalogue.ts'

const features = FEATURE_CATALOGUE.filter(f => !f.policy).map(f => f.key)

test('every non-policy feature is classified, with a real variant', () => {
  assert.deepEqual(Object.keys(SITE_UI).sort(), [...features].sort())
  for (const key of features) assert.ok(isVariantOf(key, pinnedVariant(key)), key)
})

// The template's variants mirror the backend's hash_game; what this site draws is its own pins.
test('hash_game is the default template and names only real variants', () => {
  assert.equal(DEFAULT_TEMPLATE, 'hash_game')
  for (const key of features) {
    const v = templateByKey('hash_game').variants[key]

    if (v !== undefined) assert.ok(isVariantOf(key, v), `${key}: ${v}`)
  }
})

test('pinToUi: toggle keeps on/off, fixed stays on, absent stays off', () => {
  for (const asked of [true, false]) {
    const input = Object.fromEntries(features.map(k => [k, asked]))
    const { features: f, variants: v } = pinToUi(input, { vip: 'some_other_variant', business_model: 'b2b' })

    for (const [key, s] of Object.entries(SITE_UI)) {
      const on = s.status === 'absent' ? false : s.status === 'fixed' ? true : asked

      assert.equal(f[key], on, `${key} (${s.status}, asked ${asked})`)
      assert.equal(v[key], pinnedVariant(key), key)
    }
    assert.equal(v.business_model, 'b2b') // a policy is never pinned
  }
})
