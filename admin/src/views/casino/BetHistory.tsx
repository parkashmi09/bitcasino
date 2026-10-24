'use client'

import { useState } from 'react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { ChartCard, TimeSeriesChart, seriesTable } from '@/components/shared/charts'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useListState } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'
import type { CasinoStats, CasinoTxn } from './types'
import { usePageList } from './usePageList'
import { casinoSourceLabel } from '@/lib/casinoSource'

const ALL = '__all__'

const SOURCES = [
  { value: 'gis', label: casinoSourceLabel('gis') },
  { value: 'jsgames', label: casinoSourceLabel('jsgames') }
]

const txnColumns: Column<CasinoTxn>[] = [
  { key: 'at', header: 'Time', cell: r => <DateTime value={r.transaction_timestamp} /> },
  {
    key: 'user',
    header: 'User',
    cell: r => (
      <div>
        <div>{r.user_name ?? '—'}</div>
        <div className='text-muted-foreground font-mono text-xs'>#{r.user_id}</div>
      </div>
    )
  },
  {
    key: 'game',
    header: 'Game',
    cell: r => (
      <div>
        <div>{r.game_title ?? '—'}</div>
        <div className='text-muted-foreground text-xs'>{casinoSourceLabel(r.source)}</div>
      </div>
    )
  },
  { key: 'type', header: 'Type', cell: r => <Badge variant='outline'>{r.transaction_type}</Badge> },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.currency_code} /> },
  { key: 'profit', header: 'Profit', align: 'right', cell: r => <Money value={r.profit} signed /> },
  { key: 'outcome', header: 'Result', cell: r => <StatusBadge value={r.outcome} /> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.transaction_status} /> },
  {
    key: 'ref',
    header: 'Round / ref',
    cell: r => (
      <div className='font-mono text-xs'>
        <div>{r.round_id}</div>
        <div className='text-muted-foreground'>{r.transaction_id}</div>
      </div>
    )
  }
]

const DateRange = ({ state, set }: { state: Record<string, string | number>; set: (p: Record<string, string | number | null>) => void }) => (
  <DateRangePicker aria-label='Date range' from={String(state.from ?? '')} to={String(state.to ?? '')} onChange={set} />
)

const TransactionsTab = ({ channel }: { channel: Channel }) => {
  const { state, set } = useListState(['userId', 'source', 'from', 'to'])

  const list = usePageList<CasinoTxn>('admin/casino/bet-history/transactions', {
    limit: state.limit,
    page: state.page,
    search: state.search || undefined,
    userId: state.userId || undefined,
    source: state.source && state.source !== ALL ? state.source : undefined,
    from: state.from || undefined,
    to: state.to || undefined,
    channel
  })

  return (
    <DataTable
      columns={txnColumns}
      rows={list.data?.rows}
      rowKey={(r, i) => `${r.source_key}-${r.id ?? r.transaction_id}-${i}`}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      search={String(state.search ?? '')}
      onSearchChange={search => set({ search })}
      searchPlaceholder='Transaction reference…'
      dense
      toolbar={
        <>
          <Input placeholder='User id' className='w-28' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value })} />
          <Select value={String(state.source || ALL)} onValueChange={v => v && set({ source: v })}>
            <SelectTrigger className='w-40'>
              <SelectValue>{(v: string) => (v === ALL ? 'All sources' : (SOURCES.find(s => s.value === v)?.label ?? v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sources</SelectItem>
              {SOURCES.map(s => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRange state={state} set={set} />
        </>
      }
    />
  )
}

type UsdtFigures = { bets: number; wagered: string; payouts: string; ggr: string }
type UsdtStats = { totals: UsdtFigures; days: (UsdtFigures & { day: string })[]; unconverted: string[] }

/** Every wallet valued in USDT at the site's current rates, with one bar group per day. */
const StatsTab = ({ channel }: { channel: Channel }) => {
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const stats = useApi<CasinoStats & { usdt?: UsdtStats }>('admin/casino/bet-history/stats', { userId: userId || undefined, from: from || undefined, to: to || undefined, channel })

  const u = stats.data?.usdt
  const t = u?.totals
  const days = u?.days ?? []
  const buckets = days.map(d => d.day)

  const series = [
    { name: 'Wagered', data: days.map(d => Number(d.wagered)), color: 'primary' as const },
    { name: 'Paid out', data: days.map(d => Number(d.payouts)), color: 'warning' as const },
    { name: 'GGR', data: days.map(d => Number(d.ggr)), color: 'success' as const }
  ]

  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input placeholder='User id (optional)' className='w-40' value={userId} onChange={e => setUserId(e.target.value)} />
        <DateRangePicker aria-label='Date range' from={from} to={to} onChange={r => { setFrom(r.from); setTo(r.to) }} />
      </div>
      {stats.error && <ErrorState error={stats.error} />}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Bets' value={formatNumber(t?.bets)} loading={stats.isLoading} />
        <StatCard label='Wagered' value={<Money value={t?.wagered} currency='USDT' />} loading={stats.isLoading} />
        <StatCard label='Paid out' value={<Money value={t?.payouts} currency='USDT' />} loading={stats.isLoading} />
        <StatCard label='GGR' value={<Money value={t?.ggr} currency='USDT' signed />} loading={stats.isLoading} hint='Wagered minus payouts' />
      </div>
      <ChartCard
        title='Casino by day'
        description={`Wagered, paid out and GGR per day, USDT at current rates${u?.unconverted.length ? ` (not counted, no rate: ${u.unconverted.join(', ')})` : ''}`}
        table={seriesTable({ buckets, granularity: 'day', series, format: 'money', currency: 'USDT' })}
      >
        <TimeSeriesChart
          ariaLabel='Casino wagered, paid out and GGR per day, USDT'
          buckets={buckets}
          granularity='day'
          series={series}
          kind='bar'
          format='money'
          currency='USDT'
          loading={stats.isLoading}
          error={stats.error}
          emptyMessage='No casino bets in this period.'
        />
      </ChartCard>
    </div>
  )
}

const BetHistory = () => {
  const { actor } = useSession()

  // A super admin (level 1) sees every user on the site; everyone below sees their own tree.
  const scope = actor?.level === 1 ? 'for every user on the site' : 'scoped to the users under your staff tree'

  return (
    <div>
      <PageHeader title='Casino bet history' description={`Every third-party casino movement (Originals are not casino), ${scope}.`} />
      {/* Direct Users / Agent Users: har tab ki listing aur numbers us taraf ke players ke. */}
      <ChannelTabs>
        {channel => (
      <Tabs defaultValue='txns'>
        <TabsList className='mb-4 flex-wrap'>
          <TabsTrigger value='txns'>Transactions</TabsTrigger>
          <TabsTrigger value='stats'>Stats</TabsTrigger>
        </TabsList>
        <TabsContent value='txns'>
          <TransactionsTab channel={channel} />
        </TabsContent>
        <TabsContent value='stats'>
          <StatsTab channel={channel} />
        </TabsContent>
      </Tabs>
        )}
      </ChannelTabs>
    </div>
  )
}

export default BetHistory
