#!/usr/bin/env node
/**
 * Live end-to-end flow: an owner entitlement toggle reaches the site admin and the frontend
 * WITHOUT a reload.
 *
 *   npm run e2e:flow                         # headless, default keys
 *   npm run e2e:flow -- --headed             # watch it
 *   npm run e2e:flow -- --keys vault,blog    # only these feature keys
 *   npm run e2e:flow -- --reward-currency EUR  # also switch the reward currency and back
 *   npm run e2e:flow -- --timeout 30         # seconds to wait per phase (default 20)
 *
 * Opens three pages, each signed in through its real UI/API:
 *   owner panel  /entitlements          (Username/Password form)
 *   site admin   /site-config/features  (Staff tab, email + password)
 *   frontend     /casino                (player API login → ns.accessToken / ns.refreshToken)
 * Records what is visible, switches the keys OFF in the owner panel UI (Review and save), polls
 * the open admin and frontend pages plus the backend until each item is gone, then switches them
 * back ON and measures the reappearance. A finally block always re-enables what it disabled
 * (through the owner panel API if the UI fails).
 *
 * Credentials are read from owner-panel/.env.local, ../credentials.md ("## Test player") and the
 * hub's cfz/admins/CREDENTIALS.md; override with E2E_OWNER_USER, E2E_OWNER_PASS, E2E_STAFF_EMAIL,
 * E2E_STAFF_PASS, E2E_PLAYER_USER, E2E_PLAYER_PASS. They are never printed or written anywhere,
 * and no screenshot is taken while a login form is filled.
 *
 * URLs: E2E_OWNER_URL (http://127.0.0.1:3085), E2E_ADMIN_URL (http://localhost:3080),
 * E2E_FRONTEND_URL (http://localhost:5190), E2E_GATEWAY_URL (SITE_GATEWAY_URL or http://127.0.0.1:4700),
 * E2E_HUB_CREDENTIALS (path of the hub CREDENTIALS.md).
 *
 * Output: a table (feature × surface × hide s × reappear s × result), screenshots of every step
 * in owner-panel/e2e-results/<timestamp>/, exit code 1 on any FAIL.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL = path.resolve(HERE, '..')
const REPO = path.resolve(PANEL, '..')

// ── arguments ────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)

const argValue = name => {
  const i = argv.findIndex(a => a === name || a.startsWith(`${name}=`))

  if (i < 0) return undefined

  return argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1]
}

const HEADED = argv.includes('--headed')
const KEYS = (argValue('--keys') ?? 'gift_cards,spin_wheel,vault,swap,blog').split(',').map(s => s.trim()).filter(Boolean)
const TIMEOUT_MS = Number(argValue('--timeout') ?? 20) * 1000
const REWARD_CURRENCY = argValue('--reward-currency')?.toUpperCase() ?? null
const POLL_MS = 250

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: npm run e2e:flow -- [--headed] [--keys a,b] [--timeout seconds] [--reward-currency CODE]')
  process.exit(0)
}

// ── credentials (never printed) ─────────────────────────────────────────────────────────────
const readText = file => (existsSync(file) ? readFileSync(file, 'utf8') : '')

function parseEnv(text) {
  const out = {}

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)

    if (!m) continue
    let v = m[2]

    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }

  return out
}

const cells = line =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim().replace(/^`(.*)`$/, '$1'))

/** credentials.md: the "## Test player" section's `| Username | `x` |` and `| Password | `y` |` rows. */
function parsePlayer(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l.trim() === '## Test player')

  if (start < 0) return {}
  const out = {}

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    if (!line.trim().startsWith('|')) continue
    const [k, v] = cells(line)

    if (/^username$/i.test(k)) out.user = v
    if (/^password$/i.test(k)) out.pass = v
  }

  return out
}

/** Hub CREDENTIALS.md: the table whose header has "Staff login"; this site's row. */
function parseStaff(text, site) {
  const lines = text.split(/\r?\n/)
  let staffCol = -1

  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      staffCol = -1
      continue
    }

    const row = cells(line)
    const idx = row.findIndex(c => /^staff login$/i.test(c))

    if (idx >= 0) {
      staffCol = idx
      continue
    }

    if (staffCol >= 0 && row[0] === site) return { email: row[staffCol], pass: row[staffCol + 1] }
  }

  return {}
}

