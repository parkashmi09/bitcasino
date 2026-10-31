'use client'

import { useMemo, type ReactNode } from 'react'

import Link from 'next/link'

import { CoinsIcon, DicesIcon, GiftIcon, LandmarkIcon, ScaleIcon, SparklesIcon, TrendingUpIcon, TrophyIcon } from 'lucide-react'

import {
  BarChart,
  bucketLabel,
  categoryTable,
  ChartCard,
  DonutChart,
  FilterBar,
  fillBuckets,
  KpiCard,
  percentChange,
  seriesTable,
  TimeSeriesChart,
  useStatsFilters,
  type ChartColor,
  type ChartSeries,
  type ChartTableData
} from '@/components/shared/charts'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import { useSession } from '@/contexts/SessionContext'
import { useApi } from '@/hooks/use-api'
import { formatMoney, formatNumber } from '@/lib/format'

/**
 * Profit & loss: what the house made from play (GGR), what it handed back to players (bonuses,
 * rakeback, VIP, affiliate, …) and what is left, over time and by product, game, sport and player.
 *
 * Reads `admin/reports/pnl-stats/summary` and `…/breakdown`. The GGR is the dashboard's own figure
 * (same backend code), so the two pages agree for the same filter. Amounts are decimal strings in
 * `range.currency`; the cost lines are house-only and arrive as `null` for agent-tree accounts.
 */

const SUMMARY = 'admin/reports/pnl-stats/summary'
const BREAKDOWN = 'admin/reports/pnl-stats/breakdown'

type Amount = string
type CostLine = { key: string; label: string; value: Amount; count: number }
type WaterfallStep = { key: string; label: string; kind: 'revenue' | 'cost' | 'total'; value: Amount }
type SeriesRow = {
  bucket: string
  casinoGgr: Amount
  originalsGgr: Amount
  sportsGgr: Amount
  ggr: Amount
  costs: Amount | null
  netProfit: Amount | null
  deposits: Amount
  withdrawals: Amount
  netCashflow: Amount
} & Record<string, Amount | null>

type Summary = {
  range: { from: string; to: string; granularity: string; timezone: string; currency: string }
  converted: boolean
  valuation: { note: string } | null
  house: boolean
  kpis: {

    /** Every casino game; = thirdPartyGgr + originalsGgr. */
    casinoGgr: Amount
    thirdPartyGgr: Amount
    originalsGgr: Amount
    originalsWagered: Amount
    originalsWon: Amount
    originalsBets: number
    sportsGgr: Amount
    ggr: Amount
    costs: Amount | null
    netProfit: Amount | null
    casinoWagered: Amount
    casinoWon: Amount
    casinoBets: number
    sportsStaked: Amount
    sportsBets: number
    holdPercent: number | null
    deposits: Amount
    withdrawals: Amount
    netCashflow: Amount
  }
  costLines: CostLine[] | null
  waterfall: WaterfallStep[]
  series: SeriesRow[]
  notes: { costs: string | null }
  unconverted: string[]
}

type Row = {
  key: string
  label: string
  provider?: string
  category?: string
  source?: string
  sport?: string
  id?: string
  wagered: Amount
  won: Amount
  ggr: Amount
  bets: number
  holdPercent: number | null
}

type Breakdown = {
  range: Summary['range']
  totals: { casino: Row; sports: Row }
  casino: { bySource: Row[]; byProvider: Row[]; byCategory: Row[]; topGames: Row[]; worstGames: Row[]; gameCount: number }
  originals: Row[]
  sports: { bySport: Row[]; byMarket: Row[]; topEvents: Row[]; worstEvents: Row[]; eventCount: number }
  players: { houseWon: Row[]; houseLost: Row[] }
  unconverted: string[]
}

/** Bars per categorical chart; the table behind the toggle holds the full list. */
const CHART_ROWS = 10
const DONUT_SLICES = 6

const num = (v: string | number | null | undefined) => {
  const x = Number(v)

  return Number.isFinite(x) ? x : 0
}

const money = (v: string | number | null | undefined) => formatMoney(v, undefined, { digits: 2 })

