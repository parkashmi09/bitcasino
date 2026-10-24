'use client'

import { useState } from 'react'

import Link from 'next/link'

import { parseAsString, useQueryState } from 'nuqs'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSession } from '@/contexts/SessionContext'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'

/** `GET admin/user/swap/history` — raw `swap_history` rows (snake_case, decimals as strings). */
type SwapRow = {
  id: string | number
  uid: string | number
  from_currency: string
  to_currency: string
  from_amount: string
  to_amount: string
  fee_percentage: string
  fee_amount: string
  fee_currency: string
  usd_rate_from: string
  usd_rate_to: string
  created_at: string
}

const LIST = 'admin/user/swap/history'

/** `GET admin/user/swap/summary` — the fees earned, in USDT (each at its own swap's rate). */
type SwapSummary = { swaps: number; feeUsdt: string; todayUsdt: string; monthUsdt: string }

/** One fee in USDT: the fee times the USD rate that swap used (USDT is 1 USD). */
const feeUsdt = (r: SwapRow) => String(Number(r.fee_amount) * Number(r.usd_rate_from || 0))

/** `GET admin/user/swap/fee-history` — one row per day. */
type FeeDay = { day: string; swaps: number; feeUsdt: string; volumeUsdt: string; fees: { currency: string; amount: string }[] }

const feeDayColumns: Column<FeeDay>[] = [
  { key: 'day', header: 'Day', cell: d => <span className='font-mono text-sm'>{d.day}</span> },
  { key: 'swaps', header: 'Swaps', align: 'right', cell: d => formatNumber(d.swaps) },
  { key: 'volume', header: 'Swapped (USDT)', align: 'right', cell: d => <Money value={d.volumeUsdt} currency='USDT' /> },
  {
    key: 'coins',
    header: 'Fee taken',
    cell: d => (
      <span className='flex flex-wrap gap-x-3'>
        {d.fees.map(f => (
          <Money key={f.currency} value={f.amount} currency={f.currency} />
        ))}
      </span>
    )
  },
  { key: 'fee', header: 'Profit (USDT)', align: 'right', cell: d => <span className='font-medium'><Money value={d.feeUsdt} currency='USDT' /></span> }
]

/** Fee profit, day by day: what was swapped, the fee in each coin, and its USDT value. */
const FeeHistory = ({ userId }: { userId?: string }) => {
  const { set, query } = useListState()
  const list = usePagedApi<FeeDay>('admin/user/swap/fee-history', { channel: 'direct', limit: query.limit, page: query.page, userId })

  return (
    <DataTable
      columns={feeDayColumns}
      rows={list.data?.rows}
      rowKey={d => d.day}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      emptyMessage='No swap fees yet.'
    />
  )
}

const columns: Column<SwapRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'at', header: 'When', cell: r => <DateTime value={r.created_at} /> },
  {
    key: 'player',
    header: 'User',
    cell: r => (
      <Link href={`/users/${r.uid}`} className='font-mono text-sm hover:underline' onClick={e => e.stopPropagation()}>
        #{r.uid}
      </Link>
    )
  },
  { key: 'from', header: 'From', align: 'right', cell: r => <Money value={r.from_amount} currency={r.from_currency} /> },
  { key: 'to', header: 'To', align: 'right', cell: r => <Money value={r.to_amount} currency={r.to_currency} /> },
  {
    key: 'rate',
    header: 'Rate',
    cell: r => (
      <span className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
        1 {r.from_currency} = {Number(r.usd_rate_to) ? +(Number(r.usd_rate_from) / Number(r.usd_rate_to)).toPrecision(6) : '—'} {r.to_currency}
      </span>
    )
  },
  { key: 'value', header: 'Value (USDT)', align: 'right', cell: r => <Money value={String(Number(r.from_amount) * Number(r.usd_rate_from || 0))} currency='USDT' /> }
]

/** The fee history: one row per swap's fee, kept apart from the swaps table. */
const feeColumns: Column<SwapRow>[] = [
  ...columns.slice(0, 3),
  {
    key: 'swap',
    header: 'Swap',
    cell: r => <span className='text-muted-foreground text-xs whitespace-nowrap'>{r.from_currency} → {r.to_currency}</span>
  },
  { key: 'fee', header: 'Fee', align: 'right', cell: r => <Money value={r.fee_amount} currency={r.fee_currency} /> },
  { key: 'pct', header: 'Fee %', align: 'right', cell: r => <span className='tabular-nums'>{(Number(r.fee_percentage) * 100).toFixed(2)}%</span> },
  { key: 'feeUsdt', header: 'Fee (USDT)', align: 'right', cell: r => <span className='font-medium'><Money value={feeUsdt(r)} currency='USDT' /></span> }
]

