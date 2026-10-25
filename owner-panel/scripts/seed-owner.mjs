#!/usr/bin/env node
/**
 * Put the OWNER side of this site into a complete, known demo state — idempotently.
 *
 * The owner's data lives only in this panel (contract §2): `data/entitlements.json` (the document
 * the backend pulls) and `data/audit.jsonl`. This script writes that document the same way the
 * "Features & plan" save does (src/lib/entitlements/store.ts): full catalogue maps, a policy is
 * always on, a non-policy feature on variant `none` is off, `version` + 1 on a real change, atomic
 * write (mode 600), one audit line. It never writes secrets: integration keys (e.g. the OneSignal
 * App API key) are sealed in the backend's site_features and are entered in the UI.
 *
 *   node scripts/seed-owner.mjs --site hash-game-exchange            dry run: print what would change
 *   node scripts/seed-owner.mjs --site hash-game-exchange --apply    write it
 *   node scripts/seed-owner.mjs --site hash-game-exchange --reset    (dry run) force the full demo state
 *   node scripts/seed-owner.mjs --site hash-game-exchange --reset --apply
 *
 * Options:
 *   --data-dir <dir>    the owner data dir (default $OWNER_DATA_DIR, else owner-panel/data).
 *                       Point it at a copy to try an apply safely.
 *   --template <key>    the demo template (default carbon_gold, or the document's own in merge mode)
 *   --hub <sites.json>  the hub registry to check the site record in (read only;
 *                       default ../../../admins/owner-admin/data/sites.json, $PARKER567_HUB_SITES)
 *   --json              print the plan as JSON
 *
 * Merge (default): fills every missing key ON with the demo variant / option default and switches
 * ON a feature whose variant is missing or `none` unless the owner explicitly switched it off.
 * Owner choices are kept: an explicit `false` feature or flag, a real variant, an option value.
 * --reset: everything in the catalogue ON, every variant / policy / option = the demo value.
 * Both: custom coins and keys the catalogue no longer lists (e.g. a retired coin flag) are kept.
 * A feature with no real variant yet (club_membership) cannot be on and stays off.
 *
 * Node 22.18+ (strips the catalogue's TypeScript types itself).
 */
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { DEFAULT_OFF_FLAGS, FEATURE_CATALOGUE, FEATURE_KEYS, FLAG_KEYS, isVariantOf, resolveOptions } from '../src/configs/entitlementCatalogue.ts'
import { DEFAULT_TEMPLATE, resolveTemplateKey, templateByKey, TEMPLATE_KEYS } from '../src/configs/templateCatalogue.ts'

const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The audit `user` of a seeded save. */
export const SEED_USER = 'seed-owner'

/** Demo values on top of the template's variants (the template leaves these off or unset). */
const DEMO_OVERRIDES = {
  push_notifications: 'onesignal',
  analytics: 'gtm',
  tips: 'peer_to_peer',
  raffles: 'ticket_raffle'
}

/** Demo policies: always on, the variant IS the policy. */
const DEMO_POLICIES = {
  business_model: 'hybrid',
  deposit_mode: 'both',
  withdrawal_mode: 'both',
  reward_currency: 'USDT',
  default_currency: 'USDT',
  withdrawal_requirements: 'kyc'
}

const realVariants = f => f.variants.filter(v => v.key !== 'none').map(v => v.key)

/** The demo variant of every catalogue feature for a template (`none` only when nothing else exists). */
export function demoVariants(templateKey = DEFAULT_TEMPLATE) {
  const template = templateByKey(templateKey)
  const out = {}

  for (const f of FEATURE_CATALOGUE) {
    const candidates = f.policy
      ? [DEMO_POLICIES[f.key], f.defaultVariant, f.variants[0]?.key]
      : [DEMO_OVERRIDES[f.key], template?.variants[f.key], ...realVariants(f)]

    out[f.key] = candidates.find(v => v && (f.policy || v !== 'none') && isVariantOf(f.key, v)) ?? 'none'
  }

  return out
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** The same read rule as the store: catalogue keys complete (missing = on), extra keys kept. */
function complete(map, keys) {
  const out = {}

  for (const key of keys) out[key] = map && key in map ? map[key] !== false : !DEFAULT_OFF_FLAGS.has(key)
  for (const [key, value] of Object.entries(map ?? {})) if (!(key in out)) out[key] = value !== false

  return out
}

/** Same change list as diffDocs() in src/lib/entitlements/types.ts (kinds template/variant/feature/flag/option). */
export function diffDocs(before, after) {
  const changes = []

  if (after.template && after.template !== before.template) changes.push({ kind: 'template', key: 'template', from: before.template ?? null, to: after.template })

  for (const [key, to] of Object.entries(after.variants ?? {})) {
    const from = before.variants?.[key] ?? null

    if (from !== to) changes.push({ kind: 'variant', key, from, to })
  }

  for (const kind of ['feature', 'flag']) {
    const a = (kind === 'feature' ? before.features : before.flags) ?? {}
    const b = (kind === 'feature' ? after.features : after.flags) ?? {}

    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = a[key] !== false
      const to = b[key] !== false

      if (from !== to) changes.push({ kind, key, from, to })
    }
  }

  const a = resolveOptions(before.options)
  const b = resolveOptions(after.options)

  for (const [feature, values] of Object.entries(b)) {
    for (const [option, to] of Object.entries(values)) {
      const from = a[feature]?.[option]

      if (from !== to) changes.push({ kind: 'option', key: `${feature}.${option}`, from: !!from, to })
    }
  }

  return changes
}

