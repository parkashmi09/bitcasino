#!/usr/bin/env node
/**
 * Seed this site's default PLAN on the owner side: exactly what the bcgame template
 * (catalogue key `emerald_dark`) uses is switched on, nothing more.
 *
 *   node scripts/seed-plan.mjs              dry run: print what would change
 *   node scripts/seed-plan.mjs --apply      write data/entitlements.json (+ one audit line)
 *
 * The rules (on top of scripts/seed-owner.mjs's reset plan, which turns EVERYTHING on):
 *   - a feature the template gives a real variant → ON with that variant;
 *   - a feature the template sets to `none` (spin_wheel, gift_cards, club_membership,
 *     push_notifications) or does not name (tips, analytics) → OFF, variant `none`;
 *   - policies: hybrid / both / both / reward currency USDT (always on);
 *   - every flag entitled (casino, sports, providers, coins, home sections);
 *   - feature options at their defaults.
 * Same write path as a "Features & plan" save: version + 1, atomic, mode 600, audit line by
 * `seed-plan`. Re-running is a no-op. The owner can change any of it later in the panel.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FEATURE_CATALOGUE } from '../src/configs/entitlementCatalogue.ts'
import { templateByKey } from '../src/configs/templateCatalogue.ts'
import { diffDocs, planSeed } from './seed-owner.mjs'

const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = process.env.SITE_KEY || 'hash-game-exchange'
const TEMPLATE = 'emerald_dark' // = bcgame
const USER = 'seed-plan'

const apply = process.argv.includes('--apply')
const dataDir = path.resolve(process.env.OWNER_DATA_DIR ?? path.join(panel, 'data'))
const docFile = path.join(dataDir, 'entitlements.json')
const auditFile = path.join(dataDir, 'audit.jsonl')

const raw = await readFile(docFile, 'utf8').catch(e => (e.code === 'ENOENT' ? null : Promise.reject(e)))
const stored = raw === null ? null : JSON.parse(raw)

// Start from the full reset plan for the template, then switch off what the template does not use.
const { doc: base } = planSeed(stored, { site: SITE, reset: true, template: TEMPLATE })
const template = templateByKey(TEMPLATE)
const next = { template: TEMPLATE, features: { ...base.features }, flags: { ...base.flags }, variants: { ...base.variants }, options: base.options }

for (const f of FEATURE_CATALOGUE) {
  if (f.policy) continue
  const v = template.variants[f.key]

  if (v && v !== 'none') {
    next.features[f.key] = true
    next.variants[f.key] = v
  } else {
    next.features[f.key] = false
    next.variants[f.key] = 'none'
  }
}

const before = stored ?? { template: null, features: {}, flags: {}, variants: {}, options: undefined }
const changes = diffDocs(before, next)
const create = !stored
const write = create || changes.length > 0

console.log(`site ${SITE}, template ${TEMPLATE} (bcgame), document ${docFile}`)
console.log(`ON : ${FEATURE_CATALOGUE.filter(f => next.features[f.key]).map(f => `${f.key}=${next.variants[f.key]}`).join(', ')}`)
console.log(`OFF: ${FEATURE_CATALOGUE.filter(f => !next.features[f.key]).map(f => f.key).join(', ')}`)
console.log(`flags: ${Object.values(next.flags).filter(Boolean).length}/${Object.keys(next.flags).length} entitled`)

if (!write) {
  console.log('No change: the plan is already seeded.')
  process.exit(0)
}

const version = create ? 1 : (Number(stored.version) || 1) + 1
const doc = { site: SITE, version, updatedAt: new Date().toISOString(), ...next, ...(stored?.coins !== undefined ? { coins: stored.coins } : {}) }

console.log(`${changes.length} change(s), version ${create ? 'new → 1' : `${stored.version} → ${version}`}`)

if (!apply) {
  console.log('Dry run — re-run with --apply to write.')
  process.exit(0)
}

await mkdir(dataDir, { recursive: true })
const tmp = `${docFile}.${process.pid}.tmp`

await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
await rename(tmp, docFile)
await appendFile(auditFile, JSON.stringify({ at: doc.updatedAt, user: USER, version, changes, ...(create ? { created: true } : {}) }) + '\n', { mode: 0o600 })
console.log(`Written (version ${version}) + audit line. The backend picks it up on its next poll.`)
