'use client'

import { useMemo, useState, type ReactNode } from 'react'

import Link from 'next/link'
import { parseAsString, useQueryState } from 'nuqs'

import { ArrowDownToLineIcon, ArrowUpFromLineIcon, DicesIcon, ScaleIcon, SparklesIcon, TrophyIcon, UserPlusIcon } from 'lucide-react'

import {
  BarChart,
  bucketLabel,
  categoryTable,
  ChartCard,
  DonutChart,
  FilterBar,
  fillBuckets,
  formatValue,
  KpiCard,
  percentChange,
  seriesTable,
  TimeSeriesChart,
  useStatsFilters,
  type ChartSeries
} from '@/components/shared/charts'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import { useSession } from '@/contexts/SessionContext'
import { useApi, usePagedApi } from '@/hooks/use-api'
import { formatMoney, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import ExchangeDashboard from '@/views/exchange/ExchangeDashboard'

/** One bucket of `admin/dashboard/stats/series`. Money keys are decimal strings, in `currency`. */
type StatsBucket = {
  bucket: string
  deposits: string
  depositCount: number
  withdrawals: string
  withdrawalCount: number
  net: string
  registrations: number
  casinoWagered: string
  casinoWon: string
  casinoGgr: string
  casinoBets: number

  /** The site's own games (Original Games + in-house) — part of the casino figures; third-party = casino − originals. */
  originalsWagered: string
  originalsWon: string
  originalsGgr: string
  originalsBets: number
  sportsStaked: string
  sportsGgr: string
  sportsBets: number
}
type StatsSeries = {
  range: { from: string; to: string }
  granularity: string
  currency: string
  converted: boolean
  valuation: { note: string; ratesAsOf: string | null } | null
  buckets: StatsBucket[]
  totals: Omit<StatsBucket, 'bucket'>
  unconverted: { metric: string; currency: string | null; amount: string }[]
}
type TopEntry = { key: string; name: string; provider?: string | null; wagered: string; bets: number }
type StatsTop = { currency: string; converted: boolean; games: TopEntry[]; originals?: TopEntry[]; sports: TopEntry[] }

type UserStats = {
  total: number
  newToday: number
  registeredLast30Days: number
  registeredPrevious30Days: number
  verified: number
  topCountries: { country: string; count: number }[]
  registrationTrend: { date: string; count: number }[]
}
type Movement = Record<string, unknown> & {
  id?: number | string
  kind?: string
  source?: string
  userId?: number
  username?: string
  amount?: string
  currency?: string
  status?: string
  createdAt?: string
  created?: string

  /** What `admin/dashboard/movements` sends: the time as `at`, the owner as `user`. */
  at?: string
  user?: { id: string; name?: string | null; email?: string | null } | null
}
type Registration = Record<string, unknown> & {
  id: number | string
  username?: string
  name?: string
  email?: string
  country?: string

  /** What `admin/dashboard/registrations` sends; the other two are older spellings. */
  registeredAt?: string
  created?: string
  createdAt?: string
}

/** Status colour is meaning, never decoration: green = done, amber = waiting, red = gone wrong. */
const STATUS_TONES: Record<string, string> = {
  completed: 'bg-success-soft text-success',
  complete: 'bg-success-soft text-success',
  approved: 'bg-success-soft text-success',
  settled: 'bg-success-soft text-success',
  success: 'bg-success-soft text-success',
  successful: 'bg-success-soft text-success',
  paid: 'bg-success-soft text-success',
  confirmed: 'bg-success-soft text-success',
  pending: 'bg-warning-soft text-warning',
  processing: 'bg-warning-soft text-warning',
  submitted: 'bg-warning-soft text-warning',
  open: 'bg-warning-soft text-warning',
  review: 'bg-warning-soft text-warning',
  failed: 'bg-danger-soft text-danger',
  rejected: 'bg-danger-soft text-danger',
  cancelled: 'bg-danger-soft text-danger',
  canceled: 'bg-danger-soft text-danger',
  declined: 'bg-danger-soft text-danger',
  expired: 'bg-danger-soft text-danger'
}

const Pill = ({ value, className }: { value: string | null | undefined; className?: string }) => {
  if (value === null || value === undefined || value === '') return <span className='text-muted-foreground'>—</span>

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize',
        className
      )}
    >
      {String(value).replace(/[_-]+/g, ' ')}
    </span>
  )
}

