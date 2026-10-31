'use client'

import { useMemo } from 'react'

import { ActivityIcon, BanIcon, ShieldCheckIcon, UserCheckIcon, UsersIcon } from 'lucide-react'

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
  type ChartSeries
} from '@/components/shared/charts'
import ErrorState from '@/components/shared/ErrorState'
import { Button } from '@/components/ui/button'
import { useApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'

/**
 * `GET admin/reports/user-status-stats` — `from`/`to` (instants), `granularity`, `channel`
 * (all|direct|agent — the users table's own filter). `reports:read`, scoped to the caller's tree
 * like the table. No currency: nothing here is money, and the strict validator refuses one.
 *
 * Statuses are what the platform stores: `users.status` ('closed' after the close route), the
 * lock columns (system / casino / sports, bet status) and `user_kyc.status`. There is no
 * self-exclusion, email/phone verification or presence on this platform, so none is shown.
 */
const PATH = 'admin/reports/user-status-stats'

type Slice = { key: string; label: string; value: number; total?: number; pct?: number | null }

type UserStatusStats = {
  range?: { from: string; to: string; granularity: string }
  kpis?: {
    totalUsers: number
    newUsers: number
    activeUsers: number
    activeUsersPct: number | null
    active: number
    restricted: number
    locked: number
    closed: number
    kycVerified: number
    kycPending: number
    kycVerifiedPct: number | null
    twoFa: number
    twoFaPct: number | null
    withEmail: number
    withPhone: number
    seen24h: number
    blocks: number
    unblocks: number
    productLocks: number
    closures: number
    kycApprovals: number
    kycRejections: number
  }
  series?: ({ bucket: string } & Record<string, number | string>)[]
  breakdown?: {
    status: Slice[]
    kyc: Slice[]
    locks: Slice[]
    security: Slice[]
    channel: Slice[]
    vip: Slice[] | null
  }
}

/** Status meaning → status tokens; anything the table holds that is not listed takes a categorical slot. */
const STATUS_COLORS: Record<string, ChartColor> = { active: 'success', restricted: 'warning', locked: 'danger', closed: 'muted-foreground' }
const KYC_COLORS: Record<string, ChartColor> = { none: 'muted-foreground', pending: 'warning', verified: 'success', rejected: 'danger' }

const colorsFor = (slices: Slice[], known: Record<string, ChartColor>): ChartColor[] => {
  let next = 3

  return slices.map(s => known[s.key] ?? (`chart-${Math.min(8, next++)}` as ChartColor))
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`)

type Props = {

  /** Agent-tree logins see no VIP figures (the backend sends `null` for them too). */
  showVip: boolean

  /** Kaunse users: 'direct' (parent nahi) ya 'agent' (parent hai). */
  channel?: 'direct' | 'agent'
}

/** Account-status charts for the Users page, driven by the FilterBar — ek channel (direct / agent) ke users. */
const UserStatusOverview = ({ showVip, channel = 'direct' }: Props) => {
  const f = useStatsFilters({ defaultPreset: '30d' })
  const query = { ...f.apiRange, granularity: f.granularity, channel }
  const q = useApi<UserStatusStats>(PATH, query, { placeholderData: prev => prev, retry: false })

  // Deltas only need the totals: the window right before, in one bucket per month.
  const prev = useApi<UserStatusStats>(PATH, { ...f.previous.apiRange, granularity: 'month', channel }, { retry: false })

  const s = q.data
  const k = s?.kpis
  const p = prev.data?.kpis
  const b = s?.breakdown
  const loading = q.isLoading
  const labels = useMemo(() => f.buckets.map(x => bucketLabel(x, f.granularity)), [f.buckets, f.granularity])

  const line = useMemo(() => {
    const rows = s?.series ?? []

    return (key: string) => fillBuckets(f.buckets, rows, r => r.bucket, r => Number(r[key] ?? 0))
  }, [s, f.buckets])

  if (q.error && !s) return <ErrorState error={q.error} title='Could not load the user status charts' />

  const blocked = k ? k.locked + k.closed : 0

  const growth: ChartSeries[] = [
    { name: 'New signups', data: line('signups'), color: 'chart-1' },
    { name: 'Active users', data: line('activeUsers'), color: 'chart-2' }
  ]

  const changes: ChartSeries[] = [
    { name: 'System locks', data: line('blocks'), color: 'danger' },
    { name: 'Unlocks', data: line('unblocks'), color: 'chart-4' },
    { name: 'Product locks', data: line('productLocks'), color: 'warning' },
    { name: 'Closures', data: line('closures'), color: 'muted-foreground' },
    { name: 'KYC approved', data: line('kycApprovals'), color: 'success' },
    { name: 'KYC rejected', data: line('kycRejections'), color: 'chart-6' }
  ]

  return (
    <section aria-label='User status' className='mb-6 flex flex-col gap-4'>
      <FilterBar filters={f} />

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5'>
        <KpiCard
          label='Total users'
          value={k ? formatNumber(k.totalUsers) : '—'}
          icon={<UsersIcon />}
          loading={loading}
          hint={k ? `${formatNumber(k.newUsers)} new in this period` : undefined}
          delta={k && p ? percentChange(k.newUsers, p.newUsers) : null}
          deltaLabel='new signups vs previous period'
          spark={line('signups')}
          sparkColor='chart-1'
          sparkLabels={labels}
          sparkFormat='number'
        />
        <KpiCard
          label='Active in period'
          value={k ? formatNumber(k.activeUsers) : '—'}
          icon={<ActivityIcon />}
          loading={loading}
          hint={k ? `${pct(k.activeUsersPct)} of users · signed in or bet` : undefined}
          delta={k && p ? percentChange(k.activeUsers, p.activeUsers) : null}
          spark={line('activeUsers')}
          sparkColor='chart-2'
          sparkLabels={labels}
          sparkFormat='number'
        />
        <KpiCard
          label='Blocked'
          value={k ? formatNumber(blocked) : '—'}
          icon={<BanIcon />}
          loading={loading}
          hint={k ? `${formatNumber(k.locked)} locked · ${formatNumber(k.closed)} closed · ${formatNumber(k.restricted)} product-restricted` : undefined}
          goodWhen='down'
        />
        <KpiCard
          label='KYC verified'
          value={k ? pct(k.kycVerifiedPct) : '—'}
          icon={<UserCheckIcon />}
          loading={loading}
          hint={k ? `${formatNumber(k.kycVerified)} verified · ${formatNumber(k.kycPending)} pending` : undefined}
        />
        <KpiCard
          label='2FA on'
          value={k ? pct(k.twoFaPct) : '—'}
          icon={<ShieldCheckIcon />}
          loading={loading}
          hint={k ? `${formatNumber(k.twoFa)} of ${formatNumber(k.totalUsers)} users` : undefined}
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-2 xl:grid-cols-3'>
        <SliceDonut title='Account status' description='Every account now, by its strongest restriction.' slices={b?.status} colors={STATUS_COLORS} loading={loading} error={q.error} />
        <SliceDonut title='KYC status' description='Identity verification, now.' slices={b?.kyc} colors={KYC_COLORS} loading={loading} error={q.error} />
        {showVip && b?.vip !== null && (
          <SliceBar title='VIP tiers' description='Accounts per tier, by lifetime wager.' slices={b?.vip ?? []} name='Users' color='chart-5' loading={loading} error={q.error} />
        )}
        <SliceBar title='Locks and holds' description='Accounts with each restriction on (one account can have several).' slices={b?.locks ?? []} name='Users' color='danger' horizontal loading={loading} error={q.error} />
        <SliceBar
          title='Verification and security'
          description='Share of users. The platform does not verify email or phone, so this is “on file”.'
          slices={(b?.security ?? []).map(x => ({ ...x, value: x.pct ?? 0 }))}
          name='Users'
          color='chart-3'
          format='percent'
          horizontal
          loading={loading}
          error={q.error}
        />

        <ChartCard
          className='lg:col-span-2 xl:col-span-3'
          title='Signups and active users'
          description={`Per ${f.granularity}. Active = signed in or placed a counted bet.`}
          table={seriesTable({ buckets: f.buckets, granularity: f.granularity, series: growth, format: 'number' })}
        >
          <TimeSeriesChart
            ariaLabel={`New signups and active users per ${f.granularity}`}
            buckets={f.buckets}
            granularity={f.granularity}
            series={growth}
            kind='line'
            format='number'
            loading={loading}
            error={q.error}
            emptyMessage='No signups or activity in this period.'
          />
        </ChartCard>

        <ChartCard
          className='lg:col-span-2 xl:col-span-3'
          title='Status changes'
          description={`Per ${f.granularity}, from the staff audit trail (locks, closures, KYC decisions).`}
          table={seriesTable({ buckets: f.buckets, granularity: f.granularity, series: changes, format: 'number' })}
        >
          <TimeSeriesChart
            ariaLabel={`Account locks, closures and KYC decisions per ${f.granularity}`}
            buckets={f.buckets}
            granularity={f.granularity}
            series={changes}
            kind='bar'
            stacked
            format='number'
            loading={loading}
            error={q.error}
            emptyMessage='No locks, closures or KYC decisions in this period.'
          />
        </ChartCard>
      </div>
    </section>
  )
}

const SliceDonut = ({
  title,
  description,
  slices,
  colors,
  loading,
  error,
  selected,
  onSelect
}: {
  title: string
  description: string
  slices: Slice[] | undefined
  colors: Record<string, ChartColor>
  loading: boolean
  error: unknown
  selected?: string
  onSelect?: (key: string) => void
}) => {
  const rows = slices ?? []
  const labels = rows.map(r => r.label)
  const values = rows.map(r => r.value)

  return (
    <ChartCard
      title={title}
      description={description}
      table={categoryTable({ categories: labels, series: [{ name: 'Users', data: values }], format: 'number' })}
      footer={
        onSelect && rows.length > 0 ? (
          <div role='group' aria-label={`Filter the users table by ${title.toLowerCase()}`} className='flex flex-wrap gap-2'>
            {rows.map(r => (
              <Button
                key={r.key}
                size='sm'
                variant={selected === r.key ? 'default' : 'outline'}
                aria-pressed={selected === r.key}
                onClick={() => onSelect(r.key)}
              >
                {r.label} · {formatNumber(r.value)}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    >
      <DonutChart
        ariaLabel={title}
        labels={labels}
        values={values}
        colors={colorsFor(rows, colors)}
        totalLabel='Users'
        format='number'
        loading={loading}
        error={error}
        emptyMessage='No users.'
      />
    </ChartCard>
  )
}

const SliceBar = ({
  title,
  description,
  slices,
  name,
  color,
  format = 'number',
  horizontal,
  loading,
  error
}: {
  title: string
  description: string
  slices: Slice[]
  name: string
  color: ChartColor
  format?: 'number' | 'percent'
  horizontal?: boolean
  loading: boolean
  error: unknown
}) => {
  const categories = slices.map(s => s.label)
  const series: ChartSeries[] = [{ name, data: slices.map(s => s.value), color }]

  return (
    <ChartCard title={title} description={description} table={categoryTable({ categories, series, format })}>
      <BarChart
        ariaLabel={title}
        categories={categories}
        series={series}
        horizontal={horizontal}
        format={format}
        loading={loading}
        error={error}
        emptyMessage='None.'
      />
    </ChartCard>
  )
}

export default UserStatusOverview
