// Self-check for the push → stale-read mapping. Run: node src/lib/realtime-keys.test.mjs
import assert from 'node:assert/strict'

import { REALTIME_EVENTS, REALTIME_PREFIXES, isStale } from './realtime-keys.ts'

const stale = (event, key) => isStale(key, REALTIME_PREFIXES[event])

assert.deepEqual(REALTIME_EVENTS, ['siteConfigUpdated', 'featuresUpdated', 'currenciesUpdated', 'entitlements:changed'])

// Flags / branding save
assert.ok(stale('siteConfigUpdated', ['api', 'admin/site-config/global', null]))
assert.ok(stale('siteConfigUpdated', ['api', 'admin/site-config/public', null]))
assert.ok(stale('siteConfigUpdated', ['api', 'admin/branding/public', null]))
assert.ok(stale('siteConfigUpdated', ['api', 'admin/entitlements', null]))
assert.ok(!stale('siteConfigUpdated', ['api', 'admin/features', null]))

// Features save
assert.ok(stale('featuresUpdated', ['paged', 'admin/features', { page: 1 }]))
assert.ok(stale('featuresUpdated', ['api', 'admin/features/public', null]))
assert.ok(!stale('featuresUpdated', ['api', 'admin/site-config/global', null]))

// Coins save: the registry and the default coin
assert.ok(stale('currenciesUpdated', ['api', 'admin/currencies', null]))
assert.ok(stale('currenciesUpdated', ['api', 'admin/site-config/public', null]))

// Owner plan change: everything config-shaped
for (const path of ['admin/entitlements', 'admin/features/catalogue', 'admin/site-config/sports', 'admin/branding', 'admin/currencies/public'])
  assert.ok(stale('entitlements:changed', ['api', path, null]), path)

// Never: unrelated reads, look-alike prefixes, other key families
assert.ok(!stale('entitlements:changed', ['api', 'admin/dashboard', null]))
assert.ok(!stale('entitlements:changed', ['api', 'admin/featuresX', null]))
assert.ok(!stale('entitlements:changed', ['session', 'me']))
assert.ok(!stale('entitlements:changed', ['zip', 'admin/features', null]))

console.log('realtime-keys: ok')
