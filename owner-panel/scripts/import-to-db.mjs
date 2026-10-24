#!/usr/bin/env node
/**
 * One-time move of an older owner panel's FILE data into the site database.
 *
 * Before, the document lived in `owner-panel/data/entitlements.json` (+ `audit.jsonl`,
 * `branding/<sha256>.<ext>`). Now it lives in the site backend's `owner_entitlements` table and
 * the panel reads and writes it through `<SITE_GATEWAY_URL>/api/v1/admin/owner`. This script
 * uploads the file copy there — ONLY when the table is still empty (version 0), so it can never
 * overwrite what an owner already saved.
 *
 *   node --env-file=.env.local scripts/import-to-db.mjs            dry run: what it would send
 *   node --env-file=.env.local scripts/import-to-db.mjs --apply    upload images, then the document
 *
 * Reads OWNER_SHARED_SECRET (x-owner-key + HMAC), OWNER_SIGNING_KEY (Ed25519, optional),
 * SITE_GATEWAY_URL (else NEXT_PUBLIC_API_BASE), OWNER_DATA_DIR (default owner-panel/data).
 * Signs exactly as the panel's save does; the backend verifies before storing. Only the newest
 * audit line travels (one audit row per stored version); the old audit.jsonl stays on disk.
 * Never run it at a live gateway unless that is the site you mean to fill.
 */
import { createHash, createHmac, createPrivateKey, sign as edSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.resolve(process.env.OWNER_DATA_DIR ?? path.join(panel, 'data'))
const gateway = (process.env.SITE_GATEWAY_URL || process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '')
const secret = process.env.OWNER_SHARED_SECRET ?? ''
const apply = process.argv.includes('--apply')
const SLOTS = ['logo', 'mark', 'ogImage']

function fail(message) {
  console.error(`import-to-db: ${message}`)
  process.exit(1)
}

if (!gateway || !secret) fail('SITE_GATEWAY_URL (or NEXT_PUBLIC_API_BASE) and OWNER_SHARED_SECRET must be set — run with --env-file=.env.local')

const { protocol, hostname } = new URL(gateway)

if (protocol !== 'https:' && !(protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname))) {
  fail('SITE_GATEWAY_URL must be https:// unless it is this host')
}

async function api(route, init = {}) {
  const res = await fetch(`${gateway}/api/v1/admin/owner${route}`, { ...init, headers: { 'x-owner-key': secret, accept: 'application/json', ...init.headers } })
  const body = await res.json().catch(() => null)

  if (!res.ok) fail(`${init.method ?? 'GET'} ${route} → ${res.status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`.trim())

  return body?.data
}

const raw = await readFile(path.join(dataDir, 'entitlements.json'), 'utf8').catch(() => null)

if (!raw) fail(`no ${path.join(dataDir, 'entitlements.json')} — nothing to import`)

const doc = JSON.parse(raw)
const lines = (await readFile(path.join(dataDir, 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(l => l.trim())
let last = null

try {
  last = lines.length ? JSON.parse(lines.at(-1)) : null
} catch {
  last = null
}

const audit = last?.version === doc.version ? last : { at: doc.updatedAt ?? new Date().toISOString(), user: 'import', version: doc.version, changes: [] }

const stored = await api('/entitlements')

if (stored.version !== 0) fail(`the site already holds version ${stored.version} — nothing imported (the table must be empty)`)

const images = SLOTS.map(slot => ({ slot, file: doc.branding?.[slot]?.file })).filter(i => i.file)

console.log(`gateway ${gateway}\ndocument v${doc.version} (site ${doc.site}), ${images.length} branding image(s), audit entry v${audit.version}`)

if (!apply) {
  console.log('dry run — add --apply to upload')
  process.exit(0)
}

for (const { slot, file } of images) {
  const bytes = await readFile(path.join(dataDir, 'branding', file)).catch(() => null)

  if (!bytes) fail(`branding/${file} (${slot}) is missing on disk`)
  if (createHash('sha256').update(bytes).digest('hex') !== file.split('.')[0]) fail(`branding/${file} does not hash to its name`)
  await api(`/branding/asset/${file}?slot=${slot}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes })
  console.log(`uploaded ${slot} ${file}`)
}

const data = { ...doc, issuedAt: new Date().toISOString() }
const signature = createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex')
const key = process.env.OWNER_SIGNING_KEY

const signatureEd25519 = key
  ? edSign(null, Buffer.from(JSON.stringify(data)), createPrivateKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'pkcs8' })).toString('base64')
  : undefined

const saved = await api('/entitlements', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ data, signature, ...(signatureEd25519 ? { signatureEd25519 } : {}), audit, updatedBy: process.env.OWNER_USERNAME || 'import' })
})

console.log(`imported: the site now runs version ${saved.version}`)
