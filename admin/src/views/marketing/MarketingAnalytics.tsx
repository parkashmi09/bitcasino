'use client'

import { useMemo, useState } from 'react'

import Link from 'next/link'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useListState, usePagedApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'
import { CUSTOMER_CHANNELS, CUSTOMER_SORTS, RANGE_PRESETS, type Customer, type Deposits, type Retention, type Signups, type TopAgent, type TopAgents } from './types'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

const rangeFor = (days: number) => {
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86_400_000)

  return { from: isoDay(from), to: isoDay(to) }
}

/** A small table over a daily series whose columns are whatever the platform sent. */
const SeriesTable = ({ rows, title }: { rows: Record<string, unknown>[] | undefined; title: string }) => {
  const keys = rows?.length ? Object.keys(rows[0]) : []
  const last = rows?.slice(-14) ?? []

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows?.length ? (
          <p className='text-muted-foreground text-sm'>No data in this range.</p>
        ) : (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  {keys.map(k => (
                    <TableHead key={k} className='capitalize'>
                      {k.replace(/([A-Z])/g, ' $1')}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {last.map((r, i) => (
                  <TableRow key={String(r.date ?? i)}>
                    {keys.map(k => (
                      <TableCell key={k} className='tabular-nums'>
                        {String(r[k] ?? '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length > 14 && <p className='text-muted-foreground mt-2 text-xs'>Last 14 of {rows.length} days.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const agentColumns: Column<TopAgent>[] = [
  { key: 'n', header: '#', cell: (_r, i) => <span className='text-muted-foreground'>{i + 1}</span> },
  { key: 'agent', header: 'Agent', cell: r => <span className='font-medium'>{r.agentName}</span> },
  { key: 'code', header: 'Code', cell: r => <code className='text-xs'>{r.agentCode ?? '—'}</code> },
  { key: 'role', header: 'Role', cell: r => <Badge variant='secondary'>{r.role ?? '—'}</Badge> },
  { key: 'customers', header: 'Customers', align: 'right', cell: r => formatNumber(r.customers) },
  { key: 'deposits', header: 'Deposits', align: 'right', cell: r => formatNumber(r.depositCount) },
  { key: 'volume', header: 'Volume (USD)', align: 'right', cell: r => <Money value={r.lifetimeDepositVolume} /> }
]

const Analytics = ({ range }: { range: { from: string; to: string } }) => {
  const signups = useApi<Signups>('admin/marketing/analytics/signups', range)
  const deposits = useApi<Deposits>('admin/marketing/analytics/deposits', range)
  const retention = useApi<Retention>('admin/marketing/analytics/retention', range)
  const top = useApi<TopAgents>('admin/marketing/analytics/top-agents', { ...range, limit: 10 })
  const firstError = signups.error ?? deposits.error ?? retention.error ?? top.error

  const d = deposits.data
  const conv = d ? d.byChannel.online.cohortSize + d.byChannel.agent.cohortSize : 0
  const converted = d ? d.byChannel.online.converted + d.byChannel.agent.converted : 0

  return (
    <div className='grid gap-4'>
      {firstError && <ErrorState error={firstError} title='Marketing analytics unavailable' />}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='New customers' value={formatNumber(signups.data?.total)} hint={signups.data && <>online {formatNumber(signups.data.byChannel.online)} · agent {formatNumber(signups.data.byChannel.agent)}</>} loading={signups.isLoading} />
        <StatCard label='Deposit volume (USD)' value={<Money value={d?.totals.volume} />} hint={d && <>{formatNumber(d.totals.count)} deposits</>} loading={deposits.isLoading} />
        <StatCard label='Average deposit' value={<Money value={d?.totals.average} />} loading={deposits.isLoading} />
        <StatCard label='Deposit conversion' value={conv ? `${((converted / conv) * 100).toFixed(1)}%` : '—'} hint={d && <>{formatNumber(converted)} of {formatNumber(conv)} in cohort</>} loading={deposits.isLoading} />
      </div>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Depositors · online' value={formatNumber(retention.data?.byChannel.online.depositors)} hint={retention.data && <>repeat rate {retention.data.byChannel.online.repeatRate}%</>} loading={retention.isLoading} />
        <StatCard label='Depositors · agent' value={formatNumber(retention.data?.byChannel.agent.depositors)} hint={retention.data && <>repeat rate {retention.data.byChannel.agent.repeatRate}%</>} loading={retention.isLoading} />
        <StatCard label='Conversion · online' value={d ? `${d.byChannel.online.conversionRate}%` : '—'} hint={d && <Money value={d.byChannel.online.volume} />} loading={deposits.isLoading} />
        <StatCard label='Conversion · agent' value={d ? `${d.byChannel.agent.conversionRate}%` : '—'} hint={d && <Money value={d.byChannel.agent.volume} />} loading={deposits.isLoading} />
      </div>
      <div className='grid gap-4 xl:grid-cols-2'>
        <SeriesTable title='Signups by day' rows={signups.data?.series} />
        <SeriesTable title='Deposits by day (USD)' rows={deposits.data?.series} />
        <SeriesTable title='Active depositors by day' rows={retention.data?.series} />
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='text-base'>Top agents</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <DataTable columns={agentColumns} rows={top.data?.agents} rowKey={r => r.agentId} loading={top.isLoading} error={top.error} dense className='border-0' />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const customerColumns: Column<Customer>[] = [
  {
    key: 'customer',
    header: 'Customer',
    cell: r => (
      <div className='flex flex-col'>
        <Link href={`/users/${r.id}`} className='font-medium hover:underline'>
          {r.name ?? `#${r.id}`}
        </Link>
        <span className='text-muted-foreground font-mono text-xs'>#{r.id}</span>
      </div>
    )
  },
  { key: 'contact', header: 'Contact', cell: r => <div className='flex flex-col text-xs'><span>{r.email ?? '—'}</span><span className='text-muted-foreground'>{r.phone ?? ''}</span></div> },
  { key: 'loc', header: 'Location', cell: r => <div className='flex flex-col text-xs'><span>{r.country ?? '—'}</span><span className='text-muted-foreground font-mono'>{r.lastIp ?? ''}</span></div> },
  { key: 'agent', header: 'Agent', cell: r => (r.agent ? <span>{r.agent.name}{r.agent.code ? <span className='text-muted-foreground'> · {r.agent.code}</span> : null}</span> : <Badge variant='outline'>direct</Badge>) },
  { key: 'signed', header: 'Signed up', cell: r => <span>{r.createdEstimated ? <span className='text-muted-foreground'>≈ </span> : null}<DateTime value={r.createdAt} /></span> },
  { key: 'login', header: 'Last login', cell: r => <DateTime value={r.lastLoginAt} relative /> },
  { key: 'deposits', header: 'Deposits', align: 'right', cell: r => <span className='flex flex-col items-end'><Money value={r.depositVolume} /><span className='text-muted-foreground text-xs'>{formatNumber(r.depositCount)} txns</span></span> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> }
]

const Customers = ({ range }: { range: { from: string; to: string } }) => {
  const { state, set, query } = useListState(['channel', 'sort', 'depositors', 'newOnly'])

  const list = usePagedApi<Customer>('admin/marketing/customers', {
    limit: query.limit,
    page: query.page,
    search: query.search,
    channel: query.channel,
    sort: query.sort,
    depositors: state.depositors === '1' ? 'true' : undefined,
    newOnly: state.newOnly === '1' ? 'true' : undefined,
    ...range
  })

  return (
    <DataTable
      columns={customerColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      search={String(state.search ?? '')}
      onSearchChange={search => set({ search })}
      searchPlaceholder='Name, email, phone…'
      toolbar={
        <>
          <Select value={String(state.channel || 'all')} onValueChange={v => v && set({ channel: v === 'all' ? '' : v })}>
            <SelectTrigger className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_CHANNELS.map(c => (
                <SelectItem key={c} value={c}>
                  {c === 'all' ? 'Any channel' : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(state.sort || 'recent')} onValueChange={v => v && set({ sort: v === 'recent' ? '' : v })}>
            <SelectTrigger className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_SORTS.map(s => (
                <SelectItem key={s} value={s}>
                  Sort: {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={state.depositors === '1'} onCheckedChange={c => set({ depositors: c ? '1' : '' })} /> Depositors only
          </label>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={state.newOnly === '1'} onCheckedChange={c => set({ newOnly: c ? '1' : '' })} /> New in range
          </label>
        </>
      }
    />
  )
}

const MarketingAnalytics = () => {
  const [days, setDays] = useState<number>(30)
  const range = useMemo(() => rangeFor(days), [days])
  const { actor, loading } = useSession()
  const allowed = actor?.marketing === true

  return (
    <div>
      <PageHeader
        title='Marketing'
        description='Signups, deposits and retention by channel, and the customer list. The platform serves these only to a marketing sub-login (a plain staff session is refused).'
        actions={
          <div className='flex gap-1'>
            {RANGE_PRESETS.map(p => (
              <Button key={p} size='sm' variant={days === p ? 'default' : 'outline'} onClick={() => setDays(p)}>
                {p}d
              </Button>
            ))}
          </div>
        }
      />
      {loading ? null : !allowed ? (
        <ErrorState title='Marketing account required' error={new Error('This panel is served only to a marketing sub-login. Sign in with a marketing account to see it.')} />
      ) : (
        <Tabs defaultValue='analytics'>
          <TabsList className='mb-4'>
            <TabsTrigger value='analytics'>Analytics</TabsTrigger>
            <TabsTrigger value='customers'>Customers</TabsTrigger>
          </TabsList>
          <TabsContent value='analytics'>
            <Analytics range={range} />
          </TabsContent>
          <TabsContent value='customers'>
            <Customers range={range} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

export default MarketingAnalytics
