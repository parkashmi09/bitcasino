'use client'

import { useCallback, useMemo } from 'react'

import { parseAsString, useQueryStates } from 'nuqs'

import { bucketKeys, GRANULARITIES, type Granularity } from './format'

/**
 * The date range and granularity of a stats screen, kept in the URL
 * (`?preset=30d&granularity=week`, or `?preset=custom&from=…&to=…`)
 * so a view survives a reload and can be shared as a link. There is no currency filter: a screen
 * shows every currency, totals valued in the site's default coin (a `?currency=` is ignored).
 *
 * Days are UTC days, matching the buckets the backend groups by
 * (`date_trunc` with the session in UTC). `from`/`to` are inclusive 'yyyy-MM-dd';
 * `apiRange` is the same window as half-open ISO instants `[from, to)`.
 */

export type Preset = 'today' | '7d' | '30d' | '90d' | 'mtd' | 'all' | 'custom'

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'mtd', label: 'This month' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' }
]

/** Longest window a stats screen asks for. The backend refuses longer ones. */
export const MAX_RANGE_DAYS = 731

/** Longest window that may be bucketed by day; longer ones step up to weeks. */
export const MAX_DAY_SPAN = 366

const DAY = 86_400_000
const PRESET_VALUES = PRESETS.map(p => p.value)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const utcDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => utcDay(new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY))
const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1

/** ISO instants for an inclusive day range: `[from 00:00Z, day after to 00:00Z)`. */
export const toApiRange = (from: string, to: string) => ({ from: `${from}T00:00:00.000Z`, to: `${addDays(to, 1)}T00:00:00.000Z` })

function presetRange(preset: Preset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case 'mtd':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'all':
      // The longest window the backend answers (MAX_RANGE_DAYS) — older than the site itself.
      return { from: addDays(today, -(MAX_RANGE_DAYS - 1)), to: today }
    default:
      return { from: addDays(today, -29), to: today }
  }
}

export type StatsFilterPatch = Partial<{ preset: Preset; from: string; to: string; granularity: Granularity }> &
  Record<string, string | null | undefined>

export type StatsFilters = {
  preset: Preset

  /** Inclusive UTC days, 'yyyy-MM-dd'. */
  from: string
  to: string
  days: number
  granularity: Granularity

  /** Every bucket in the window — feed to `fillBuckets` and the chart's `buckets`. */
  buckets: string[]

  /** The window as half-open ISO instants. */
  apiRange: { from: string; to: string }

  /** The window of the same length immediately before this one, for deltas. */
  previous: { from: string; to: string; apiRange: { from: string; to: string } }

  /**
   * Ready to pass as a query to a stats route that takes `from`/`to` instants and `granularity`.
   * No `currency`: the route answers every currency, converted to the default coin.
   */
  query: { from: string; to: string; granularity: Granularity }

  /** Values of the caller's `extraKeys` ('' when unset). */
  extra: Record<string, string>
  set: (patch: StatsFilterPatch) => void

  /** True when anything differs from the screen's defaults (what Reset would clear). */
  dirty: boolean

  /** Back to the screen's defaults: every filter key, the caller's extra keys included, leaves the URL. */
  reset: () => void
}

type Options = {
  defaultPreset?: Exclude<Preset, 'custom'>
  defaultGranularity?: Granularity

  /** More URL params this screen filters on (e.g. ['sport']). */
  extraKeys?: string[]
}

export function useStatsFilters({ defaultPreset = '30d', defaultGranularity = 'day', extraKeys = [] }: Options = {}): StatsFilters {
  const extraSig = extraKeys.join('|')

  const parsers = useMemo(() => {
    const p: Record<string, ReturnType<typeof parseAsString.withDefault>> = {
      preset: parseAsString.withDefault(defaultPreset),
      from: parseAsString.withDefault(''),
      to: parseAsString.withDefault(''),
      granularity: parseAsString.withDefault(defaultGranularity)
    }

    for (const k of extraSig ? extraSig.split('|') : []) p[k] = parseAsString.withDefault('')

    return p
  }, [defaultPreset, defaultGranularity, extraSig])

  const [raw, setRaw] = useQueryStates(parsers, { history: 'replace' })

  const derived = useMemo(() => {
    const today = utcDay(new Date())
    let preset = (PRESET_VALUES.includes(raw.preset as Preset) ? raw.preset : defaultPreset) as Preset
    let from: string
    let to: string

    if (preset === 'custom' && DATE_RE.test(raw.from) && DATE_RE.test(raw.to)) {
      ;[from, to] = raw.from <= raw.to ? [raw.from, raw.to] : [raw.to, raw.from]
      if (to > today) to = today
      if (from > to) from = to
      if (spanDays(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1))
    } else {
      if (preset === 'custom') preset = defaultPreset
      ;({ from, to } = presetRange(preset, today))
    }

    const days = spanDays(from, to)
    let granularity = (GRANULARITIES.includes(raw.granularity as Granularity) ? raw.granularity : defaultGranularity) as Granularity

    if (granularity === 'day' && days > MAX_DAY_SPAN) granularity = 'week'

    const prevTo = addDays(from, -1)
    const prevFrom = addDays(prevTo, -(days - 1))
    const apiRange = toApiRange(from, to)
    const extra: Record<string, string> = {}

    for (const k of extraSig ? extraSig.split('|') : []) extra[k] = String(raw[k] ?? '')

    return {
      preset,
      from,
      to,
      days,
      granularity,
      buckets: bucketKeys(from, to, granularity),
      apiRange,
      previous: { from: prevFrom, to: prevTo, apiRange: toApiRange(prevFrom, prevTo) },
      query: { ...apiRange, granularity },
      extra
    }
  }, [raw, defaultPreset, defaultGranularity, extraSig])

  const set = useCallback(
    (patch: StatsFilterPatch) => {
      const next: Record<string, string | null> = {}

      for (const [k, v] of Object.entries(patch)) next[k] = v === undefined || v === '' ? null : v

      // A preset owns its dates; only a custom range keeps from/to in the URL.
      if (patch.preset && patch.preset !== 'custom') {
        next.from = null
        next.to = null
      }

      if ((patch.from || patch.to) && !patch.preset) next.preset = 'custom'
      void setRaw(next as never)
    },
    [setRaw]
  )

  const dirty =
    Boolean(raw.preset && raw.preset !== defaultPreset) ||
    Boolean(raw.from || raw.to) ||
    Boolean(raw.granularity && raw.granularity !== defaultGranularity) ||
    (extraSig ? extraSig.split('|').some(k => Boolean(raw[k])) : false)

  const reset = useCallback(() => {
    const next: Record<string, null> = { preset: null, from: null, to: null, granularity: null }

    for (const k of extraSig ? extraSig.split('|') : []) next[k] = null
    void setRaw(next as never)
  }, [setRaw, extraSig])

  return { ...derived, set, dirty, reset }
}