const SectionHeading = ({ title, description }: { title: string; description?: ReactNode }) => (
  <div className='mt-2'>
    <h2 className='text-base font-semibold'>{title}</h2>
    {description && <p className='text-muted-foreground mt-0.5 text-xs'>{description}</p>}
  </div>
)

/** The table behind a breakdown chart: stakes, payouts, GGR and hold per row. */
function rowsTable(rows: Row[], unit: string, opts: { nameHeader?: string; extra?: { header: string; cell: (r: Row) => ReactNode } } = {}): ChartTableData {
  return {
    columns: [
      { header: opts.nameHeader ?? 'Name' },
      ...(opts.extra ? [{ header: opts.extra.header }] : []),
      { header: `Wagered (${unit})`, align: 'right' as const },
      { header: `Paid out (${unit})`, align: 'right' as const },
      { header: `GGR (${unit})`, align: 'right' as const },
      { header: 'Hold', align: 'right' as const },
      { header: 'Bets', align: 'right' as const }
    ],
    rows: rows.map(r => [
      r.id ? (
        <Link key='name' className='font-medium hover:underline' href={`/users/${r.id}`}>
          {r.label}
        </Link>
      ) : (
        r.label
      ),
      ...(opts.extra ? [opts.extra.cell(r)] : []),
      money(r.wagered),
      money(r.won),
      <Money key='ggr' value={r.ggr} digits={2} signed />,
      r.holdPercent === null ? '—' : `${r.holdPercent.toFixed(2)}%`,
      formatNumber(r.bets)
    ])
  }
}

type BreakdownChartProps = {
  title: string
  description?: ReactNode
  rows: Row[]
  unit: string
  loading: boolean
  error: unknown
  color?: ChartColor
  nameHeader?: string
  extra?: { header: string; cell: (r: Row) => ReactNode }
  emptyMessage?: string
}

/** A horizontal GGR bar per row, with the full table behind the toggle. */
const BreakdownChart = ({ title, description, rows, unit, loading, error, color = 'chart-1', nameHeader, extra, emptyMessage }: BreakdownChartProps) => {
  const shown = rows.slice(0, CHART_ROWS)

  return (
    <ChartCard title={title} description={description} table={rowsTable(rows, unit, { nameHeader, extra })}>
      <BarChart
        ariaLabel={`${title}, GGR in ${unit}`}
        categories={shown.map(r => r.label)}
        series={[{ name: 'GGR', data: shown.map(r => num(r.ggr)), color }]}
        horizontal
        format='money'
        currency={unit}
        loading={loading}
        error={error}
        height={Math.max(220, shown.length * 34 + 60)}
        emptyMessage={emptyMessage ?? 'No play in this period.'}
      />
    </ChartCard>
  )
}

