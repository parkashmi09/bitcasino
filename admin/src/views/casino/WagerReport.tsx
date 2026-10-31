'use client'

import { useMemo, useState } from 'react'

import Can from '@/components/shared/Can'
import {
  BarChart,
  ChartCard,
  DonutChart,
  FilterBar,
  KpiCard,
  TimeSeriesChart,
  categoryTable,
  fillBuckets,
  percentChange,
  seriesTable,
  useStatsFilters
} from '@/components/shared/charts'
import DataTable, { type Column } from '@/components/shared/DataTable'
import Money from '@/components/shared/Money'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'

type Props = { area: 'casino' | 'sports' }

/** One row of figures — totals, a bucket, a provider, a game. Amounts are decimal strings. */
type Figures = {
  bets: number
  wagered: string
  won: string | null
  ggr: string | null
  margin: number | null
  paidWins: number
  refunds: number
  refunded: string
  openBets?: number
  openStake?: string
}

type TopRow = Figures & { key: string; vendor: string | null }

type WagerStats = {
  currency: string
  converted: boolean
  totals: Figures & { uniqueUsers: number; averageBet: string; winRate: number | null }
  series: (Figures & { bucket: string })[]
  bySource: (Figures & { key: string })[]
  breakdown: { dimension: string; rows: (Figures & { key: string })[] }
  top: { label: string; rows: TopRow[] }
  byCurrency: (Figures & { currency: string })[]
  unconverted: { currency: string | null; amount: string; count: number }[]
}

const STATS = 'admin/reports/wager-stats'
const DONUT_SLICES = 6

/** Casino only: every game, third-party providers, or the site's own Original Games. */
const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'casino', label: 'Casino (third-party)' },
  { value: 'originals', label: 'Original Games' }
] as const

type Category = (typeof CATEGORIES)[number]['value']

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

/**
 * Turnover, payouts and GGR (wagered − won, the house's side) for casino or sports, from
 * `GET admin/reports/wager-stats` (reports:read, scoped to the caller's agent tree).
 */