/**
 * Pure: the stored document (or null) → the seeded document, its change list, and notes on what
 * was kept. `now` is injectable for tests.
 */
export function planSeed(stored, { site, reset = false, template: templateArg, now = new Date().toISOString() } = {}) {
  if (!site) throw new Error('site is required')
  if (stored && !isObject(stored)) throw new Error('the stored document is not a JSON object')
  if (stored?.site && stored.site !== site) throw new Error(`the document belongs to "${stored.site}", not "${site}" — wrong --data-dir?`)

  if (templateArg !== undefined && !TEMPLATE_KEYS.includes(resolveTemplateKey(templateArg))) {
    throw new Error(`--template must be one of ${TEMPLATE_KEYS.join(', ')}`)
  }

  const storedTemplate = typeof stored?.template === 'string' && stored.template ? resolveTemplateKey(stored.template) : null
  const template = templateArg !== undefined ? resolveTemplateKey(templateArg) : reset ? DEFAULT_TEMPLATE : (storedTemplate ?? DEFAULT_TEMPLATE)
  const demo = demoVariants(template)

  const storedFeatures = isObject(stored?.features) ? stored.features : {}
  const storedFlags = isObject(stored?.flags) ? stored.flags : {}
  const storedVariants = isObject(stored?.variants) ? stored.variants : {}
  const storedOptions = isObject(stored?.options) ? stored.options : {}
  const kept = []

  const features = complete(storedFeatures, FEATURE_KEYS)
  const variants = {}

  // Stored variants the catalogue no longer knows are dropped, as the store's read does.
  for (const f of FEATURE_CATALOGUE) {
    const have = typeof storedVariants[f.key] === 'string' && isVariantOf(f.key, storedVariants[f.key]) ? storedVariants[f.key] : null

    if (f.policy) {
      variants[f.key] = !reset && have ? have : demo[f.key]
      features[f.key] = true
      continue
    }

    if (demo[f.key] === 'none') {
      // Nothing to switch on (e.g. club_membership has no real variant yet).
      variants[f.key] = 'none'
      features[f.key] = false
      kept.push(`${f.key}: no real variant exists yet — stays off`)
      continue
    }

    if (!reset && storedFeatures[f.key] === false) {
      variants[f.key] = have ?? 'none'
      features[f.key] = false
      kept.push(`${f.key}: switched off by the owner — kept off (--reset turns it on)`)
      continue
    }

    variants[f.key] = reset ? demo[f.key] : have && have !== 'none' ? have : demo[f.key]
    features[f.key] = true
  }

  const flags = complete(storedFlags, FLAG_KEYS)

  for (const key of FLAG_KEYS) {
    if (reset) flags[key] = !DEFAULT_OFF_FLAGS.has(key)
    else if (storedFlags[key] === false) kept.push(`flag ${key}: not entitled by the owner — kept (--reset entitles it)`)
  }

  for (const key of Object.keys(storedFlags)) if (!FLAG_KEYS.includes(key)) kept.push(`flag ${key}: not in the catalogue — left as ${flags[key]}`)
  for (const key of Object.keys(storedFeatures)) if (!FEATURE_KEYS.includes(key)) kept.push(`feature ${key}: not in the catalogue — left as ${features[key]}`)

  // Options: merge keeps the owner's explicit values (resolveOptions fills defaults); reset = defaults.
  const options = resolveOptions(reset ? {} : storedOptions)

  const next = { template, features, flags, variants, options }

  const before = stored
    ? { template: storedTemplate, features: complete(storedFeatures, FEATURE_KEYS), flags: complete(storedFlags, FLAG_KEYS), variants: storedVariants, options: storedOptions }
    : { template: null, features: {}, flags: {}, variants: {}, options: undefined }

  const changes = diffDocs(before, next)
  const create = !stored
  const version = Number(stored?.version) || 1
  const write = create || changes.length > 0

  const doc = write
    ? {
        site,
        version: create ? 1 : version + 1,
        updatedAt: now,
        ...next,
        ...(stored?.coins !== undefined ? { coins: stored.coins } : {})
      }
    : stored

  return { create, write, changes, kept, doc, fromVersion: create ? null : version }
}

