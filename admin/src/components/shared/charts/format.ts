import { formatMoney, formatNumber, localeFor } from '@/lib/format'

/**
 * How a chart prints its values.
 *   'number'  — counts (1,23,456)
 *   'money'   — amounts, through `formatMoney`; pass `currency` to suffix the code
 *   'percent' — the value is already a percentage (12.5 → "12.5%")
 */
export type ValueFormat = 'number' | 'money' | 'percent'

export type Granularity = 'day' | 'week' | 'month'

export const GRANULARITIES: Granularity[] = ['day', 'week', 'month']

/** Full value, for tooltips and tables. */
export function formatValue(value: number | string | null | undefined, format: ValueFormat = 'number', currency?: string | null) {
  if (value === null || value === undefined || value === '') return '—'
  if (format === 'money') return formatMoney(value, currency ?? undefined, { digits: 2 })
  if (format === 'percent') return `${Number(value).toFixed(1)}%`

  return formatNumber(value)
}

/** Short value, for axis ticks (12.3K; 4.5L only when the default coin is INR). */
export function formatAxisValue(value: number | null | undefined, format: ValueFormat = 'number') {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  if (format === 'percent') return `${Math.round(value)}%`

  // Below 1 the compact format rounds every tick of a small scale (0.02, 0.04…) to "0" or "0.1".
  if (value !== 0 && Math.abs(value) < 1) return new Intl.NumberFormat(localeFor(), { maximumSignificantDigits: 2 }).format(value)

  return new Intl.NumberFormat(localeFor(), { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

// ---------------------------------------------------------------------------
// Buckets. A bucket key is the bucket's first day as 'yyyy-MM-dd' in UTC — the
// same thing Postgres `to_char(date_trunc(<unit>, ts), 'YYYY-MM-DD')` gives with
// the session in UTC: weeks start on Monday (ISO), months on the 1st.
// ---------------------------------------------------------------------------

const DAY = 86_400_000

const utc = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00.000Z`)
const keyOf = (d: Date) => d.toISOString().slice(0, 10)

/** The bucket a 'yyyy-MM-dd' day falls in. */
export function bucketStart(day: string, granularity: Granularity): string {
  const d = utc(day)

  if (granularity === 'week') {
    const dow = (d.getUTCDay() + 6) % 7 // Monday = 0

    return keyOf(new Date(d.getTime() - dow * DAY))
  }

  if (granularity === 'month') return `${day.slice(0, 7)}-01`

  return day.slice(0, 10)
}

/** Every bucket key from the bucket holding `from` through the one holding `to` (both 'yyyy-MM-dd'). */
export function bucketKeys(from: string, to: string, granularity: Granularity): string[] {
  const keys: string[] = []

  if (!from || !to || from > to) return keys
  let cursor = utc(bucketStart(from, granularity))
  const end = utc(to)

  while (cursor <= end && keys.length < 2000) {
    keys.push(keyOf(cursor))
    if (granularity === 'day') cursor = new Date(cursor.getTime() + DAY)
    else if (granularity === 'week') cursor = new Date(cursor.getTime() + 7 * DAY)
    else cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }

  return keys
}

/**
 * Line rows up with the full list of buckets, so a quiet day is a zero on the chart rather than a
 * gap the line silently jumps over. `pick` reads the number from a row; missing buckets get `fill`.
 */
export function fillBuckets<T>(
  keys: string[],
  rows: readonly T[] | null | undefined,
  bucketOf: (row: T) => string,
  pick: (row: T) => number | string | null | undefined,
  fill: number | null = 0
): (number | null)[] {
  const map = new Map<string, number>()

  for (const row of rows ?? []) {
    const k = String(bucketOf(row)).slice(0, 10)
    const n = Number(pick(row))

    if (Number.isFinite(n)) map.set(k, (map.get(k) ?? 0) + n)
  }

  return keys.map(k => (map.has(k) ? (map.get(k) as number) : fill))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The label under a bucket: "05 Oct", "w/c 05 Oct", "Oct 2026". */
export function bucketLabel(key: string, granularity: Granularity = 'day'): string {
  const d = utc(key)

  if (Number.isNaN(d.getTime())) return key
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mon = MONTHS[d.getUTCMonth()]

  if (granularity === 'month') return `${mon} ${d.getUTCFullYear()}`
  if (granularity === 'week') return `w/c ${dd} ${mon}`

  return `${dd} ${mon}`
}

/** Change from `previous` to `current` in percent; `null` when there is no base to compare with. */
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null

  return ((current - previous) / Math.abs(previous)) * 100
}

/** Sum of a numeric (or decimal-string) list, ignoring blanks. Display only — not for money maths. */
export const sumOf = (values: readonly (number | string | null | undefined)[]) =>
  values.reduce<number>((t, v) => {
    const n = Number(v)

    return Number.isFinite(n) ? t + n : t
  }, 0)