const WagerReportView = ({ area, channel }: Props & { channel: Channel }) => {
  const filters = useStatsFilters()
  const reportCoin = useDefaultCurrency().code
  const [category, setCategory] = useState<Category>('all')
  const query = { area, channel, ...(area === 'casino' && category !== 'all' ? { category } : {}), ...filters.query }
  const stats = useApi<WagerStats>(STATS, query)
  const prev = useApi<WagerStats>(STATS, { ...query, ...filters.previous.apiRange })

  const s = stats.data
  const p = prev.data
  const t = s?.totals
  const currency = s?.currency ?? reportCoin
  const loading = stats.isLoading
  const title = area === 'casino' ? 'Casino' : 'Sports'
  const dimension = (s?.breakdown.dimension ?? (area === 'casino' ? 'Provider' : 'Market')).toLowerCase()

  const charts = useMemo(() => {
    const rows = s?.series ?? []
    const pick = (f: (r: WagerStats['series'][number]) => string | number | null) => fillBuckets(filters.buckets, rows, r => r.bucket, f)

    const money = [
      { name: 'Wagered', data: pick(r => r.wagered), color: 'chart-1' as const },
      { name: 'Won (paid out)', data: pick(r => r.won), color: 'chart-2' as const },
      { name: 'GGR', data: pick(r => r.ggr), color: 'primary' as const, kind: 'line' as const }
    ]

    const bets = [{ name: area === 'sports' ? 'Settled bets' : 'Bets', data: pick(r => r.bets) }]

    const dims = s?.breakdown.rows ?? []
    const head = dims.slice(0, DONUT_SLICES)
    const tail = dims.slice(DONUT_SLICES)

    return {
      money,
      bets,
      dims,
      donutLabels: [...head.map(d => d.key), ...(tail.length ? ['Other'] : [])],
      donutValues: [...head.map(d => Number(d.wagered)), ...(tail.length ? [tail.reduce((n, d) => n + Number(d.wagered), 0)] : [])]
    }
  }, [s, filters.buckets, area])

  const delta = (cur?: string | number | null, before?: string | number | null) =>
    p && cur !== undefined && cur !== null && before !== undefined && before !== null ? percentChange(Number(cur), Number(before)) : null

  const topColumns: Column<TopRow>[] = [
    { key: 'name', header: s?.top.label ?? (area === 'casino' ? 'Game' : 'Event'), cell: r => <span className='text-sm font-medium'>{r.key}</span> },
    ...(area === 'casino' ? [{ key: 'vendor', header: 'Provider', cell: (r: TopRow) => <span className='text-muted-foreground text-sm'>{r.vendor ?? '—'}</span> }] : []),
    { key: 'bets', header: 'Bets', align: 'right', cell: r => <span className='tabular-nums'>{formatNumber(r.bets)}</span> },
    { key: 'wagered', header: 'Wagered', align: 'right', cell: r => <Money value={r.wagered} currency={currency} /> },
    ...(area === 'casino'
      ? [
          { key: 'won', header: 'Won', align: 'right' as const, cell: (r: TopRow) => <Money value={r.won} currency={currency} /> },
          { key: 'ggr', header: 'GGR', align: 'right' as const, cell: (r: TopRow) => <Money value={r.ggr} currency={currency} signed /> },
          { key: 'margin', header: 'Margin', align: 'right' as const, cell: (r: TopRow) => <span className='tabular-nums'>{pct(r.margin)}</span> }
        ]
      : [{ key: 'open', header: 'Open stake', align: 'right' as const, cell: (r: TopRow) => <Money value={r.openStake} currency={currency} /> }])
  ]

  return (
    <div>
      <FilterBar filters={filters} className='mb-4' />

      {area === 'casino' && (
        <Tabs value={category} onValueChange={v => setCategory(v as Category)} className='mb-4'>
          <TabsList aria-label='Game category'>
            {CATEGORIES.map(c => (
              <TabsTrigger key={c.value} value={c.value}>
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Can
        permission='reports:read'
        fallback={
          <Alert>
            <AlertDescription>The wager report needs the reports:read permission.</AlertDescription>
          </Alert>
        }
      >
        <div className='mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <KpiCard
            label='Wagered'
            value={<Money value={t?.wagered} currency={currency} />}
            loading={loading}
            delta={delta(t?.wagered, p?.totals.wagered)}
            hint={
              <>
                {formatNumber(t?.bets)} bets · avg <Money value={t?.averageBet} />
              </>
            }
            spark={charts.money[0].data}
            sparkFormat='money'
            sparkCurrency={currency}
          />
          <KpiCard
            label='Won by players'
            value={<Money value={t?.won} currency={currency} />}
            loading={loading}
            delta={delta(t?.won, p?.totals.won)}
            goodWhen='neutral'
            hint={`${formatNumber(t?.paidWins)} paid wins · win rate ${pct(t?.winRate)}`}
          />
          <KpiCard
            label='GGR'
            value={<Money value={t?.ggr} currency={currency} signed />}
            loading={loading}
            delta={delta(t?.ggr, p?.totals.ggr)}
            hint={`Margin ${pct(t?.margin)}`}
            spark={charts.money[2].data}
            sparkColor='primary'
            sparkFormat='money'
            sparkCurrency={currency}
          />
          {area === 'sports' ? (
            <KpiCard
              label='Open stake'
              value={<Money value={t?.openStake} currency={currency} />}
              loading={loading}
              goodWhen='neutral'
              hint={`${formatNumber(t?.openBets)} unsettled · ${formatNumber(t?.uniqueUsers)} players`}
            />
          ) : (
            <KpiCard
              label='Players'
              value={formatNumber(t?.uniqueUsers)}
              loading={loading}
              delta={delta(t?.uniqueUsers, p?.totals.uniqueUsers)}
              hint={
                <>
                  {formatNumber(t?.refunds)} refunds · <Money value={t?.refunded} currency={currency} />
                </>
              }
            />
          )}
        </div>

        {s && s.unconverted.length > 0 && (
          <Alert className='mb-4'>
            <AlertDescription>
              Not in the {currency} totals (no exchange rate): {s.unconverted.map(u => `${u.currency ?? 'unknown currency'}`).join(', ')}. Pick that currency to see it.
            </AlertDescription>
          </Alert>
        )}

        <div className='mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3'>
          <ChartCard
            className='xl:col-span-2'
            title='Wagered vs won vs GGR'
            description={`Per ${filters.granularity}, ${currency}${s?.converted ? ' (converted at current rates)' : ''}`}
            table={seriesTable({ buckets: filters.buckets, granularity: filters.granularity, series: charts.money, format: 'money', currency })}
          >
            <TimeSeriesChart
              ariaLabel={`${title} wagered, won and GGR per ${filters.granularity}, ${currency}`}
              buckets={filters.buckets}
              granularity={filters.granularity}
              series={charts.money}
              kind='bar'
              format='money'
              currency={currency}
              loading={loading}
              error={stats.error}
              emptyMessage='No bets in this period.'
            />
          </ChartCard>
          <ChartCard
            title={`Wagered by ${dimension}`}
            description={`Share of turnover, ${currency}`}
            table={categoryTable({
              categories: charts.dims.map(d => d.key),
              categoryHeader: s?.breakdown.dimension ?? 'Provider',
              series: [
                { name: 'Bets', data: charts.dims.map(d => d.bets) },
                { name: `Wagered (${currency})`, data: charts.dims.map(d => Number(d.wagered)) },
                { name: `GGR (${currency})`, data: charts.dims.map(d => Number(d.ggr ?? 0)) }
              ]
            })}
          >
            <DonutChart
              ariaLabel={`${title} turnover by ${dimension}`}
              labels={charts.donutLabels}
              values={charts.donutValues}
              totalLabel='Wagered'
              format='money'
              currency={currency}
              loading={loading}
              error={stats.error}
              emptyMessage='Nothing wagered in this period.'
            />
          </ChartCard>
        </div>

        <div className='mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3'>
          <ChartCard
            className='xl:col-span-2'
            title={area === 'sports' ? 'Settled bets' : 'Bets placed'}
            description={`Count per ${filters.granularity}`}
            table={seriesTable({ buckets: filters.buckets, granularity: filters.granularity, series: charts.bets })}
          >
            <TimeSeriesChart
              ariaLabel={`${title} bets per ${filters.granularity}`}
              buckets={filters.buckets}
              granularity={filters.granularity}
              series={charts.bets}
              kind='area'
              loading={loading}
              error={stats.error}
              emptyMessage='No bets in this period.'
            />
          </ChartCard>
          <ChartCard title={`GGR by ${dimension}`} description={currency}>
            <BarChart
              ariaLabel={`${title} GGR by ${dimension}, ${currency}`}
              categories={charts.dims.slice(0, 8).map(d => d.key)}
              series={[{ name: 'GGR', data: charts.dims.slice(0, 8).map(d => Number(d.ggr ?? 0)) }]}
              horizontal
              format='money'
              currency={currency}
              loading={loading}
              error={stats.error}
              emptyMessage='Nothing to compare.'
            />
          </ChartCard>
        </div>

        <h2 className='mb-2 text-sm font-medium'>Top {area === 'casino' ? 'games' : 'events'} by turnover</h2>
        <DataTable columns={topColumns} rows={s?.top.rows} rowKey={r => `${r.vendor ?? ''}|${r.key}`} loading={loading} error={stats.error} emptyMessage='No bets in this period.' />
      </Can>
    </div>
  )
}

/** Wager report — Direct Users | Agent Users alag tab (dono ke figures alag). */
const WagerReport = ({ area }: Props) => (
  <div>
    <PageHeader
      title={`${area === 'casino' ? 'Casino' : 'Sports'} wager report`}
      description={
        area === 'casino'
          ? 'Stakes, payouts and gross gaming revenue (GGR = wagered − won) across every casino provider and the Original Games, for the players in your tree. Refunds are kept out of both sides.'
          : 'Stakes of settled bets (when they were placed) against settlement payouts (when they were paid), for the players in your tree. GGR = wagered − won.'
      }
    />
    <ChannelTabs>{channel => <WagerReportView area={area} channel={channel} />}</ChannelTabs>
  </div>
)

export default WagerReport