async function writeAtomic(file, body) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`

  await writeFile(tmp, body, { mode: 0o600 })
  await rename(tmp, file)
}

/** Read → plan → (apply) against a data dir. Returns the plan. */
export async function runSeed({ dataDir, site, reset = false, apply = false, template, now }) {
  const docFile = path.join(dataDir, 'entitlements.json')
  const auditFile = path.join(dataDir, 'audit.jsonl')

  const raw = await readFile(docFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })

  const plan = planSeed(raw === null ? null : JSON.parse(raw), { site, reset, template, now })

  if (apply && plan.write) {
    await writeAtomic(docFile, JSON.stringify(plan.doc, null, 2) + '\n')

    const entry = { at: plan.doc.updatedAt, user: SEED_USER, version: plan.doc.version, changes: plan.changes, ...(plan.create ? { created: true } : {}), ...(reset ? { reset: true } : {}) }

    await appendFile(auditFile, JSON.stringify(entry) + '\n', { mode: 0o600 })
  }

  return { ...plan, docFile, applied: apply && plan.write }
}

/** The hub registry's record of the site (read only). */
function hubRecord(file, site) {
  if (!existsSync(file)) return { file, status: 'no hub registry found' }

  try {
    const sites = JSON.parse(readFileSync(file, 'utf8')).sites ?? []
    const rec = sites.find(s => s.key === site)

    if (!rec) return { file, status: 'MISSING — add the site in the hub owner-admin (it owns paths and ports), then node agents/setup-site.mjs ' + site }

    return { file, status: 'present', template: rec.template ?? null }
  } catch (error) {
    return { file, status: `unreadable (${error.message})` }
  }
}

const fmt = v => (v === null || v === undefined ? '∅' : String(v))

function arg(name) {
  const i = process.argv.indexOf(name)

  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/seed-owner.mjs --site <key> [--apply] [--reset] [--data-dir <dir>] [--template <key>] [--hub <sites.json>] [--json]')

    return
  }

  const site = arg('--site')

  if (!site) {
    console.error('--site <key> is required (e.g. --site hash-game-exchange)')
    process.exit(2)
  }

  const apply = argv.includes('--apply')
  const reset = argv.includes('--reset')
  const dataDir = path.resolve(arg('--data-dir') ?? process.env.OWNER_DATA_DIR ?? path.join(panel, 'data'))
  const hubFile = path.resolve(arg('--hub') ?? process.env.PARKER567_HUB_SITES ?? path.join(panel, '..', '..', '..', 'admins', 'owner-admin', 'data', 'sites.json'))

  const plan = await runSeed({ dataDir, site, reset, apply, template: arg('--template') })
  const hub = hubRecord(hubFile, site)

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...plan, hub }, null, 2))

    return
  }

  console.log(`site        ${site}`)
  console.log(`document    ${plan.docFile}`)
  console.log(`mode        ${reset ? 'reset (full demo state)' : 'merge (keeps owner choices)'}${apply ? ', APPLY' : ', dry run'}`)
  console.log(`hub record  ${hub.status}${hub.template ? ` (template ${hub.template} → ${resolveTemplateKey(hub.template)})` : ''}  [${hub.file}]`)
  console.log(`version     ${plan.create ? 'new document → 1' : plan.write ? `${plan.fromVersion} → ${plan.doc.version}` : `${plan.fromVersion} (unchanged)`}`)
  console.log('')

  if (!plan.write) console.log('No change: the owner side is already in the seeded state.')
  else {
    console.log(`${plan.changes.length} change(s)${plan.create ? ' (the document is created)' : ''}:`)
    for (const c of plan.changes) console.log(`  ${c.kind.padEnd(8)} ${c.key.padEnd(34)} ${fmt(c.from)} → ${fmt(c.to)}`)
  }

  if (plan.kept.length) {
    console.log('\nKept as they are:')
    for (const k of plan.kept) console.log(`  - ${k}`)
  }

  console.log('\nNot touched: custom coins, secrets. Set by hand in the UI: push_notifications/onesignal App ID + App API key, analytics/gtm container ID (site admin → Site Config → Features).')

  if (plan.write && !apply) console.log('\nDry run — nothing written. Re-run with --apply to write.')
  if (plan.applied) console.log(`\nWritten (version ${plan.doc.version}) + audit line. The backend picks it up on its next poll (OWNER_POLL_SECONDS, default 15 s).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`seed-owner: ${error.message}`)
    process.exit(1)
  })
}