const StatusPill = ({ value }: { value: string | null | undefined }) => (
  <Pill value={value} className={STATUS_TONES[String(value ?? '').toLowerCase()] ?? 'bg-muted text-muted-foreground'} />
)

const movementColumns: Column<Movement>[] = [
  {
    key: 'kind',
    header: 'Kind',
    cell: r => <Pill value={String(r.kind ?? r.source ?? '')} className='bg-muted text-foreground' />
  },
  {
    key: 'user',
    header: 'User',
    cell: r => (
      <Link className='font-medium hover:underline' href={`/users/${r.userId ?? ''}`}>
        {String(r.user?.name ?? r.username ?? r.userId ?? '—')}
      </Link>
    )
  },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
  { key: 'status', header: 'Status', cell: r => <StatusPill value={r.status} /> },
  {
    key: 'at',
    header: 'When',
    cell: r => (
      <span className='text-muted-foreground'>
        <DateTime value={(r.at ?? r.createdAt ?? r.created) as string} relative />
      </span>
    )
  }
]

const registrationColumns: Column<Registration>[] = [
  {
    key: 'name',
    header: 'User',
    cell: r => (
      <Link className='font-medium hover:underline' href={`/users/${r.id}`}>
        {String(r.username ?? r.name ?? r.id)}
      </Link>
    )
  },
  { key: 'email', header: 'Email', cell: r => <span className='text-muted-foreground'>{String(r.email ?? '—')}</span> },
  {
    key: 'country',
    header: 'Country',
    cell: r => <span className='font-mono text-xs tracking-wide uppercase'>{String(r.country ?? '—')}</span>
  },
  {
    key: 'at',
    header: 'Registered',
    cell: r => (
      <span className='text-muted-foreground'>
        <DateTime value={r.registeredAt ?? r.createdAt ?? r.created} relative />
      </span>
    )
  }
]

const SERIES = 'admin/dashboard/stats/series'
const TOP = 'admin/dashboard/stats/top'

/** Slices past this fold into "Other" on the sports donut. */
const DONUT_SLICES = 5

const METRIC_LABEL: Record<string, string> = {
  deposits: 'deposits',
  withdrawals: 'withdrawals',
  casinoWagered: 'casino stakes',
  casinoWon: 'casino wins',
  casinoGgr: 'casino GGR',
  originalsWagered: 'Original Games stakes',
  originalsWon: 'Original Games wins',
  originalsGgr: 'Original Games GGR',
  sportsStaked: 'sports stakes',
  sportsGgr: 'sports GGR'
}

const SectionHeading = ({ title, description }: { title: string; description?: ReactNode }) => (
  <div>
    <h2 className='text-sm font-medium'>{title}</h2>
    {description && <p className='text-muted-foreground mt-0.5 text-xs'>{description}</p>}
  </div>
)

const n = (v: string | number | null | undefined) => {
  const x = Number(v)

  return Number.isFinite(x) ? x : 0
}

