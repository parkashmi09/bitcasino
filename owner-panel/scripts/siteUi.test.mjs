// This client's UI profile (src/configs/siteUi.ts): every catalogue feature classified, every pinned
// variant real, the hash_game template equal to the pins, and pinToUi enforcing the three classes.
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

test('hash_game is the default template and matches the pins', () => {
  assert.equal(DEFAULT_TEMPLATE, 'hash_game')
  for (const key of features) assert.equal(templateByKey('hash_game').variants[key], pinnedVariant(key), key)
})

test('pinToUi: toggle keeps on/off, fixed stays on, absent stays off', () => {
  const { features: f, variants: v } = pinToUi({ vip: false, swap: true, casino_lobby: false, spin_wheel: true }, { vip: 'program_page', spin_wheel: 'inline_wheel', business_model: 'b2b' })
  assert.equal(f.vip, false)
  assert.equal(v.vip, 'ring_panel')
  assert.equal(f.swap, true)
  assert.equal(f.casino_lobby, true)
  assert.equal(f.spin_wheel, false)
  assert.equal(v.spin_wheel, 'none')
  assert.equal(v.business_model, 'b2b')
})
