'use client'

import { useMemo, type ReactNode } from 'react'

import {
  BarChart,
  bucketLabel,
  categoryTable,
  ChartCard,
  DonutChart,
  fillBuckets,
  KpiCard,
  percentChange,
  seriesTable,
  TimeSeriesChart,
  type ChartSeries,
  type StatsFilters
} from '@/components/shared/charts'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import ErrorState from '@/components/shared/ErrorState'
import { useApi } from '@/hooks/use-api'
import type { Query } from '@/lib/api/types'
import { formatMoney, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * A stats block driven by the shared FilterBar: KPI cards, time-series charts and breakdowns, laid
 * out from a config so the player and reward screens read alike. It renders what a stats route
 * answers — `{ range, kpis, series[], breakdown{}, unconverted[] }` (the `admin/reports/*-stats`
 * routes) — and never invents a figure: a key the route did not send shows "—".
 *
 * Money: decimal strings, in `range.currency` (the filter's currency, or USD when "all" is chosen —
 * then every row is valued at today's rate). Keys ending in `Usd` are USD by design.
 */

type Scalar = string | number | boolean | null | undefined

export type StatsResponse = {
  range?: { from: string; to: string; granularity: string; currency: string }
  kpis?: Record<string, unknown>
  series?: ({ bucket: string } & Record<string, Scalar>)[]
  breakdown?: Record<string, Record<string, Scalar>[] | undefined>
  unconverted?: string[]
}

/** money = in the report currency; usd = always USD; number; percent (already ×100). */
export type StatFormat = 'money' | 'usd' | 'number' | 'percent'

export type KpiSpec = {
  key: string
  label: string
  format: StatFormat
  icon?: ReactNode

  /** A series key to draw under the number. */
  spark?: string
  sparkColor?: ChartSeries['color']
  goodWhen?: 'up' | 'down' | 'neutral'

  /** Compare with the previous window of the same length (default: on for money/number). */
  delta?: boolean
  hint?: (kpis: Record<string, unknown>, unit: string) => ReactNode
}

export type SeriesChartSpec = {
  title: string
  description?: string
  format: StatFormat
  kind?: 'area' | 'line' | 'bar'
  stacked?: boolean
  wide?: boolean
  series: { key: string; name: string; color?: ChartSeries['color']; kind?: ChartSeries['kind'] }[]
  emptyMessage?: string
}

export type BreakdownSpec = {
  title: string
  description?: string
  path: string
  kind: 'donut' | 'bar'
  format: StatFormat
  labelKey?: string

  /** One value per row for a donut or single bar; several for a grouped bar. */
  values?: { key: string; name: string; color?: ChartSeries['color'] }[]
  horizontal?: boolean
  emptyMessage?: string
}

export type StatsPanelConfig = {
  kpis: KpiSpec[]
  charts: SeriesChartSpec[]
  breakdowns?: BreakdownSpec[]
}

const DONUT_SLICES = 6

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)

  return Number.isFinite(n) ? n : 0
}

const has = (v: unknown) => v !== null && v !== undefined && v !== ''

export function formatStat(value: unknown, format: StatFormat) {
  if (!has(value)) return '—'
  if (format === 'percent') return `${num(value).toFixed(1)}%`
  if (format === 'number') return formatNumber(num(value))

  return formatMoney(String(value), undefined, { digits: 2 })
}

type Props = {
  path: string
  filters: StatsFilters

  /** Extra query keys the route accepts (`channel`). */
  extraQuery?: Query
  config: StatsPanelConfig

  /** Ask the previous window too, for the KPI deltas. */
  compare?: boolean
  className?: string

  /** Rendered between the KPI row and the charts. */
  children?: ReactNode
}