/** "Direct Users" tab — site ke apne players: deposit, withdrawal, casino, sports, registrations. */
const DirectUserDashboard = () => {
  // Agent-tree logins (no promotions) see their own network, not the whole site.
  const inNetwork = useSession().actor?.promotions === false
  const f = useStatsFilters({ defaultPreset: 'all' })
  const reportCoin = useDefaultCurrency().code

  const series = useApi<StatsSeries>(SERIES, f.query, { placeholderData: prev => prev })

  // The previous window only feeds the deltas, so one bucket per month is plenty.
  const previous = useApi<StatsSeries>(SERIES, { ...f.previous.apiRange, granularity: 'month' })

  const top = useApi<StatsTop>(TOP, { ...f.apiRange, limit: 8 }, { placeholderData: prev => prev })
  const stats = useApi<UserStats>('admin/dashboard/user-stats', f.apiRange)
  const movements = usePagedApi<Movement>('admin/dashboard/movements', { limit: 8 })
  const registrations = usePagedApi<Registration>('admin/dashboard/registrations', { limit: 8 })

  const s = series.data
  const p = previous.data

  // Every currency, valued in the site's default coin; the answer names its unit.
  const unit = s?.currency || reportCoin
  const loading = series.isLoading
  const labels = useMemo(() => f.buckets.map(b => bucketLabel(b, f.granularity)), [f.buckets, f.granularity])

  const line = useMemo(() => {
    const rows = s?.buckets ?? []
    const pick = (key: keyof StatsBucket) => fillBuckets(f.buckets, rows, r => r.bucket, r => r[key])

    return {
      deposits: pick('deposits'),
      withdrawals: pick('withdrawals'),
      net: pick('net'),
      registrations: pick('registrations'),
      casinoWagered: pick('casinoWagered'),
      casinoGgr: pick('casinoGgr'),
      originalsWagered: pick('originalsWagered'),
      originalsGgr: pick('originalsGgr'),
      sportsStaked: pick('sportsStaked'),
      sportsGgr: pick('sportsGgr')
    }
  }, [s, f.buckets])

  const delta = (key: keyof Omit<StatsBucket, 'bucket'>) => (s && p ? percentChange(n(s.totals[key]), n(p.totals[key])) : null)

  const moneySeries: ChartSeries[] = [
    { name: 'Deposits', data: line.deposits, color: 'chart-1' },
    { name: 'Withdrawals', data: line.withdrawals, color: 'chart-2' }
  ]

  const minus = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => n(v) - n(b[i]))

  const turnoverSeries: ChartSeries[] = [
    { name: 'Casino wagered (third-party)', data: minus(line.casinoWagered, line.originalsWagered), color: 'chart-1' },
    { name: 'Original Games wagered', data: line.originalsWagered, color: 'chart-5' },
    { name: 'Sports staked', data: line.sportsStaked, color: 'chart-3' }
  ]

  const ggrSeries: ChartSeries[] = [
    { name: 'Casino GGR (third-party)', data: minus(line.casinoGgr, line.originalsGgr), color: 'chart-1' },
    { name: 'Original Games GGR', data: line.originalsGgr, color: 'chart-5' },
    { name: 'Sports GGR', data: line.sportsGgr, color: 'chart-3' }
  ]

  const registrationSeries: ChartSeries[] = [{ name: 'Registrations', data: line.registrations, color: 'chart-7' }]

  // "Top games" block: third-party casino or the Originals, switched inside the card.
  const [gameTab, setGameTab] = useState<'casino' | 'original'>('casino')
  const games = (gameTab === 'casino' ? top.data?.games : top.data?.originals) ?? []
  const gameNames = games.map(g => g.name)
  const gameSeries: ChartSeries[] = [{ name: 'Wagered', data: games.map(g => n(g.wagered)), color: gameTab === 'casino' ? 'chart-1' : 'chart-5' }]
  const gameLabel = gameTab === 'casino' ? 'casino' : 'original'

  const sports = useMemo(() => {
    const all = top.data?.sports ?? []
    const head = all.slice(0, DONUT_SLICES)
    const rest = all.slice(DONUT_SLICES).reduce((t, x) => t + n(x.wagered), 0)

    return {
      labels: [...head.map(x => x.name), ...(rest > 0 ? ['Other'] : [])],
      values: [...head.map(x => n(x.wagered)), ...(rest > 0 ? [rest] : [])]
    }
  }, [top.data])

  const countries = (stats.data?.topCountries ?? []).slice(0, 8)
  const topCount = Math.max(...countries.map(c => c.count), 1)
  const money = (v: string | number | null | undefined) => formatMoney(v, undefined, { digits: 2 })
  const tableArgs = { buckets: f.buckets, granularity: f.granularity, format: 'money' as const, currency: unit }

  return (
    <div>
      <p className='text-muted-foreground mb-4 max-w-prose text-sm'>
        Direct users only — players who signed up on the site and have no parent.{' '}
        {s?.converted ? s.valuation?.note : `Figures in ${unit}, for rows in that currency only.`}
      </p>

      <div className='flex flex-col gap-6'>
        <FilterBar filters={f} />

        {series.error && <ErrorState error={series.error} />}

        <div className='dashboard-kpis grid gap-4'>
          <KpiCard
            label='Deposits'
            value={money(s?.totals.deposits)}
            unit={unit}
            hint={`${formatNumber(s?.totals.depositCount)} ${s?.totals.depositCount === 1 ? 'deposit' : 'deposits'}`}
            icon={<ArrowDownToLineIcon />}
            loading={loading}
            delta={delta('deposits')}
            spark={line.deposits}
            sparkColor='chart-1'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          <KpiCard
            label='Withdrawals'
            value={money(s?.totals.withdrawals)}
            unit={unit}
            hint={`${formatNumber(s?.totals.withdrawalCount)} ${s?.totals.withdrawalCount === 1 ? 'withdrawal' : 'withdrawals'}`}
            icon={<ArrowUpFromLineIcon />}
            loading={loading}
            delta={delta('withdrawals')}
            goodWhen='neutral'
            spark={line.withdrawals}
            sparkColor='chart-2'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          <KpiCard
            label='Net deposits'
            value={<Money value={s?.totals.net} digits={2} signed />}
            unit={unit}
            hint='Deposits minus withdrawals'
            icon={<ScaleIcon />}
            loading={loading}
            delta={delta('net')}
            spark={line.net}
            sparkColor='chart-4'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
          <KpiCard
            label='New users'
            value={formatNumber(s?.totals.registrations)}
            hint='Registrations in the period'
            icon={<UserPlusIcon />}
            loading={loading}
            delta={delta('registrations')}
            spark={line.registrations}
            sparkColor='chart-7'
            sparkLabels={labels}
          />
          <KpiCard
            label='Casino GGR'
            value={<Money value={s?.totals.casinoGgr} digits={2} />}
            unit={unit}
            hint={`All casino incl. Original Games · ${money(s?.totals.casinoWagered)} wagered · ${formatNumber(s?.totals.casinoBets)} ${s?.totals.casinoBets === 1 ? 'bet' : 'bets'} · third-party GGR ${money(n(s?.totals.casinoGgr) - n(s?.totals.originalsGgr))}`}
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
            value={<Money value={s?.totals.originalsGgr} digits={2} />}
            unit={unit}
            hint={`${money(s?.totals.originalsWagered)} wagered · ${formatNumber(s?.totals.originalsBets)} ${s?.totals.originalsBets === 1 ? 'bet' : 'bets'}`}
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
            value={<Money value={s?.totals.sportsGgr} digits={2} />}
            unit={unit}
            hint={`${money(s?.totals.sportsStaked)} staked · ${formatNumber(s?.totals.sportsBets)} ${s?.totals.sportsBets === 1 ? 'bet' : 'bets'}`}
            icon={<TrophyIcon />}
            loading={loading}
            delta={delta('sportsGgr')}
            spark={line.sportsGgr}
            sparkColor='chart-3'
            sparkLabels={labels}
            sparkFormat='money'
            sparkCurrency={unit}
          />
        </div>

        {s && s.unconverted.length > 0 && (
          <p role='note' className='text-muted-foreground text-xs'>
            Not in the {unit} figures (no exchange rate):{' '}
            {s.unconverted
              .map(u => `${formatValue(u.amount, 'money')} ${u.currency ?? 'unknown coin'} of ${METRIC_LABEL[u.metric] ?? u.metric}`)
              .join(' · ')}
            .
          </p>
        )}

        <div className='grid gap-4 xl:grid-cols-3'>
          <ChartCard
            className='xl:col-span-2'
            title='Deposits vs withdrawals'
            description={`Completed money in and out, per ${f.granularity}, in ${unit}.`}
            table={seriesTable({ ...tableArgs, series: moneySeries })}
          >
            <TimeSeriesChart
              ariaLabel={`Deposits and withdrawals per ${f.granularity}, ${unit}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={moneySeries}
              kind='bar'
              format='money'
              currency={unit}
              loading={loading}
              error={series.error}
            />
          </ChartCard>
          <ChartCard
            title='New users'
            description={`Registrations per ${f.granularity}.`}
            table={seriesTable({ ...tableArgs, format: 'number', series: registrationSeries })}
          >
            <TimeSeriesChart
              ariaLabel={`Registrations per ${f.granularity}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={registrationSeries}
              kind='area'
              loading={loading}
              error={series.error}
              emptyMessage='No registrations in this period.'
            />
          </ChartCard>
        </div>

        <div className='grid gap-4 xl:grid-cols-2'>
          <ChartCard
            title='Turnover'
            description={`Third-party casino, Original Games and sports stakes, per ${f.granularity}, in ${unit}.`}
            table={seriesTable({ ...tableArgs, series: turnoverSeries })}
          >
            <TimeSeriesChart
              ariaLabel={`Casino and sports turnover per ${f.granularity}, ${unit}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={turnoverSeries}
              kind='area'
              format='money'
              currency={unit}
              loading={loading}
              error={series.error}
              emptyMessage='No bets in this period.'
            />
          </ChartCard>
          <ChartCard
            title='Gross gaming revenue'
            description='Stakes minus wins (casino); the house side of settled bets (sports). Below zero means players won.'
            table={seriesTable({ ...tableArgs, series: ggrSeries })}
          >
            <TimeSeriesChart
              ariaLabel={`Casino and sports GGR per ${f.granularity}, ${unit}`}
              buckets={f.buckets}
              granularity={f.granularity}
              series={ggrSeries}
              kind='bar'
              format='money'
              currency={unit}
              loading={loading}
              error={series.error}
              emptyMessage='No settled play in this period.'
            />
          </ChartCard>
        </div>

        <div className='grid gap-4 xl:grid-cols-3'>
          <ChartCard
            className='xl:col-span-2'
            title={`Top ${gameLabel} games`}
            description={`By amount wagered in the period, in ${unit}.`}
            actions={
              <Tabs value={gameTab} onValueChange={v => setGameTab(v as 'casino' | 'original')}>
                <TabsList>
                  <TabsTrigger value='casino'>Casino</TabsTrigger>
                  <TabsTrigger value='original'>Original</TabsTrigger>
                </TabsList>
              </Tabs>
            }
            table={categoryTable({ categories: gameNames, series: gameSeries, format: 'money', currency: unit, categoryHeader: 'Game' })}
          >
            <BarChart
              ariaLabel={`Top ${gameLabel} games by amount wagered, ${unit}`}
              categories={gameNames}
              series={gameSeries}
              horizontal
              format='money'
              currency={unit}
              height={300}
              loading={top.isLoading}
              error={top.error}
              emptyMessage={`No ${gameLabel} play in this period.`}
            />
          </ChartCard>
          <ChartCard
            title='Top sports'
            description={`Share of sports stakes, in ${unit}.`}
            table={categoryTable({ categories: sports.labels, series: [{ name: 'Staked', data: sports.values }], format: 'money', currency: unit, categoryHeader: 'Sport' })}
          >
            <DonutChart
              ariaLabel={`Sports stakes by sport, ${unit}`}
              labels={sports.labels}
              values={sports.values}
              format='money'
              currency={unit}
              height={300}
              loading={top.isLoading}
              error={top.error}
              emptyMessage='No sports bets in this period.'
            />
          </ChartCard>
        </div>

        <div className='grid gap-6 xl:grid-cols-3'>
          <section className='flex min-w-0 flex-col gap-3 xl:col-span-2'>
            <SectionHeading title='Latest money movements' description={`The most recent deposits and withdrawals ${inNetwork ? 'in your network' : 'across the site'}.`} />
            <DataTable
              columns={movementColumns}
              rows={movements.data?.rows}
              rowKey={(r, i) => String(r.id ?? i)}
              loading={movements.isLoading}
              error={movements.error}
              emptyMessage='No deposits or withdrawals yet.'
              dense
            />
          </section>
          <section className='flex min-w-0 flex-col gap-3'>
            <SectionHeading title='Top countries' description='Where registrations in the period came from.' />
            <div className='bg-card border-border rounded-xl border p-4'>
              {stats.isLoading && !stats.data ? (
                <div className='grid gap-3'>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={`c${i}`} className='h-4 w-full' />
                  ))}
                </div>
              ) : stats.error ? (
                <ErrorState error={stats.error} />
              ) : countries.length > 0 ? (
                <div className='grid gap-3'>
                  {countries.map(c => (
                    <div key={c.country} className='grid gap-1.5'>
                      <div className='flex items-baseline justify-between gap-3 text-sm'>
                        <span className='font-mono text-xs tracking-wide uppercase'>{c.country || '—'}</span>
                        <span className='tabular-nums'>{formatNumber(c.count)}</span>
                      </div>
                      <div className='bg-muted h-1 overflow-hidden rounded-full'>
                        <div className='bg-primary h-full rounded-full' style={{ width: `${Math.max((c.count / topCount) * 100, 4)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground text-sm'>No registrations in this period.</p>
              )}
            </div>
          </section>
        </div>

        <section className='flex flex-col gap-3'>
          <SectionHeading title='Recent registrations' description='Users who signed up most recently.' />
          <DataTable
            columns={registrationColumns}
            rows={registrations.data?.rows}
            rowKey={r => String(r.id)}
            loading={registrations.isLoading}
            error={registrations.error}
            dense
          />
        </section>
      </div>
    </div>
  )
}

