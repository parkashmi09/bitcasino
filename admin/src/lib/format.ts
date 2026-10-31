/** Display helpers. Amounts on the platform are exact decimal STRINGS; never do arithmetic on them here. */

/**
 * The agent system runs on INR and prints it as a bare number — no "INR", no ₹ (user, 2026-10-17).
 * Set by SessionProvider for every session that is not the Super Admin's (`actor.direct` false).
 */
let plainInr = false

export const setPlainInr = (value: boolean) => {
  plainInr = value
}

export const isPlainInr = () => plainInr

/**
 * The coin an amount with no code of its own is in: the owner's default (set by useDefaultCurrency),
 * INR in the agent system. Only INR is grouped the Indian way (1,00,000); every other coin reads
 * 100,000 — a USDT total in lakhs ("1,18,20,001.60 USDT") read as a different number.
 */
let defaultCode = 'USDT'

export const setDefaultCode = (code: string) => {
  defaultCode = code.toUpperCase()
}

/** The Intl locale for grouping an amount in `currency` (or the default coin). */
export const localeFor = (currency?: string | null) => ((currency || (plainInr ? 'INR' : defaultCode)).toUpperCase() === 'INR' ? 'en-IN' : 'en-US')

/** The code to print after an amount: none for INR in the agent system. */
const label = (currency?: string) => (currency && !(plainInr && currency.toUpperCase() === 'INR') ? currency : undefined)

/** `₹` for INR, or nothing in the agent system. */
export const inrSign = () => (plainInr ? '' : '₹')

/** `opts.of`: the coin the amount is in when `currency` is not printed — it picks the grouping. */
export function formatMoney(value: string | number | null | undefined, currency?: string, opts: { compact?: boolean; digits?: number; of?: string | null } = {}) {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(n)) return String(value)
  const digits = opts.digits ?? (Math.abs(n) >= 1000 ? 2 : n === Math.trunc(n) ? 0 : 2)

  // A sub-unit amount keeps its precision (a 0.0035 USDT commission is not "0.00"); trailing zeros drop.
  const small = opts.digits === undefined && n !== 0 && Math.abs(n) < 1

  const s = new Intl.NumberFormat(localeFor(currency ?? opts.of), {
    minimumFractionDigits: digits,
    maximumFractionDigits: small ? 8 : Math.max(digits, 2),
    notation: opts.compact ? 'compact' : 'standard'
  }).format(n)

  return label(currency) ? `${s} ${currency}` : s
}

/**
 * An exact decimal amount for display without padding: grouping on the whole part, trailing zeros
 * dropped from the fraction (kept up to 8 places, so crypto keeps its precision). Works on the
 * STRING, so nothing is rounded: "1000.00000000" → "1,000", "0.00012300" → "0.000123".
 */
export function formatAmount(value: string | number | null | undefined, currency?: string) {
  if (value === null || value === undefined || value === '') return '—'
  const str = String(value).trim()
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str)

  if (!m) return label(currency) ? `${str} ${currency}` : str
  const [, sign, whole, frac = ''] = m
  const grouped = new Intl.NumberFormat(localeFor(currency)).format(BigInt(whole))
  const trimmed = frac.slice(0, 8).replace(/0+$/, '')
  const out = `${sign}${grouped}${trimmed ? `.${trimmed}` : ''}`

  return label(currency) ? `${out} ${currency}` : out
}

export function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)

  return Number.isFinite(n) ? new Intl.NumberFormat(localeFor()).format(n) : String(value)
}

export function formatDate(value: string | number | Date | null | undefined, withTime = true) {
  if (!value) return '—'
  const d = new Date(value)

  if (Number.isNaN(d.getTime())) return String(value)

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(d)
}

export function relativeTime(value: string | number | Date | null | undefined) {
  if (!value) return '—'
  const diff = Date.now() - new Date(value).getTime()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536e6],
    ['month', 2592e6],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4]
  ]

  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(-diff / ms), unit)

  return 'just now'
}

export function titleCase(s: string) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function truncateId(s: string | number | null | undefined, n = 8) {
  if (s === null || s === undefined) return '—'
  const str = String(s)

  return str.length > n * 2 ? `${str.slice(0, n)}…${str.slice(-4)}` : str
}
