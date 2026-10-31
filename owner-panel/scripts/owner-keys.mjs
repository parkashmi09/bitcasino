#!/usr/bin/env node
/**
 * Make the owner panel's Ed25519 signing pair and put each half where it belongs:
 *
 *   owner-panel/.env.local   OWNER_SIGNING_KEY  (private, base64 PKCS8 DER)
 *   backend/.env             OWNER_VERIFY_KEY   (public,  base64 SPKI DER)
 *
 * The backend can then verify the owner's answers but never mint one. Values are
 * written, never printed. Re-run to rotate; restart the owner panel and admin-service.
 *
 *   node owner-panel/scripts/owner-keys.mjs [--force]
 */
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = { panel: path.join(panel, '.env.local'), backend: path.join(panel, '..', 'backend', '.env') }

for (const file of Object.values(files)) {
  if (!existsSync(file)) {
    console.error(`missing ${file} — create it first`)
    process.exit(1)
  }
}

const has = (file, key) => new RegExp(`^${key}=.+$`, 'm').test(readFileSync(file, 'utf8'))

if (!process.argv.includes('--force') && has(files.panel, 'OWNER_SIGNING_KEY') && has(files.backend, 'OWNER_VERIFY_KEY')) {
  console.log('Both keys are already set (pass --force to rotate).')
  process.exit(0)
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

function setKey(file, key, value) {
  let text = readFileSync(file, 'utf8')
  const line = `${key}=${value}`

  if (new RegExp(`^${key}=.*$`, 'm').test(text)) text = text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
  else text = `${text.replace(/\n*$/, '\n')}${line}\n`
  writeFileSync(file, text)
  chmodSync(file, 0o600)
}

setKey(files.panel, 'OWNER_SIGNING_KEY', priv)
setKey(files.backend, 'OWNER_VERIFY_KEY', pub)
console.log('OWNER_SIGNING_KEY → owner-panel/.env.local, OWNER_VERIFY_KEY → backend/.env (values not shown).')
console.log('Restart the owner panel and admin-service.')