const ownerEnv = parseEnv(readText(path.join(PANEL, '.env.local')))
const player = parsePlayer(readText(path.join(REPO, 'credentials.md')))
const hubFile = process.env.E2E_HUB_CREDENTIALS || path.resolve(REPO, '..', '..', 'admins', 'CREDENTIALS.md')
const staff = parseStaff(readText(hubFile), ownerEnv.SITE_KEY || 'hash-game-exchange')

const CREDS = {
  ownerUser: process.env.E2E_OWNER_USER || ownerEnv.OWNER_USERNAME,
  ownerPass: process.env.E2E_OWNER_PASS || ownerEnv.OWNER_PASSWORD,
  staffEmail: process.env.E2E_STAFF_EMAIL || staff.email,
  staffPass: process.env.E2E_STAFF_PASS || staff.pass,
  playerUser: process.env.E2E_PLAYER_USER || player.user,
  playerPass: process.env.E2E_PLAYER_PASS || player.pass
}

const missing = Object.entries(CREDS)
  .filter(([, v]) => !v)
  .map(([k]) => k)

if (missing.length) {
  console.error(`Missing credentials: ${missing.join(', ')} (set the E2E_* env vars or fix the source files)`)
  process.exit(2)
}

const strip = u => u.replace(/\/$/, '')

const URLS = {
  owner: strip(process.env.E2E_OWNER_URL || `http://127.0.0.1:${ownerEnv.PORT || 3085}`),
  admin: strip(process.env.E2E_ADMIN_URL || 'http://localhost:3080'),
  front: strip(process.env.E2E_FRONTEND_URL || 'http://localhost:5190'),
  gateway: strip(process.env.E2E_GATEWAY_URL || ownerEnv.SITE_GATEWAY_URL || 'http://127.0.0.1:4700')
}

// ── labels the site admin shows on its Features screen (backend catalogue) ──────────────────
const adminLabel = (() => {
  try {
    const cat = createRequire(import.meta.url)(path.join(REPO, 'backend/packages/common/src/featureCatalogue.js'))

    return key => cat.featureByKey?.(key)?.label ?? key
  } catch {
    return key => key
  }
})()

// ── results and screenshots ─────────────────────────────────────────────────────────────────
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
const OUT = path.join(PANEL, 'e2e-results', STAMP)

mkdirSync(OUT, { recursive: true })
let shotNo = 0

