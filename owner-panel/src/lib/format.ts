/** Display helpers. Amounts on the platform are exact decimal STRINGS; never do arithmetic on them here. */

export function formatMoney(value: string | number | null | undefined, currency?: string, opts: { compact?: boolean; digits?: number } = {}) {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(n)) return String(value)
  const digits = opts.digits ?? (Math.abs(n) >= 1000 ? 2 : n === Math.trunc(n) ? 0 : 2)

  const s = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 2),
    notation: opts.compact ? 'compact' : 'standard'
  }).format(n)

  return currency ? `${s} ${currency}` : s
}

export function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)

  return Number.isFinite(n) ? new Intl.NumberFormat('en-IN').format(n) : String(value)
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