const FEE = 'admin/user/swap/fee'

/** The swap fee every direct user pays from now on, in %; only the Super Admin (config:write) changes it. */
const SwapFee = () => {
  const { can, actor } = useSession()
  const canEdit = actor?.direct === true && can('config:write')
  const current = useApi<{ fee: string }>(FEE)
  const percent = current.data ? +(Number(current.data.fee) * 100).toFixed(2) : null
  const [draft, setDraft] = useState('')
  const value = Number(draft)
  const valid = draft !== '' && value >= 0 && value <= 50

  const save = useApiMutation({
    fn: (p: number) => api.put(FEE, { fee: (p / 100).toFixed(4) }),
    invalidate: [['api', FEE]],
    success: (_r, p) => `Swap fee set to ${p}%`,
    onSuccess: () => setDraft('')
  })

  return (
    <Card className='mb-4 py-4 shadow-none'>
      <CardContent className='flex flex-wrap items-center gap-3'>
        <div className='mr-auto'>
          <div className='font-medium'>Swap fee: {percent === null ? '…' : `${percent}%`}</div>
          <div className='text-muted-foreground text-xs'>Taken from every swap a direct user makes, in the coin swapped out. Past swaps keep their fee.</div>
        </div>
        {canEdit && (
          <>
            <Input
              aria-label='New swap fee in percent'
              inputMode='decimal'
              placeholder='e.g. 1.5'
              value={draft}
              onChange={e => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
              className='w-24'
            />
            <span className='text-muted-foreground text-sm'>%</span>
            <Button size='sm' disabled={!valid || save.isPending} onClick={() => save.mutate(value)}>
              Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

const SwapHistory = () => {
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('swaps').withOptions({ history: 'replace', scroll: false }))
  const { state, set, query } = useListState(['userId'])

  // Every currency's swaps; each row names its coins.
  const list = usePagedApi<SwapRow>(LIST, { channel: 'direct', limit: query.limit, page: query.page, userId: query.userId })

  // The earnings strip: every direct user's swap fees (or the one user typed in), in USDT.
  const summary = useApi<SwapSummary>('admin/user/swap/summary', { channel: 'direct', userId: query.userId })
  const s = summary.data

  return (
    <div>
      <PageHeader title='Swap history' description='Currency swaps direct users made in the wallet, newest first, with the fee taken.' />
      <SwapFee />
      <div className='mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard label='Fee earned' value={<Money value={s?.feeUsdt ?? '0'} currency='USDT' />} hint='all swaps, in USDT' loading={summary.isLoading} />
        <StatCard label='This month' value={<Money value={s?.monthUsdt ?? '0'} currency='USDT' />} hint='fees since the 1st' loading={summary.isLoading} />
        <StatCard label='Today' value={<Money value={s?.todayUsdt ?? '0'} currency='USDT' />} hint='fees since midnight' loading={summary.isLoading} />
        <StatCard label='Swaps' value={formatNumber(s?.swaps ?? 0)} hint={query.userId ? `user #${query.userId}` : 'by direct users'} loading={summary.isLoading} />
      </div>
      <Tabs value={tab} onValueChange={v => setTab(String(v))}>
        <TabsList variant='line' className='mb-4'>
          <TabsTrigger value='swaps'>Swaps</TabsTrigger>
          <TabsTrigger value='fees'>Fee history</TabsTrigger>
          <TabsTrigger value='profit'>Fee profit by day</TabsTrigger>
        </TabsList>
        <TabsContent value='profit'>{tab === 'profit' && <FeeHistory userId={query.userId ? String(query.userId) : undefined} />}</TabsContent>
        <TabsContent value={tab === 'fees' ? 'fees' : 'swaps'}>
      {tab !== 'profit' && <DataTable
        columns={tab === 'fees' ? feeColumns : columns}
        rows={list.data?.rows}
        rowKey={r => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        emptyMessage='No swaps yet.'
        toolbar={
          <>
          <Input
            placeholder='User id'
            aria-label='User id'
            inputMode='numeric'
            value={String(state.userId ?? '')}
            onChange={e => set({ userId: e.target.value.replace(/\D/g, '') })}
            className='w-28'
          />
          </>
        }
      />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default SwapHistory