async function shot(page, name) {
  shotNo += 1
  const file = path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`)

  await page.screenshot({ path: file, fullPage: false }).catch(() => {})
}

const log = msg => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── owner panel API (fallback and verification) ─────────────────────────────────────────────
async function ownerApi(request, method, body) {
  const res = await request.fetch(`${URLS.owner}/api/owner/entitlements`, {
    method,
    data: body,
    headers: { 'content-type': 'application/json' }
  })

  const json = await res.json().catch(() => ({}))

  if (!res.ok()) throw new Error(`owner API ${method} → HTTP ${res.status()} ${json?.error?.code ?? ''}`)

  return json.data
}

async function ownerApiLogin(request) {
  const res = await request.post(`${URLS.owner}/api/auth/login`, {
    data: { username: CREDS.ownerUser, password: CREDS.ownerPass }
  })

  if (!res.ok()) throw new Error(`owner API login → HTTP ${res.status()}`)
}

/** Set the given feature keys to `value` through the API; returns keys actually changed. */
async function ownerApiSet(request, keys, value) {
  const doc = await ownerApi(request, 'GET')
  const todo = keys.filter(k => (doc.features[k] !== false) !== value)

  if (!todo.length) return []
  const features = { ...doc.features }

  for (const k of todo) features[k] = value
  await ownerApi(request, 'PUT', { version: doc.version, features, flags: doc.flags })

  return todo
}

// ── sign-ins ────────────────────────────────────────────────────────────────────────────────
async function loginOwner(page) {
  await page.goto(`${URLS.owner}/login?next=/entitlements`)
  await page.locator('#user').fill(CREDS.ownerUser)
  await page.locator('#pw').fill(CREDS.ownerPass)
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 }), page.locator('button[type=submit]').click()]).catch(
    () => {
      throw new Error('owner panel sign-in failed (still on /login)')
    }
  )
  await page.goto(`${URLS.owner}/entitlements`)
  await page.getByRole('switch').first().waitFor({ timeout: 20000 })
}

async function loginAdmin(page) {
  await page.goto(`${URLS.admin}/login`)
  await page.getByRole('tab', { name: 'Staff' }).click().catch(() => {})
  await page.locator('#identifier').fill(CREDS.staffEmail)
  await page.locator('#password').fill(CREDS.staffPass)
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.locator('button[type=submit]').click()]).catch(
    () => {
      throw new Error('site admin sign-in failed (still on /login — 2FA or a password change may be required)')
    }
  )
  await page.goto(`${URLS.admin}/site-config/features`)
  await page.getByText('Not in your plan').or(page.locator('tbody tr').first()).first().waitFor({ timeout: 30000 })
}

async function loginPlayerApi() {
  const res = await fetch(`${URLS.gateway}/api/v1/user/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: CREDS.playerUser, password: CREDS.playerPass })
  })

  const json = await res.json().catch(() => ({}))
  const t = json?.data

  if (!res.ok || !t?.accessToken) throw new Error(`player API login → HTTP ${res.status} ${json?.error?.code ?? ''}`)

  return { accessToken: t.accessToken, refreshToken: t.refreshToken }
}

async function loginFrontend(page, tokens) {
  await page.goto(`${URLS.front}/casino`)
  await page.evaluate(t => {
    localStorage.setItem('ns.accessToken', t.accessToken)
    localStorage.setItem('ns.refreshToken', t.refreshToken)
  }, tokens)
  await page.reload() // setup only; nothing reloads once the flow starts
  // Signed in: the header's Deposit button (wallet) shows up.
  await page.getByRole('button', { name: /deposit/i }).first().waitFor({ timeout: 30000 })
}

async function openWallet(page) {
  await page.getByRole('button', { name: /deposit/i }).first().click()
  await page.getByRole('tab', { name: 'Deposit', exact: true }).first().waitFor({ timeout: 15000 })
}

// ── probes: each answers "is the feature showing/usable here?" (true/false, null = can't tell) ──
const linkVisible = (page, href) => page.locator(`a[href="${href}"]:visible`).count().then(n => n > 0)
const tabVisible = (page, name) => page.getByRole('tab', { name, exact: true }).count().then(n => n > 0)

async function adminRowBadge(page, label) {
  return page.evaluate(lbl => {
    for (const tr of document.querySelectorAll('tbody tr')) {
      const span = tr.querySelector('td span.font-medium')
      const text = span?.childNodes[0]?.textContent?.trim()

      if (text === lbl) return tr.textContent.includes('Not in your plan')
    }

    return null
  }, label)
}

async function publicHas(key) {
  const res = await fetch(`${URLS.gateway}/api/v1/admin/features/public`, { cache: 'no-store' })
  const json = await res.json()

  return Array.isArray(json?.data) && json.data.some(f => f.feature === key)
}

async function playerRouteOpen(token, route) {
  const res = await fetch(`${URLS.gateway}/api/v1${route}`, { headers: { authorization: `Bearer ${token}` } })
  const body = await res.text()

  return !(res.status === 403 && body.includes('NOT_ENTITLED'))
}

/** The site's reward currency as players read it: /features/public policy row and /site-config/public. */
async function publicRewardCurrency() {
  const [features, config] = await Promise.all(
    ['/admin/features/public', '/admin/site-config/public'].map(p => fetch(`${URLS.gateway}/api/v1${p}`, { cache: 'no-store' }).then(r => r.json()))
  )

  return {
    features: features?.data?.find?.(f => f.feature === 'reward_currency')?.variant ?? null,
    config: config?.data?.rewardCurrency ?? null
  }
}