/** Sports Exchange wallet dekhne ki koi bhi permission — navConfig ke WALLET_ANY jaisa. */
const WALLET_ANY = ['wallet:credit', 'wallet:debit', 'wallet:adjust', 'users:read']

type Tab = 'direct' | 'agent'

/**
 * Ek hi Dashboard page, do tab: "Direct Users" (site ke players) aur "Agent System"
 * (Sports Exchange ka points / P&L dashboard). Tab URL me `?tab=agent` se rehta hai, taaki
 * refresh / link pe wahi tab khule. Jis tab ki permission nahi, wo tab nahi dikhta.
 */
const Dashboard = () => {
  const { actor, can } = useSession()

  const tabs = (
    [
      { value: 'direct', label: 'Direct Users', allowed: actor?.direct === true && can('reports:read') },

      // In both sports modes: sportsbook bets of agents' players land in the same point ledger.
      { value: 'agent', label: 'Agent System', allowed: can(WALLET_ANY) }
    ] as const
  ).filter(t => t.allowed)

  // Through nuqs like the Direct tab's filters (useStatsFilters): a next/router replace raced their URL writes and left Agent stuck.
  const [asked, setAsked] = useQueryState('tab', parseAsString.withOptions({ history: 'replace', scroll: false }))
  const tab: Tab = tabs.find(t => t.value === asked)?.value ?? tabs[0]?.value ?? 'direct'
  const has = (value: Tab) => tabs.some(t => t.value === value)

  const select = (value: Tab) => void setAsked(value)

  return (
    <div>
      <PageHeader title='Dashboard' />
      <Tabs value={tab} onValueChange={v => select(v as Tab)}>
        {tabs.length > 1 && (
          <TabsList className='mb-4'>
            {tabs.map(t => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {has('direct') && (
          <TabsContent value='direct'>
            <DirectUserDashboard />
          </TabsContent>
        )}
        {has('agent') && (
          <TabsContent value='agent'>
            <ExchangeDashboard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

export default Dashboard
