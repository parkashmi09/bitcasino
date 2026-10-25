// The owner seed (scripts/seed-owner.mjs): creates a complete document, re-running changes nothing,
// merge keeps the owner's choices, --reset forces the demo state, coins/unknown keys survive.
//   node --test scripts/seedOwner.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { DEFAULT_OFF_FLAGS, FEATURE_KEYS, FLAG_KEYS } from '../src/configs/entitlementCatalogue.ts'
import { demoVariants, planSeed, runSeed } from './seed-owner.mjs'

const site = 'casino-sportsbook'
const now = '2026-01-01T00:00:00.000Z'

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'seed-owner-'))
}

const read = dir => JSON.parse(readFileSync(path.join(dir, 'entitlements.json'), 'utf8'))
const auditLines = dir => readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('demo variants: every catalogue feature, the asked-for ones set', () => {
  const v = demoVariants()

  assert.deepEqual(Object.keys(v).sort(), [...FEATURE_KEYS].sort())
  assert.equal(v.push_notifications, 'onesignal')
  assert.equal(v.reward_currency, 'USDT')
  assert.equal(v.tips, 'peer_to_peer')
  assert.equal(v.club_membership, 'none')
  for (const key of ['vault', 'swap', 'gift_cards', 'vip', 'affiliate', 'bonus', 'promotions', 'spin_wheel', 'blog']) assert.notEqual(v[key], 'none', key)
})

test('creates a complete document, then a re-run is a no-op', async () => {
  const dir = tempDir()

  try {
    const first = await runSeed({ dataDir: dir, site, apply: true, now })

    assert.equal(first.create, true)
    assert.equal(first.applied, true)

    const doc = read(dir)

    assert.equal(doc.version, 1)
    assert.equal(doc.site, site)
    assert.equal(statSync(path.join(dir, 'entitlements.json')).mode & 0o777, 0o600)
    for (const key of FEATURE_KEYS) assert.equal(doc.features[key], key !== 'club_membership', key)
    for (const key of FLAG_KEYS) assert.equal(doc.flags[key], !DEFAULT_OFF_FLAGS.has(key), key) // the sportsbook starts off
    assert.equal(doc.options.bonus.wagering_lock, true)
    assert.equal(doc.options.spin_wheel.grant_on_registration, true)

    const second = await runSeed({ dataDir: dir, site, apply: true })

    assert.equal(second.write, false)
    assert.equal(read(dir).version, 1)
    assert.equal(auditLines(dir).length, 1)

    assert.equal((await runSeed({ dataDir: dir, site, reset: true, apply: true })).write, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("merge keeps the owner's choices; --reset turns everything on", () => {
  const stored = {
    site,
    version: 9,
    updatedAt: now,
    template: 'carbon_gold',
    features: { vault: false, swap: true },
    flags: { sports: false, bjb: false },
    variants: { vault: 'none', swap: 'swap_page', reward_currency: 'BTC' },
    options: { spin_wheel: { grant_on_registration: false } },
    coins: [{ code: 'QAC', kind: 'points', name: 'QA Coin', symbol: 'QAC', decimals: 2, usdRate: '0.01', networks: [], enabled: false }]
  }

  const merge = planSeed(stored, { site, now })

  assert.equal(merge.doc.features.vault, false)
  assert.equal(merge.doc.flags.sports, false)
  assert.equal(merge.doc.variants.swap, 'swap_page')
  assert.equal(merge.doc.variants.reward_currency, 'BTC')
  assert.equal(merge.doc.options.spin_wheel.grant_on_registration, false)
  assert.equal(merge.doc.features.tips, true)
  assert.equal(merge.doc.variants.tips, 'peer_to_peer')
  assert.equal(merge.doc.version, 10)
  assert.deepEqual(merge.doc.coins, stored.coins)
  assert.equal(merge.doc.flags.bjb, false)

  // Applying the merge result and planning again changes nothing.
  assert.equal(planSeed(merge.doc, { site }).write, false)

  const reset = planSeed(stored, { site, reset: true, now })

  assert.equal(reset.doc.features.vault, true)
  assert.equal(reset.doc.variants.vault, demoVariants().vault)
  assert.equal(reset.doc.flags.sports, true)
  assert.equal(reset.doc.variants.reward_currency, 'USDT')
  assert.equal(reset.doc.options.spin_wheel.grant_on_registration, true)
  assert.equal(reset.doc.flags.bjb, false, 'a key the catalogue dropped is left alone')
  assert.deepEqual(reset.doc.coins, stored.coins)
  assert.ok(reset.changes.some(c => c.kind === 'flag' && c.key === 'sports' && c.to === true))
})

test('refuses a document of another site', () => {
  assert.throws(() => planSeed({ site: 'other', version: 1 }, { site }), /belongs to "other"/)
})

test('dry run never writes', async () => {
  const dir = tempDir()

  try {
    writeFileSync(path.join(dir, 'entitlements.json'), JSON.stringify({ site, version: 3, features: { blog: false }, flags: {} }))
    cpSync(path.join(dir, 'entitlements.json'), path.join(dir, 'before.json'))

    const plan = await runSeed({ dataDir: dir, site, reset: true })

    assert.equal(plan.write, true)
    assert.equal(plan.applied, false)
    assert.equal(readFileSync(path.join(dir, 'entitlements.json'), 'utf8'), readFileSync(path.join(dir, 'before.json'), 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