/** Set variants.reward_currency through the owner API (same save + audit + nudge as the screen). */
async function ownerApiRewardCurrency(request, code) {
  const doc = await ownerApi(request, 'GET')

  if (doc.variants?.reward_currency === code) return false
  await ownerApi(request, 'PUT', { version: doc.version, features: doc.features, flags: doc.flags, variants: { reward_currency: code } })

  return true
}

/** Owner switches the reward currency to `code`; time until both public reads show it, then back. */
async function rewardCurrencyRound(request, code) {
  const doc = await ownerApi(request, 'GET')
  const original = doc.variants?.reward_currency ?? 'USDT'

  if (original === code) throw new Error(`--reward-currency ${code} is already the reward currency — pick another`)
  rewardRestore = original

  const surfaces = [
    { key: 'reward_currency', surface: 'GET /admin/features/public', read: r => r.features },
    { key: 'reward_currency', surface: 'GET /admin/site-config/public', read: r => r.config }
  ]

  const wait = async want => {
    const t0 = Date.now()
    const seen = new Map()

    while (Date.now() - t0 < TIMEOUT_MS && seen.size < surfaces.length) {
      const now = await publicRewardCurrency().catch(() => ({}))

      for (const s of surfaces) if (!seen.has(s) && s.read(now) === want) seen.set(s, (Date.now() - t0) / 1000)
      await sleep(POLL_MS)
    }

    return seen
  }

  log(`owner panel API: reward currency ${original} → ${code}`)
  await ownerApiRewardCurrency(request, code)
  const there = await wait(code)

  log(`owner panel API: reward currency ${code} → ${original}`)
  await ownerApiRewardCurrency(request, original)
  rewardRestore = null
  const back = await wait(original)

  for (const s of surfaces) results.set(s, { baseline: true, hide: there.get(s) ?? null, reappear: back.get(s) ?? null, note: `${original} → ${code} → ${original}` })
}

// Which probes apply to which key. Extend here when a new key gets UI.
const FRONT_LINKS = { gift_cards: '/gift-cards', vault: '/vault', blog: '/blog' }
const FRONT_TABS = { swap: 'Swap', vault: 'Vault Pro' }
const ADMIN_LINKS = { gift_cards: '/gift-cards', vault: '/vault', spin_wheel: '/spin-wheel', blog: '/content/blogs' }
const PLAYER_ROUTES = { gift_cards: '/user/gift-cards' }

function buildProbes({ admin, front, token }) {
  const probes = []

  for (const key of KEYS) {
    if (FRONT_LINKS[key]) probes.push({ key, surface: `frontend rail ${FRONT_LINKS[key]}`, on: () => linkVisible(front, FRONT_LINKS[key]) })
    if (FRONT_TABS[key]) probes.push({ key, surface: `frontend wallet tab "${FRONT_TABS[key]}"`, on: () => tabVisible(front, FRONT_TABS[key]) })
    if (ADMIN_LINKS[key]) probes.push({ key, surface: `admin sidebar ${ADMIN_LINKS[key]}`, on: () => linkVisible(admin, ADMIN_LINKS[key]) })
    probes.push({
      key,
      surface: `admin Features "${adminLabel(key)}"`,
      on: async () => {
        const badge = await adminRowBadge(admin, adminLabel(key))

        return badge === null ? null : !badge
      }
    })
    probes.push({ key, surface: 'api /admin/features/public', on: () => publicHas(key) })
    if (PLAYER_ROUTES[key]) probes.push({ key, surface: `api player ${PLAYER_ROUTES[key]}`, on: () => playerRouteOpen(token, PLAYER_ROUTES[key]) })
  }

  return probes
}

const safe = async fn => {
  try {
    return await fn()
  } catch {
    return null
  }
}