const ProfitLossView = ({ channel }: { channel: Channel }) => {
  const f = useStatsFilters({ defaultPreset: '30d' })
  const reportCoin = useDefaultCurrency().code

  // Direct Users | Agent Users tab — har query me `channel`.
  const q = { ...f.query, channel }
  const summary = useApi<Summary>(SUMMARY, q, { placeholderData: prev => prev, retry: false })

  // The previous window only feeds the deltas, so one bucket per month is plenty.
  const previous = useApi<Summary>(
    SUMMARY,
    { ...f.previous.apiRange, granularity: 'month', channel },
    { retry: false }
  )

  const breakdown = useApi<Breakdown>(BREAKDOWN, q, { placeholderData: prev => prev, retry: false })

  const s = summary.data
  const p = previous.data
  const b = breakdown.data
  const unit = s?.range.currency ?? reportCoin
  const house = s?.house ?? true
  const loading = summary.isLoading
  const bLoading = breakdown.isLoading
  const labels = useMemo(() => f.buckets.map(x => bucketLabel(x, f.granularity)), [f.buckets, f.granularity])

  const line = useMemo(() => {
    const rows = s?.series ?? []
    const pick = (key: string, sign = 1) => fillBuckets(f.buckets, rows, r => r.bucket, r => (r[key] === null || r[key] === undefined ? 0 : sign * num(r[key])))

    return {
      casinoGgr: pick('casinoGgr'),
      originalsGgr: pick('originalsGgr'),
      thirdPartyGgr: fillBuckets(f.buckets, rows, r => r.bucket, r => num(r.casinoGgr) - num(r.originalsGgr)),
      sportsGgr: pick('sportsGgr'),
      ggr: pick('ggr'),
      costs: pick('costs'),
      negCosts: pick('costs', -1),
      netProfit: pick('netProfit'),
      netCashflow: pick('netCashflow'),
      deposits: pick('deposits'),
      withdrawals: pick('withdrawals')
    }
  }, [s, f.buckets])

  const delta = (key: keyof Summary['kpis']) => {
    const cur = s?.kpis[key]
    const prev = p?.kpis[key]

    if (cur === null || cur === undefined || prev === null || prev === undefined) return null

    return percentChange(num(cur), num(prev))
  }

  const tableArgs = { buckets: f.buckets, granularity: f.granularity, format: 'money' as const, currency: unit }

  // ── Waterfall: revenue green, costs red, subtotals in the primary colour ──
  const steps = s?.waterfall ?? []
  const pickStep = (kind: WaterfallStep['kind']) => steps.map(w => (w.kind === kind ? num(w.value) : null))

  const waterfallSeries: ChartSeries[] = [
    { name: 'Revenue', data: pickStep('revenue'), color: 'success' },
    { name: 'Player costs', data: pickStep('cost'), color: 'danger' },
    { name: 'Total', data: pickStep('total'), color: 'primary' }
  ]

  const waterfallTable: ChartTableData = {
    columns: [{ header: 'Line' }, { header: `Amount (${unit})`, align: 'right' }],
    rows: steps.map(w => [
      w.kind === 'total' ? <strong key='l'>{w.label}</strong> : w.label,
      <Money key='v' value={w.value} digits={2} signed={w.kind !== 'total'} />
    ])
  }

  // ── Donuts: GGR by product, player costs by type ──
  const products = (() => {
    const parts = [
      { label: 'Casino (third-party)', value: num(s?.kpis.thirdPartyGgr), color: 'chart-1' as const },
      { label: 'Original Games', value: num(s?.kpis.originalsGgr), color: 'chart-5' as const },
      { label: 'Sports', value: num(s?.kpis.sportsGgr), color: 'chart-3' as const }
    ]

    return parts.filter(x => x.value > 0)
  })()

  const costParts = useMemo(() => {
    const lines = (s?.costLines ?? []).filter(l => num(l.value) > 0).sort((a, c) => num(c.value) - num(a.value))
    const head = lines.slice(0, DONUT_SLICES)
    const rest = lines.slice(DONUT_SLICES).reduce((t, l) => t + num(l.value), 0)

    return {
      labels: [...head.map(l => l.label), ...(rest > 0 ? ['Other'] : [])],
      values: [...head.map(l => num(l.value)), ...(rest > 0 ? [rest] : [])]
    }
  }, [s])

  const costTable: ChartTableData = {
    columns: [{ header: 'Cost' }, { header: `Paid (${unit})`, align: 'right' }, { header: 'Credits', align: 'right' }],
    rows: (s?.costLines ?? []).map(l => [l.label, money(l.value), formatNumber(l.count)])
  }

  // ── Over time ──
  const netSeries: ChartSeries[] = house
    ? [{ name: 'Net profit', data: line.netProfit, color: 'chart-4' }]
    : [{ name: 'Gross gaming revenue', data: line.ggr, color: 'chart-4' }]

  const stackSeries: ChartSeries[] = [
    { name: 'Casino GGR (third-party)', data: line.thirdPartyGgr, color: 'chart-1' },
    { name: 'Original Games GGR', data: line.originalsGgr, color: 'chart-5' },
    { name: 'Sports GGR', data: line.sportsGgr, color: 'chart-3' },
    ...(house ? [{ name: 'Player costs', data: line.negCosts, color: 'danger' as const }] : [])
  ]

  const cashSeries: ChartSeries[] = [
    { name: 'Deposits', data: line.deposits, color: 'chart-1', kind: 'bar' },
    { name: 'Withdrawals', data: line.withdrawals, color: 'chart-2', kind: 'bar' },
    { name: 'Net cash flow', data: line.netCashflow, color: 'chart-4', kind: 'line' }
  ]

  const unconverted = [...new Set([...(s?.unconverted ?? []), ...(b?.unconverted ?? [])])]
  const sourceExtra = { header: 'Provider', cell: (r: Row) => r.provider ?? '—' }

  return (
    <div>
      <p className='text-muted-foreground mb-4 text-sm'>
        {s?.valuation?.note ?? `All currencies, converted to ${unit} at current rates.`}
      </p>

      <div className='flex flex-col gap-6'>
        <FilterBar filters={f} />

        {summary.error && !s && <ErrorState error={summary.error} title='Could not load the profit & loss' />}

        {unconverted.length > 0 && (
          <p role='note' className='text-warning text-xs'>
            No exchange rate for {unconverted.join(', ')}. Those rows are left out of the {unit} figures; pick the currency to see them.
          </p>
        )}

        {s && !house && s.notes.costs && (
          <p role='note' className='bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm'>
            {s.notes.costs}
          </p>
        )}

        {/* ── Headline ── */}
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          <KpiCard
            label='Casino GGR'
            value={<Money value={s?.kpis.casinoGgr} digits={2} />}
            unit={unit}
            hint={`All casino · ${money(s?.kpis.casinoWagered)} wagered − ${money(s?.kpis.casinoWon)} paid out · third-party ${money(s?.kpis.thirdPartyGgr)}`}
            icon={<DicesIcon />}
            loading={loading}
            delta={delta('casinoGgr')}
            spark={line.casinoGgr}
            sparkColor='chart-1'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          <KpiCard
            label='Original Games GGR'
            value={<Money value={s?.kpis.originalsGgr} digits={2} />}
            unit={unit}
            hint={`${money(s?.kpis.originalsWagered)} wagered − ${money(s?.kpis.originalsWon)} paid out · ${formatNumber(s?.kpis.originalsBets)} bets`}
            icon={<SparklesIcon />}
            loading={loading}
            delta={delta('originalsGgr')}
            spark={line.originalsGgr}
            sparkColor='chart-5'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          <KpiCard
            label='Sports GGR'
            value={<Money value={s?.kpis.sportsGgr} digits={2} />}
            unit={unit}
            hint={`${money(s?.kpis.sportsStaked)} staked · ${formatNumber(s?.kpis.sportsBets)} bets`}
            icon={<TrophyIcon />}
            loading={loading}
            delta={delta('sportsGgr')}
            spark={line.sportsGgr}
            sparkColor='chart-3'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          <KpiCard
            label='Gross gaming revenue'
            value={<Money value={s?.kpis.ggr} digits={2} />}
            unit={unit}
            hint={s?.kpis.holdPercent === null || s?.kpis.holdPercent === undefined ? 'Casino GGR + sports GGR' : `Casino + sports · ${s.kpis.holdPercent.toFixed(2)}% hold on turnover`}
            icon={<CoinsIcon />}
            loading={loading}
            delta={delta('ggr')}
            spark={line.ggr}
            sparkColor='chart-4'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          {house && (
            <KpiCard
              label='Player costs'
              value={<Money value={s?.kpis.costs} digits={2} />}
              unit={unit}
              hint='Bonuses, rakeback, VIP, affiliate and other rewards paid'
              icon={<GiftIcon />}
              loading={loading}
              delta={delta('costs')}
              goodWhen='down'
              spark={line.costs}
              sparkColor='danger'
              sparkLabels={labels}
              sparkFormat='money'
              sparkCurrency={unit}
            />
          )}
          {house && (
            <KpiCard
              label='Net profit'
              value={<Money value={s?.kpis.netProfit} digits={2} signed />}
              unit={unit}
              hint='Gross gaming revenue − player costs'
              icon={<TrendingUpIcon />}
              loading={loading}
              delta={delta('netProfit')}
              spark={line.netProfit}
              sparkColor='chart-4'
              sparkLabels={labels}
              sparkFormat='money'
              sparkCurrency={unit}
            />
          )}
          <KpiCard
            label='Net cash flow'
            value={<Money value={s?.kpis.netCashflow} digits={2} signed />}
            unit={unit}
            hint='Deposits − withdrawals. Cash movement, not profit.'
            icon={<LandmarkIcon />}
            loading={loading}
            delta={delta('netCashflow')}
            goodWhen='neutral'
            spark={line.netCashflow}
            sparkColor='chart-2'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
        </div>

        {/* ── Waterfall and split ── */}
        <div className='grid gap-4 xl:grid-cols-3'>
          <ChartCard
            className='xl:col-span-2'

            // Costs are house-only, so the agent tree's chart stops at GGR.
            title={house ? 'From revenue to net profit' : 'Gross gaming revenue'}
            description={house ? `Casino and sports GGR, minus every player cost, in ${unit}.` : `Casino and sports GGR of your tree, in ${unit}.`}
            table={waterfallTable}
          >
            <BarChart
              ariaLabel={`Profit waterfall in ${unit}`}
              categories={steps.map(w => w.label)}
              series={waterfallSeries}
              stacked
              format='money'
              currency={unit}
              loading={loading}
              error={summary.error}
              height={320}
              emptyMessage='No revenue or costs in this period.'
            />
          </ChartCard>

          <ChartCard
            title='GGR by product'
            description='Share of positive GGR. A product that lost money is left out of the ring.'
            table={categoryTable({
              categories: ['Casino (third-party)', 'Original Games', 'Sports'],
              series: [{ name: 'GGR', data: [num(s?.kpis.thirdPartyGgr), num(s?.kpis.originalsGgr), num(s?.kpis.sportsGgr)] }],
              format: 'money',
              currency: unit
            })}
          >
            <DonutChart
              ariaLabel={`GGR by product, ${unit}`}
              labels={products.map(x => x.label)}
              values={products.map(x => x.value)}
              colors={products.map(x => x.color)}
              totalLabel='GGR'
              format='money'
              currency={unit}
              loading={loading}
              error={summary.error}
              emptyMessage='No positive GGR in this period.'
            />
          </ChartCard>
        </div>

        {house && (
          <div className='grid gap-4 xl:grid-cols-3'>
            <ChartCard title='Player costs by type' description={`What was paid to players, in ${unit}.`} table={costTable}>
              <DonutChart
                ariaLabel={`Player costs by type, ${unit}`}
                labels={costParts.labels}
                values={costParts.values}
                totalLabel='Costs'
                format='money'
                currency={unit}
                loading={loading}
                error={summary.error}
                emptyMessage='No player costs in this period.'
              />
            </ChartCard>
            <ChartCard
              className='xl:col-span-2'
              title='Each cost line'
              description={`Paid in the period, largest first, in ${unit}.`}
              table={costTable}
            >
              {(() => {
                const lines = (s?.costLines ?? []).filter(l => num(l.value) !== 0).sort((a, c) => num(c.value) - num(a.value))

                return (
                  <BarChart
                    ariaLabel={`Player costs per line, ${unit}`}
                    categories={lines.map(l => l.label)}
                    series={[{ name: 'Paid', data: lines.map(l => num(l.value)), color: 'danger' }]}
                    horizontal
                    format='money'
                    currency={unit}
                    loading={loading}
                    error={summary.error}
                    height={Math.max(220, lines.length * 34 + 60)}
                    emptyMessage='No player costs in this period.'
                  />
                )
              })()}
            </ChartCard>
          </div>
        )}

        {/* ── Over time ── */}
        <SectionHeading title='Over time' description={`Per ${f.granularity}, in ${unit}. Bars below zero are periods the house lost money.`} />
        <div className='grid gap-4 xl:grid-cols-2'>
          <ChartCard
            title={house ? 'Net profit' : 'Gross gaming revenue'}
            description={house ? 'GGR − player costs.' : 'Casino + sports GGR of your tree.'}
            table={seriesTable({ ...tableArgs, series: netSeries })}
          >
            <TimeSeriesChart
              ariaLabel={`${house ? 'Net profit' : 'GGR'} per ${f.granularity}, ${unit}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={netSeries}
              kind='bar'
              format='money'
              currency={unit}
              loading={loading}
              error={summary.error}
              emptyMessage='Nothing in this period.'
            />
          </ChartCard>
          <ChartCard
            title={house ? 'GGR vs player costs' : 'GGR by product'}
            description={house ? 'Revenue stacked above zero, costs below it.' : 'Casino and sports GGR, stacked.'}
            table={seriesTable({ ...tableArgs, series: house ? [...stackSeries.slice(0, 2), { name: 'Player costs', data: line.costs }] : stackSeries })}
          >
            <TimeSeriesChart
              ariaLabel={`GGR and costs per ${f.granularity}, ${unit}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={stackSeries}
              kind='bar'
              stacked
              format='money'
              currency={unit}
              loading={loading}
              error={summary.error}
              emptyMessage='Nothing in this period.'
            />
          </ChartCard>
          <ChartCard
            className='xl:col-span-2'
            title='Cash flow (not profit)'
            description='Deposits and withdrawals move cash in and out; they are the players’ money, so they are not counted in the P&L above.'
            table={seriesTable({ ...tableArgs, series: cashSeries })}
          >
            <TimeSeriesChart
              ariaLabel={`Deposits, withdrawals and net cash flow per ${f.granularity}, ${unit}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={cashSeries}
              format='money'
              currency={unit}
              loading={loading}
              error={summary.error}
              emptyMessage='No deposits or withdrawals in this period.'
            />
          </ChartCard>
        </div>

        {breakdown.error && !b && <ErrorState error={breakdown.error} title='Could not load the breakdown' />}

        {/* ── Casino ── */}
        <SectionHeading
          title='Casino'
          description={b ? `${formatNumber(b.casino.gameCount)} games played · GGR ${money(b.totals.casino.ggr)} ${unit} on ${money(b.totals.casino.wagered)} ${unit} wagered.` : undefined}
        />
        <div className='grid gap-4 xl:grid-cols-2'>
          <BreakdownChart title='By provider' rows={b?.casino.byProvider ?? []} unit={unit} loading={bLoading} error={breakdown.error} nameHeader='Provider' />
          <BreakdownChart title='By game type' rows={b?.casino.byCategory ?? []} unit={unit} loading={bLoading} error={breakdown.error} color='chart-5' nameHeader='Type' />
          <BreakdownChart
            title='Most profitable games'
            description='Where the house won the most.'
            rows={b?.casino.topGames ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='success'
            nameHeader='Game'
            extra={sourceExtra}
            emptyMessage='No game made money in this period.'
          />
          <BreakdownChart
            title='Games the house lost on'
            description='Players won more than they staked.'
            rows={b?.casino.worstGames ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='danger'
            nameHeader='Game'
            extra={sourceExtra}
            emptyMessage='No game lost money in this period.'
          />
          <BreakdownChart
            title='Original Games'
            description='Our own games, by game.'
            rows={b?.originals ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='chart-6'
            nameHeader='Game'
            emptyMessage='No originals played in this period.'
          />
          <BreakdownChart title='By game source' description='Which integration the play came through.' rows={b?.casino.bySource ?? []} unit={unit} loading={bLoading} error={breakdown.error} color='chart-7' nameHeader='Source' />
        </div>

        {/* ── Sports ── */}
        <SectionHeading
          title='Sports'
          description={b ? `${formatNumber(b.sports.eventCount)} events · GGR ${money(b.totals.sports.ggr)} ${unit}. Stakes count when placed, GGR when settled.` : undefined}
        />
        <div className='grid gap-4 xl:grid-cols-2'>
          <BreakdownChart title='By sport' rows={b?.sports.bySport ?? []} unit={unit} loading={bLoading} error={breakdown.error} color='chart-3' nameHeader='Sport' />
          <BreakdownChart title='By market' rows={b?.sports.byMarket ?? []} unit={unit} loading={bLoading} error={breakdown.error} color='chart-8' nameHeader='Market' />
          <BreakdownChart
            title='Most profitable events'
            rows={b?.sports.topEvents ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='success'
            nameHeader='Event'
            extra={{ header: 'Sport', cell: r => r.sport ?? '—' }}
            emptyMessage='No event made money in this period.'
          />
          <BreakdownChart
            title='Events the house lost on'
            rows={b?.sports.worstEvents ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='danger'
            nameHeader='Event'
            extra={{ header: 'Sport', cell: r => r.sport ?? '—' }}
            emptyMessage='No event lost money in this period.'
          />
        </div>

        {/* ── Players ── */}
        <SectionHeading title='Players' description='Casino + sports GGR per player in your tree. Open a row in the table to see the player.' />
        <div className='grid gap-4 xl:grid-cols-2'>
          <BreakdownChart
            title='House won the most from'
            rows={b?.players.houseWon ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='success'
            nameHeader='Player'
            emptyMessage='No player lost money in this period.'
          />
          <BreakdownChart
            title='House lost the most to'
            rows={b?.players.houseLost ?? []}
            unit={unit}
            loading={bLoading}
            error={breakdown.error}
            color='danger'
            nameHeader='Player'
            emptyMessage='No player won money in this period.'
          />
        </div>

        {/* ── How it is calculated ── */}
        <section className='bg-card rounded-lg border p-4 text-sm'>
          <h2 className='mb-2 flex items-center gap-2 text-base font-semibold'>
            <ScaleIcon className='size-4' /> How this is calculated
          </h2>
          <ul className='text-muted-foreground list-disc space-y-1.5 pl-5'>
            <li>
              <strong className='text-foreground'>GGR (gross gaming revenue)</strong> is what players staked minus what they won back: the
              house&apos;s share of the play. Casino GGR covers our own games (Original Games and Originals) and the third-party casino (bot and test rounds are left out;
              refunded and rolled-back rounds are not stakes); the waterfall shows third-party casino and Original Games on their own lines. Sports GGR is the house side of the sports settlement ledger. These are the same figures as the Dashboard.
            </li>
            <li>
              <strong className='text-foreground'>Player costs</strong> are rewards actually credited to players&apos; wallets: rakeback claimed,
              VIP level-up and rank-up rewards, daily / weekly / monthly bonuses, deposit and spin-wheel bonuses once converted to cash, affiliate
              commission and tier rewards claimed, welcome / register bonuses, race prizes, redeem codes, gift cards, staff bonus grants and vault
              interest. A reward that was reversed is taken back out. Accrued but unclaimed rewards, locked bonus balances and club earnings (which
              have no payout) are not costs yet. {house ? '' : 'Costs are visible to house staff only.'}
            </li>
            <li>
              <strong className='text-foreground'>Net profit</strong> = GGR − player costs. Deposits and withdrawals are shown as cash flow only:
              they are the players&apos; money, not revenue.
            </li>
            <li>
              <strong className='text-foreground'>Currency.</strong>{' '}
              Every amount is converted to {unit} at today’s exchange rates, so older periods move as rates move.{' '}
              {unconverted.length > 0
                ? `No rate for: ${unconverted.join(', ')}; those rows are not in the ${unit} figures.`
                : 'Every currency in this period has a rate.'}
            </li>
            <li>
              <strong className='text-foreground'>Time.</strong> Days and weeks are UTC (weeks start Monday). Casino rounds and costs count when they
              happened; sports stakes when placed and sports GGR when settled. The change on each card compares with the same-length period just
              before.
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}

/** Profit & loss — Direct Users | Agent Users alag tab (dono ke figures alag). */
const ProfitLoss = () => {
  const direct = useSession().actor?.direct === true

  return (
    <div>
      <PageHeader title='Profit & loss' description={`What was made from players, minus what was given back.${direct ? ' Direct and agent players are shown separately.' : ''}`} />
      <ChannelTabs>{channel => <ProfitLossView channel={channel} />}</ChannelTabs>
    </div>
  )
}

export default ProfitLoss