const StatsPanel = ({ path, filters: f, extraQuery, config, compare = true, className, children }: Props) => {
  const reportCoin = useDefaultCurrency().code
  const current = useApi<StatsResponse>(path, { ...f.query, ...extraQuery }, { placeholderData: prev => prev, retry: false })

  // Deltas only need the totals, so one bucket per month is plenty.
  const previous = useApi<StatsResponse>(
    compare ? path : null,
    { ...f.previous.apiRange, granularity: 'month', ...extraQuery },
    { retry: false }
  )

  const s = current.data
  const unit = s?.range?.currency ?? reportCoin
  const unitOf = (format: StatFormat) => (format === 'money' ? unit : format === 'usd' ? 'USD' : undefined)
  const loading = current.isLoading
  const labels = useMemo(() => f.buckets.map(b => bucketLabel(b, f.granularity)), [f.buckets, f.granularity])

  // Every series key the config draws, lined up with the full list of buckets (gaps → 0).
  const lines = useMemo(() => {
    const rows = s?.series ?? []
    const keys = new Set([...config.kpis.flatMap(k => (k.spark ? [k.spark] : [])), ...config.charts.flatMap(c => c.series.map(x => x.key))])
    const out: Record<string, (number | null)[]> = {}

    for (const key of keys) out[key] = fillBuckets(f.buckets, rows, r => r.bucket, r => (has(r[key]) ? num(r[key]) : 0))

    return out
  }, [s, f.buckets, config])

  const line = (key: string) => lines[key] ?? []

  if (current.error && !s) return <ErrorState error={current.error} title='Could not load these statistics' />

  const kpis = s?.kpis ?? {}
  const prev = previous.data?.kpis ?? {}

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {(s?.unconverted?.length ?? 0) > 0 && (
        <p className='text-warning text-xs'>
          No exchange rate for {s?.unconverted?.join(', ')} — those rows are left out of the {unit} figures. Pick the currency to see them.
        </p>
      )}

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {config.kpis.map(k => {
          const value = kpis[k.key]
          const wantsDelta = k.delta ?? (k.format !== 'percent')

          return (
            <KpiCard
              key={k.key}
              label={k.label}
              value={formatStat(value, k.format)}
              unit={has(value) ? unitOf(k.format) : undefined}
              icon={k.icon}
              loading={loading}
              hint={k.hint?.(kpis, unit)}
              delta={wantsDelta && compare && has(value) && has(prev[k.key]) ? percentChange(num(value), num(prev[k.key])) : null}
              goodWhen={k.goodWhen}
              spark={k.spark ? line(k.spark) : undefined}
              sparkColor={k.sparkColor}
              sparkLabels={k.spark ? labels : undefined}
              sparkFormat={k.format === 'number' ? 'number' : k.format === 'percent' ? 'percent' : 'money'}
              sparkCurrency={unitOf(k.format)}
            />
          )
        })}
      </div>

      {children}

      <div className='grid gap-4 xl:grid-cols-2'>
        {config.charts.map(c => {
          const series: ChartSeries[] = c.series.map(x => ({ name: x.name, data: line(x.key), color: x.color, kind: x.kind }))
          const chartFormat = c.format === 'number' ? 'number' : c.format === 'percent' ? 'percent' : 'money'
          const cur = unitOf(c.format)

          return (
            <ChartCard
              key={c.title}
              className={c.wide ? 'xl:col-span-2' : undefined}
              title={c.title}
              description={c.description ?? `Per ${f.granularity}${cur ? `, in ${cur}` : ''}.`}
              table={seriesTable({ buckets: f.buckets, granularity: f.granularity, series, format: chartFormat, currency: cur })}
            >
              <TimeSeriesChart
                ariaLabel={`${c.title} per ${f.granularity}${cur ? `, ${cur}` : ''}`}
                buckets={f.buckets}
                granularity={f.granularity}
                series={series}
                kind={c.kind ?? 'area'}
                stacked={c.stacked}
                format={chartFormat}
                currency={cur}
                loading={loading}
                error={current.error}
                emptyMessage={c.emptyMessage ?? 'Nothing in this period.'}
              />
            </ChartCard>
          )
        })}

        {(config.breakdowns ?? []).map(b => (
          <Breakdown key={b.title} spec={b} rows={s?.breakdown?.[b.path] ?? []} unit={unitOf(b.format)} loading={loading} error={current.error} />
        ))}
      </div>
    </div>
  )
}

const Breakdown = ({
  spec,
  rows,
  unit,
  loading,
  error
}: {
  spec: BreakdownSpec
  rows: Record<string, Scalar>[]
  unit?: string
  loading: boolean
  error: unknown
}) => {
  const labelKey = spec.labelKey ?? 'label'
  const values = spec.values ?? [{ key: 'value', name: spec.title }]
  const format = spec.format === 'number' ? 'number' : spec.format === 'percent' ? 'percent' : 'money'
  const label = (r: Record<string, Scalar>) => String(r[labelKey] ?? r.key ?? '—')

  if (spec.kind === 'donut') {
    const sorted = [...rows].sort((a, b) => num(b[values[0].key]) - num(a[values[0].key]))
    const head = sorted.slice(0, DONUT_SLICES)
    const rest = sorted.slice(DONUT_SLICES).reduce((t, r) => t + num(r[values[0].key]), 0)
    const labels = [...head.map(label), ...(rest > 0 ? ['Other'] : [])]
    const data = [...head.map(r => num(r[values[0].key])), ...(rest > 0 ? [rest] : [])]

    return (
      <ChartCard
        title={spec.title}
        description={spec.description}
        table={categoryTable({ categories: labels, series: [{ name: values[0].name, data }], format, currency: unit })}
      >
        <DonutChart
          ariaLabel={spec.title}
          labels={labels}
          values={data}
          format={format}
          currency={unit}
          loading={loading}
          error={error}
          emptyMessage={spec.emptyMessage ?? 'Nothing in this period.'}
        />
      </ChartCard>
    )
  }

  const categories = rows.map(label)
  const series: ChartSeries[] = values.map(v => ({ name: v.name, data: rows.map(r => num(r[v.key])), color: v.color }))

  return (
    <ChartCard title={spec.title} description={spec.description} table={categoryTable({ categories, series, format, currency: unit })}>
      <BarChart
        ariaLabel={spec.title}
        categories={categories}
        series={series}
        horizontal={spec.horizontal}
        format={format}
        currency={unit}
        loading={loading}
        error={error}
        emptyMessage={spec.emptyMessage ?? 'Nothing in this period.'}
      />
    </ChartCard>
  )
}

export default StatsPanel