/** Poll every probe until it reads `want`; returns { probe → seconds | null } measured from t0. */
async function waitAll(probes, want, t0) {
  const times = new Map()

  while (Date.now() - t0 < TIMEOUT_MS && times.size < probes.length) {
    for (const p of probes) {
      if (times.has(p)) continue
      if ((await safe(p.on)) === want) times.set(p, (Date.now() - t0) / 1000)
    }

    if (times.size < probes.length) await sleep(POLL_MS)
  }

  return times
}

// ── owner panel UI toggle ───────────────────────────────────────────────────────────────────
function ownerSwitch(page, key) {
  // Feature rows come before the flag rows of the same key (e.g. bonus), so .first() is the feature.
  const row = page.locator(`[data-row="${key}"]`).first()

  return row.getByRole('switch')
}

/** Flip the keys to `value` in the owner panel UI, Review and save. Returns the save click time. */
async function ownerUiSet(page, keys, value, label) {
  for (const key of keys) {
    const sw = ownerSwitch(page, key)

    await sw.scrollIntoViewIfNeeded()
    if ((await sw.getAttribute('aria-checked')) !== String(value)) await sw.click()
    if ((await sw.getAttribute('aria-checked')) !== String(value)) throw new Error(`owner switch ${key} did not move to ${value}`)
  }

  await page.getByRole('button', { name: 'Review and save' }).click()
  const dialog = page.getByRole('dialog')

  await dialog.waitFor()
  await shot(page, `owner-${label}-review`)
  const saveBtn = dialog.getByRole('button', { name: /^Save \d+ change/ })
  const response = page.waitForResponse(r => r.url().endsWith('/api/owner/entitlements') && r.request().method() === 'PUT', { timeout: 15000 })
  const t0 = Date.now()

  await saveBtn.click()
  const res = await response

  if (!res.ok()) throw new Error(`owner save → HTTP ${res.status()}`)
  const json = await res.json().catch(() => ({}))

  log(`owner saved version ${json?.data?.doc?.version} (${json?.data?.live?.live ? 'backend nudged live' : 'backend will poll'})`)

  return t0
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
const results = new Map() // probe → { baseline, hide, reappear, note }
let browser
let ownerCtx
let disabled = [] // keys this run switched off — always restored
let rewardRestore = null // reward currency to put back, when this run changed it
let failed = false

try {
  log(`keys: ${KEYS.join(', ')} · timeout ${TIMEOUT_MS / 1000}s · ${HEADED ? 'headed' : 'headless'}`)
  log(`screenshots → ${path.relative(process.cwd(), OUT) || OUT}`)
  browser = await chromium.launch({ headless: !HEADED })
  const viewport = { width: 1440, height: 900 }

  ownerCtx = await browser.newContext({ viewport })
  const adminCtx = await browser.newContext({ viewport })
  const frontCtx = await browser.newContext({ viewport })
  const [owner, admin, front] = await Promise.all([ownerCtx.newPage(), adminCtx.newPage(), frontCtx.newPage()])

  log('signing in: owner panel, site admin, frontend player')
  const tokens = await loginPlayerApi()

  await Promise.all([loginOwner(owner), loginAdmin(admin), loginFrontend(front, tokens)])

  // Every key must start entitled; this run only restores what it turned off itself.
  const doc = await ownerApi(ownerCtx.request, 'GET')
  const alreadyOff = KEYS.filter(k => doc.features[k] === false)

  if (alreadyOff.length) throw new Error(`already not entitled before the run: ${alreadyOff.join(', ')} — switch them on first`)
  const unknown = KEYS.filter(k => !(k in doc.features))

  if (unknown.length) log(`warning: not in the owner document (read as entitled): ${unknown.join(', ')}`)

  if (KEYS.some(k => FRONT_TABS[k])) await openWallet(front)

  const probes = buildProbes({ admin, front, token: tokens.accessToken })

  // Baseline.
  for (const p of probes) {
    const v = await safe(p.on)

    results.set(p, { baseline: v, hide: null, reappear: null, note: '' })
  }

  await Promise.all([shot(owner, 'owner-before'), shot(admin, 'admin-before'), shot(front, 'frontend-before')])
  const live = probes.filter(p => results.get(p).baseline === true)

  for (const p of probes) if (results.get(p).baseline !== true) results.get(p).note = `not showing before the run (${results.get(p).baseline})`
  log(`baseline: ${live.length}/${probes.length} items showing`)

  // OFF.
  log(`owner panel: switching OFF ${KEYS.join(', ')}`)
  disabled = [...KEYS]
  const tOff = await ownerUiSet(owner, KEYS, false, 'off')
  const hidden = await waitAll(live, false, tOff)

  for (const p of live) results.get(p).hide = hidden.get(p) ?? null
  await Promise.all([shot(owner, 'owner-after-off'), shot(admin, 'admin-after-off'), shot(front, 'frontend-after-off')])
  log(`hidden: ${hidden.size}/${live.length}`)

  // ON.
  log(`owner panel: switching ON ${KEYS.join(', ')}`)
  const tOn = await ownerUiSet(owner, KEYS, true, 'on')

  disabled = []
  const back = await waitAll(live, true, tOn)

  for (const p of live) results.get(p).reappear = back.get(p) ?? null
  await Promise.all([shot(owner, 'owner-after-on'), shot(admin, 'admin-after-on'), shot(front, 'frontend-after-on')])
  log(`back: ${back.size}/${live.length}`)

  // Reward currency (optional): "hide s" = time until players read the new coin, "reappear s" = back.
  if (REWARD_CURRENCY) await rewardCurrencyRound(ownerCtx.request, REWARD_CURRENCY)
} catch (err) {
  failed = true
  console.error(`\nFLOW ERROR: ${err?.message ?? err}`)
} finally {
  // Always restore: re-enable every key this run switched off, through the API.
  try {
    let request = ownerCtx?.request

    if (!request) {
      const { request: req } = await import('playwright')

      request = await req.newContext()
      await ownerApiLogin(request)
    }

    const fixed = await ownerApiSet(request, disabled, true).catch(async () => {
      // Session gone: a fresh API sign-in.
      const { request: req } = await import('playwright')
      const ctx = await req.newContext()

      await ownerApiLogin(ctx)

      return ownerApiSet(ctx, disabled, true)
    })

    if (fixed.length) log(`restore: re-enabled ${fixed.join(', ')} through the owner panel API`)
    if (rewardRestore && (await ownerApiRewardCurrency(request, rewardRestore))) log(`restore: reward currency back to ${rewardRestore}`)
    const doc = await ownerApi(request, 'GET').catch(() => null)
    const stillOff = doc ? KEYS.filter(k => doc.features[k] === false) : []

    if (stillOff.length) {
      failed = true
      console.error(`RESTORE INCOMPLETE: still not entitled: ${stillOff.join(', ')}`)
    }
  } catch (err) {
    failed = true
    console.error(`RESTORE FAILED: ${err?.message ?? err} — re-enable ${disabled.join(', ') || '(nothing)'} in the owner panel by hand`)
  }

  await browser?.close().catch(() => {})
}

// ── report ──────────────────────────────────────────────────────────────────────────────────
const rows = [...results.entries()].map(([p, r]) => {
  const pass = r.baseline === true && r.hide != null && r.reappear != null
  const fmt = v => (v == null ? '—' : v.toFixed(1))

  if (!pass) failed = true

  return [p.key, p.surface, fmt(r.hide), fmt(r.reappear), pass ? 'PASS' : 'FAIL', r.note || (r.hide == null ? 'never hid' : r.reappear == null ? 'never came back' : '')]
})

if (rows.length) {
  const head = ['feature', 'surface', 'hide s', 'reappear s', 'result', 'note']
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)))
  const line = r => `| ${r.map((c, i) => String(c).padEnd(widths[i])).join(' | ')} |`

  console.log(`\n${line(head)}\n|${widths.map(w => '-'.repeat(w + 2)).join('|')}|`)
  for (const r of rows) console.log(line(r))
  const passed = rows.filter(r => r[4] === 'PASS').length

  console.log(`\n${passed}/${rows.length} PASS · timeout ${TIMEOUT_MS / 1000}s · screenshots: ${OUT}`)
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS')
process.exit(failed ? 1 : 0)
