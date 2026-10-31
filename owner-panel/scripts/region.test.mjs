// Region restriction (src/lib/entitlements/region.ts): the owner panel's country list mirrors the
// backend's (backend/packages/common/src/regionPolicy.js), the save validator refuses bad codes
// (the store answers 422), and the policy entry matches the backend catalogue.
//   node --test scripts/region.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { featureByKey, isPolicy, isVariantOf } from '../src/configs/entitlementCatalogue.ts'
import { COUNTRY_CODES, cleanRegion, parseCountries, regionProblem } from '../src/lib/entitlements/region.ts'

const require = createRequire(import.meta.url)
const backend = require('../../backend/packages/common/src/regionPolicy.js')
const backendCatalogue = require('../../backend/packages/common/src/featureCatalogue.js')

test('mirrors the backend: same codes, same policy and variants', () => {
  assert.deepEqual(COUNTRY_CODES, [...backend.COUNTRY_CODES])
  const ours = featureByKey('region_restriction')
  const theirs = backendCatalogue.featureByKey('region_restriction')

  assert.equal(isPolicy('region_restriction'), true)
  assert.equal(ours.defaultVariant, 'none')
  assert.equal(theirs.defaultVariant, 'none')
  assert.deepEqual(ours.variants.map(v => v.key), theirs.variants.map(v => v.key))
  assert.deepEqual(ours.variants.map(v => v.key), ['none', 'notice', 'block'])
  for (const v of ['none', 'notice', 'block']) assert.equal(isVariantOf('region_restriction', v), true)
  assert.equal(isVariantOf('region_restriction', 'off'), false)
})

test('the save validator: good input passes, bad codes and shapes are named', () => {
  assert.equal(regionProblem({ listType: 'blocklist', countries: ['US', 'GB'] }), null)
  assert.equal(regionProblem({ listType: 'allowlist', countries: [] }), null)
  assert.match(regionProblem({ listType: 'blocklist', countries: ['US', 'ZZ'] }), /"ZZ"/)
  assert.match(regionProblem({ listType: 'blocklist', countries: ['us'] }), /"us"/)
  assert.match(regionProblem({ listType: 'blocklist', countries: ['USA'] }), /not ISO 3166-1/)
  assert.match(regionProblem({ listType: 'blocklist', countries: [1] }), /not ISO/)
  assert.match(regionProblem({ listType: 'denylist', countries: [] }), /listType/)
  assert.match(regionProblem({ listType: 'blocklist', countries: 'US' }), /must be a list/)
  assert.match(regionProblem({ listType: 'blocklist', countries: [], mode: 'block' }), /region.mode is not a field/)
  assert.match(regionProblem(null), /must be an object/)
})

test('reading cleans; typing parses', () => {
  assert.deepEqual(cleanRegion({ listType: 'x', countries: ['gb', 'US', 'US', 'ZZ'] }), { listType: 'blocklist', countries: ['GB', 'US'] })
  assert.deepEqual(cleanRegion(undefined), { listType: 'blocklist', countries: [] })
  assert.deepEqual(parseCountries(' us, gb;de  us'), ['US', 'GB', 'DE'])
})
