/**
 * Daily withdrawal limit per currency — the document's `withdrawalDailyLimit` block, the fourth
 * switch of the Withdrawals tab (next to KYC, wagering and the deposit cap):
 *
 *   { enabled: boolean, limits: { INR: "50000", USDT: "500" } }
 *
 * A player may withdraw at most `limits[currency]` of that currency in any rolling 24 hours,
 * pending and paid counted, on every rail (bank, crypto, gateway payouts, P2P sells). A currency
 * with no entry has no daily limit; an older document (no block) reads as off.
 *
 * Mirrors backend/packages/common/src/withdrawalDailyLimit.js (scripts/withdrawalDailyLimit.test.mjs
 * asserts they agree). No '@/' imports: the tests load it as is.
 */

export type WithdrawalDailyLimit = { enabled: boolean; limits: Record<string, string> }

export const DEFAULT_WITHDRAWAL_DAILY_LIMIT: WithdrawalDailyLimit = { enabled: false, limits: {} }

export const MAX_DAILY_LIMIT = 1_000_000_000_000

const CODE_RE = /^[A-Z][A-Z0-9]{1,9}$/
const AMOUNT_RE = /^\d{1,13}(\.\d{1,8})?$/
const FIELDS = ['enabled', 'limits']

/** A positive amount, at most 8 decimals, at most MAX_DAILY_LIMIT (a string, or a number). */
export function isDailyLimit(v: unknown): boolean {
  if (typeof v !== 'string' && typeof v !== 'number') return false
  const s = String(v).trim()

  return AMOUNT_RE.test(s) && /[1-9]/.test(s) && Number(s) <= MAX_DAILY_LIMIT
}

/** "50000.00" → "50000", "0.50" → "0.5": the amount as a person would type it. */
const tidy = (v: unknown) => {
  const s = String(v).trim()
  const [whole, fraction = ''] = s.split('.')
  const frac = fraction.replace(/0+$/, '')

  return `${whole.replace(/^0+(?=\d)/, '')}${frac ? `.${frac}` : ''}`
}

/** Reading: known fields; a bad currency or amount is dropped (an older document = off). */
export function cleanWithdrawalDailyLimit(value: unknown): WithdrawalDailyLimit {
  const given = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const raw = given.limits && typeof given.limits === 'object' && !Array.isArray(given.limits) ? (given.limits as Record<string, unknown>) : {}
  const limits: Record<string, string> = {}

  for (const [code, amount] of Object.entries(raw)) {
    const cur = code.toUpperCase()

    if (CODE_RE.test(cur) && isDailyLimit(amount)) limits[cur] = tidy(amount)
  }

  return { enabled: typeof given.enabled === 'boolean' ? given.enabled : DEFAULT_WITHDRAWAL_DAILY_LIMIT.enabled, limits }
}

/** Saving (strict): the first problem with a submitted block, or null. */
export function withdrawalDailyLimitProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'withdrawalDailyLimit must be an object'
  const v = value as Record<string, unknown>
  const extra = Object.keys(v).find(k => !FIELDS.includes(k))

  if (extra) return `withdrawalDailyLimit.${extra} is not a field (${FIELDS.join(', ')})`
  if (typeof v.enabled !== 'boolean') return 'withdrawalDailyLimit.enabled must be true or false'
  if (!v.limits || typeof v.limits !== 'object' || Array.isArray(v.limits)) return 'withdrawalDailyLimit.limits must be an object of currency → amount'

  for (const [code, amount] of Object.entries(v.limits as Record<string, unknown>)) {
    if (!CODE_RE.test(code)) return `withdrawalDailyLimit.limits: ${code} is not a currency code (upper case, e.g. INR)`
    if (!isDailyLimit(amount)) return `withdrawalDailyLimit.limits.${code} must be an amount above 0 and at most ${MAX_DAILY_LIMIT}, with at most 8 decimals`
  }

  if (v.enabled && Object.keys(v.limits as object).length === 0) return 'withdrawalDailyLimit: add at least one currency, or switch it off'

  return null
}

/** "INR 50,000 · USDT 500 per 24 h" / "Off". */
export function withdrawalDailyLimitLabel(d: WithdrawalDailyLimit | null | undefined) {
  if (!d || !d.enabled) return 'Off'
  const rows = Object.entries(d.limits)

  if (!rows.length) return 'On, no currency'

  return `${rows.map(([c, a]) => `${c} ${Number(a).toLocaleString('en-US', { maximumFractionDigits: 8 })}`).join(' · ')} per 24 h`
}

/** The audit change for the block, compared cleaned (an older document = off), or null. */
export function diffWithdrawalDailyLimit(before: unknown, after: unknown) {
  const from = cleanWithdrawalDailyLimit(before)
  const to = cleanWithdrawalDailyLimit(after)
  const key = (d: WithdrawalDailyLimit) => JSON.stringify({ enabled: d.enabled, limits: Object.fromEntries(Object.entries(d.limits).sort()) })

  return key(from) === key(to) ? null : { kind: 'withdrawal_daily_limit' as const, key: 'withdrawalDailyLimit' as const, from, to }
}
