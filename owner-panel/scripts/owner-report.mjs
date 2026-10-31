/**
 * Read-only browser report of the owner panel.
 *
 * Signs in through the real form with owner-panel/.env.local's OWNER_USERNAME /
 * OWNER_PASSWORD (never printed, no screenshot while the form holds them), then
 * opens every page and records what is on it, every failed request and every
 * console error. It changes nothing.
 *
 *   node scripts/owner-report.mjs [--headed]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL = path.resolve(HERE, '..')
const OUT = process.env.REPORT_OUT || '/tmp/owner-report'
const BASE = process.env.OWNER_URL || 'http://127.0.0.1:3085/owner'
const PAGES = ['/overview', '/entitlements', '/branding', '/coins', '/system-tracker']

const env = Object.fromEntries(
  readFileSync(path.join(PANEL, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const USER = process.env.OWNER_USER || env.OWNER_USERNAME
const PASS = process.env.OWNER_PASS || env.OWNER_PASSWORD

if (!USER || !PASS) {
  console.error('No OWNER_USERNAME / OWNER_PASSWORD in owner-panel/.env.local')
  process.exit(1)
}

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()

const problems = []
page.on('console', m => { if (m.type() === 'error') problems.push({ kind: 'console', where: page.url(), text: m.text().slice(0, 200) }) })
page.on('response', async r => {
  if (r.status() < 400) return
  let body = ''
  try { body = (await r.text()).slice(0, 200) } catch {}
  problems.push({ kind: 'http', status: r.status(), url: r.url(), body })
})

// ── sign in ───────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#user', USER)
await page.fill('#pw', PASS)
await page.click('button[type=submit]')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1500)

const landed = page.url()
console.log(`SIGN-IN  -> ${landed.replace(BASE, '')}  ${landed.includes('/login') ? '*** FAILED (still on login)' : 'OK'}`)

if (landed.includes('/login')) {
  const err = await page.locator('[role=alert], .text-destructive, [data-slot=field-error]').allTextContents().catch(() => [])
  console.log('  form says:', err.filter(Boolean).join(' | ') || '(nothing)')
}

// ── every page ────────────────────────────────────────────────────────────────
for (const p of PAGES) {
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1200)

  const title = await page.title()
  const onLogin = page.url().includes('/login')
  const h = await page.locator('h1, h2').allTextContents().catch(() => [])
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s*\n\s*/g, ' | ').trim()

  console.log(`\n===== ${p} =====`)
  console.log(`url     : ${page.url().replace(BASE, '') || '/'}${onLogin ? '   *** REDIRECTED TO LOGIN — not checked' : ''}`)
  console.log(`title   : ${title}`)
  console.log(`heads   : ${h.map(s => s.trim()).filter(Boolean).slice(0, 8).join(' / ')}`)
  console.log(`content : ${text.slice(0, 1400)}`)

  await page.screenshot({ path: `${OUT}${p.replace(/\//g, '_')}.png`, fullPage: true })
}

console.log(`\n===== PROBLEMS (${problems.length}) =====`)
const seen = new Set()
for (const x of problems) {
  const k = `${x.kind}${x.status ?? ''}${x.url ?? ''}${x.text ?? ''}`
  if (seen.has(k)) continue
  seen.add(k)
  console.log(x.kind === 'http' ? `HTTP ${x.status}  ${x.url}\n        ${x.body}` : `CONSOLE  ${x.text}`)
}
if (!problems.length) console.log('none')

console.log(`\nscreenshots: ${OUT}`)
await browser.close()
