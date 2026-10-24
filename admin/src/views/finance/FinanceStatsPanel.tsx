'use client'

import { useMemo } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BarChart,
  ChartCard,
  DonutChart,
  KpiCard,
  TimeSeriesChart,
  categoryTable,
  fillBuckets,
  percentChange,
  seriesTable,
  type ChartColor,
  type StatsFilters
} from '@/components/shared/charts'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import Money from '@/components/shared/Money'
import { useApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'

/**
 * Charts and headline figures for one finance screen, from `GET admin/reports/finance-stats`
 * (reports:read, scoped to the caller's agent tree). Driven entirely by the screen's `useStatsFilters`.
 */

const STATS = 'admin/reports/finance-stats'

/**
 * The finance-stats query of a screen: every currency, valued in the site's default coin (USDT
 * unless the owner set another).
 */
export function useStatsQuery(kind: string, rail: string, filters: StatsFilters) {
  const site = useDefaultCurrency()

  return { kind, rail, ...filters.query, convertTo: site.code || 'USDT' }
}

type StatusKey = 'success' | 'pending' | 'failed' | 'other'
type Figure = { count: number; amount: string }

export type FinanceStats = {
  currency: string
  converted: boolean
  totals: {
    count: number
    amount: string
    uniqueUsers: number
    successCount: number
    successAmount: string
    averageSuccess: string
    successRate: number | null
    byStatus: Record<StatusKey, Figure>
  }
  series: { bucket: string; count: number; amount: string; byStatus: Record<StatusKey, Figure> }[]
  breakdown: { dimension: string; rows: { key: string; count: number; amount: string; successCount: number; successAmount: string }[] }
  byCurrency: { currency: string; count: number; amount: string; successAmount: string }[]
  unconverted: { currency: string | null; amount: string; count: number }[]
}

type Props = {
  kind: 'deposits' | 'withdrawals'
  rail: 'fiat' | 'crypto'
  filters: StatsFilters

  /** What the screen calls each status bucket ('Approved', 'Paid', …). */
  statusLabels: Record<Exclude<StatusKey, 'other'>, string>
}

const STATUS_COLOR: Record<StatusKey, ChartColor> = { success: 'success', pending: 'warning', failed: 'danger', other: 'muted-foreground' }
const DONUT_SLICES = 6

const FinanceStatsPanel = ({ kind, rail, filters, statusLabels }: Props) => {
  const query = useStatsQuery(kind, rail, filters)
  const stats = useApi<FinanceStats>(STATS, query)
  const prev = useApi<FinanceStats>(STATS, { ...query, ...filters.previous.apiRange })

  const s = stats.data
  const p = prev.data
  const currency = s?.currency ?? query.convertTo
  const loading = stats.isLoading
  const noun = kind === 'deposits' ? 'deposits' : 'withdrawals'

  const charts = useMemo(() => {
    const rows = s?.series ?? []
    const pick = (status: StatusKey, field: 'amount' | 'count') => fillBuckets(filters.buckets, rows, r => r.bucket, r => r.byStatus[status][field])
    const statuses = ['success', 'pending', 'failed'] as const

    const amountSeries = statuses.map(k => ({ name: statusLabels[k], data: pick(k, 'amount'), color: STATUS_COLOR[k] }))
    const countSeries = statuses.map(k => ({ name: statusLabels[k], data: pick(k, 'count'), color: STATUS_COLOR[k] }))
    const total = fillBuckets(filters.buckets, rows, r => r.bucket, r => r.amount)

    // Donut: the largest slices, the tail folded into "Other".
    const dims = s?.breakdown.rows ?? []
    const head = dims.slice(0, DONUT_SLICES)
    const tail = dims.slice(DONUT_SLICES)
    const donutLabels = [...head.map(d => d.key), ...(tail.length ? ['Other'] : [])]
    const donutValues = [...head.map(d => Number(d.amount)), ...(tail.length ? [tail.reduce((t, d) => t + Number(d.amount), 0)] : [])]

    return { amountSeries, countSeries, total, donutLabels, donutValues, dims }
  }, [s, filters.buckets, statusLabels])

  const delta = (cur?: string | number, before?: string | number) => (p && cur !== undefined && before !== undefined ? percentChange(Number(cur), Number(before)) : null)
  const t = s?.totals
  const goodWhen = kind === 'deposits' ? 'up' : 'neutral'

  return (
    <section aria-label={`${noun} statistics`} className='mb-6 grid gap-4'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <KpiCard
          label={`Total ${noun}`}
          value={<Money value={t?.amount} currency={currency} />}
          loading={loading}
          delta={delta(t?.amount, p?.totals.amount)}
          goodWhen={goodWhen}
          hint={`${formatNumber(t?.count)} requests · ${formatNumber(t?.uniqueUsers)} players`}
          spark={charts.total}
          sparkFormat='money'
          sparkCurrency={currency}
        />
        <KpiCard
          label={statusLabels.success}
          value={<Money value={t?.successAmount} currency={currency} />}
          loading={loading}
          delta={delta(t?.successAmount, p?.totals.successAmount)}
          goodWhen={goodWhen}
          hint={
            <>
              {formatNumber(t?.successCount)} · avg <Money value={t?.averageSuccess} />
            </>
          }
          spark={charts.amountSeries[0]?.data}
          sparkColor='success'
          sparkFormat='money'
          sparkCurrency={currency}
        />
        <KpiCard
          label={statusLabels.pending}
          value={<Money value={t?.byStatus.pending.amount} currency={currency} />}
          loading={loading}
          goodWhen='down'
          hint={`${formatNumber(t?.byStatus.pending.count)} awaiting a decision`}
          spark={charts.countSeries[1]?.data}
          sparkColor='warning'
        />
        <KpiCard
          label='Success rate'
          value={t?.successRate == null ? '—' : `${(t.successRate * 100).toFixed(1)}%`}
          loading={loading}
          delta={t?.successRate != null && p?.totals.successRate != null ? percentChange(t.successRate, p.totals.successRate) : null}
          hint={
            <>
              {formatNumber(t?.byStatus.failed.count)} {statusLabels.failed.toLowerCase()} · <Money value={t?.byStatus.failed.amount} currency={currency} />
            </>
          }
        />
      </div>

      {s && s.unconverted.length > 0 && (
        <Alert>
          <AlertDescription>
            Not in the {currency} totals (no exchange rate):{' '}
            {s.unconverted.map(u => `${formatNumber(u.count)} in ${u.currency ?? 'unknown currency'}`).join(', ')}. Pick that currency to see it.
          </AlertDescription>
        </Alert>
      )}

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-3'>
        <ChartCard
          className='xl:col-span-2'
          title={`${kind === 'deposits' ? 'Deposit' : 'Withdrawal'} volume by status`}
          description={`Amount per ${filters.granularity}, ${currency}${s?.converted ? ' (converted at current rates)' : ''}`}
          table={seriesTable({ buckets: filters.buckets, granularity: filters.granularity, series: charts.amountSeries, format: 'money', currency })}
        >
          <TimeSeriesChart
            ariaLabel={`${noun} amount per ${filters.granularity} by status, ${currency}`}
            buckets={filters.buckets}
            granularity={filters.granularity}
            series={charts.amountSeries}
            kind='bar'
            stacked
            format='money'
            currency={currency}
            loading={loading}
            error={stats.error}
            emptyMessage={`No ${noun} in this period.`}
          />
        </ChartCard>
        <ChartCard
          title={`By ${s?.breakdown.dimension.toLowerCase() ?? 'source'}`}
          description={`Share of the amount, ${currency}`}
          table={categoryTable({
            categories: charts.dims.map(d => d.key),
            categoryHeader: s?.breakdown.dimension ?? 'Source',
            series: [
              { name: 'Requests', data: charts.dims.map(d => d.count) },
              { name: `Amount (${currency})`, data: charts.dims.map(d => Number(d.amount)) },
              { name: `${statusLabels.success} (${currency})`, data: charts.dims.map(d => Number(d.successAmount)) }
            ]
          })}
        >
          <DonutChart
            ariaLabel={`${noun} amount by ${s?.breakdown.dimension.toLowerCase() ?? 'source'}`}
            labels={charts.donutLabels}
            values={charts.donutValues}
            totalLabel='Total'
            format='money'
            currency={currency}
            loading={loading}
            error={stats.error}
            emptyMessage='Nothing to break down.'
          />
        </ChartCard>
      </div>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-3'>
        <ChartCard
          className='xl:col-span-2'
          title='Requests by status'
          description={`Count per ${filters.granularity}`}
          table={seriesTable({ buckets: filters.buckets, granularity: filters.granularity, series: charts.countSeries })}
        >
          <TimeSeriesChart
            ariaLabel={`${noun} count per ${filters.granularity} by status`}
            buckets={filters.buckets}
            granularity={filters.granularity}
            series={charts.countSeries}
            kind='line'
            loading={loading}
            error={stats.error}
            emptyMessage={`No ${noun} in this period.`}
          />
        </ChartCard>
        <ChartCard title='By currency' description='Requests per currency, before conversion'>
          <BarChart
            ariaLabel={`${noun} count by currency`}
            categories={(s?.byCurrency ?? []).map(c => c.currency)}
            series={[{ name: 'Requests', data: (s?.byCurrency ?? []).map(c => c.count) }]}
            horizontal
            loading={loading}
            error={stats.error}
            emptyMessage='No currencies in this period.'
          />
        </ChartCard>
      </div>
    </section>
  )
}

export default FinanceStatsPanel
