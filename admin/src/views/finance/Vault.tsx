'use client'

import { useState } from 'react'

import Link from 'next/link'

import { ChartColumnIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import { useStatsFilters } from '@/components/shared/charts'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ErrorState from '@/components/shared/ErrorState'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { check } from '@/lib/validate'
import RewardStats from '@/views/promotions/RewardStats'

import type { VaultDepositRow, VaultInterestRow, VaultLockPeriod, VaultStats } from './types'

const BASE = 'admin/user/vault'
const PERIODS = `${BASE}/lock-periods`
const INVALIDATE = [['api', PERIODS]]

const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v))

const depositColumns: Column<VaultDepositRow>[] = [
  { key: 'id', header: 'Deposit', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'user', header: 'User', cell: r => (r.userid ? <Link href={`/users/${r.userid}`} className='font-mono text-xs hover:underline'>#{r.userid}</Link> : '—') },
  { key: 'coin', header: 'Coin', cell: r => <span className='text-sm'>{r.coin ?? '—'}</span> },
  { key: 'bal', header: 'Balance', align: 'right', cell: r => <Money value={str(r.vaultBalance)} currency={r.coin} /> },
  { key: 'period', header: 'Lock period', cell: r => <span className='text-sm'>{r.lock_period ?? '—'}</span> },
  { key: 'rate', header: 'Rate %', align: 'right', cell: r => <span className='font-mono tabular-nums'>{str(r.interest_rate) ?? '—'}</span> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'start', header: 'Started', cell: r => <DateTime value={str(r.startTime) ?? str(r.createdAt)} /> },
  { key: 'end', header: 'Unlocks', cell: r => <DateTime value={str(r.endTime)} relative /> }
]

const interestColumns: Column<VaultInterestRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'user', header: 'User', cell: r => (r.userid ? <Link href={`/users/${r.userid}`} className='font-mono text-xs hover:underline'>#{r.userid}</Link> : '—') },
  { key: 'dep', header: 'Deposit', cell: r => <span className='font-mono text-xs'>{str(r.deposit_id) ?? '—'}</span> },
  { key: 'coin', header: 'Coin', cell: r => <span className='text-sm'>{r.coin ?? '—'}</span> },
  { key: 'int', header: 'Interest', align: 'right', cell: r => <Money value={str(r.interest)} currency={r.coin} signed /> },
  { key: 'rate', header: 'Rate %', align: 'right', cell: r => <span className='font-mono tabular-nums'>{str(r.rate) ?? '—'}</span> },
  { key: 'at', header: 'Paid', cell: r => <DateTime value={str(r.createdAt)} /> }
]

/** Every coin's open deposits; each row carries its coin. */
const Deposits = () => {
  const { set, query } = useListState()
  const list = usePagedApi<VaultDepositRow>(`${BASE}/users`, { channel: 'direct', limit: query.limit, page: query.page })

  return (
    <DataTable
      columns={depositColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      emptyMessage='No open vault deposits.'
    />
  )
}

const Interest = () => {
  const { set, query } = useListState()
  const list = usePagedApi<VaultInterestRow>(`${BASE}/interest`, { channel: 'direct', limit: query.limit, page: query.page })

  return (
    <DataTable
      columns={interestColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      emptyMessage='No interest paid yet.'
    />
  )
}

/** vault.validators.js `rateString`: a decimal ≥ 0 with up to 4 places. */
const rateError = (v: string) => check.required(v, 'Rate') ?? (/^\d+(\.\d{1,4})?$/.test(v.trim()) ? undefined : 'Rate must be a number ≥ 0 with at most 4 decimal places')

const RATE_HINT = 'Annual percentage, e.g. 7.5 — applies to new deposits only'

const AddPeriod = () => {
  const [form, setForm] = useState({ lockPeriod: '', label: '', days: '', rate: '' })

  const add = useApiMutation({
    fn: () => api.post(PERIODS, { lockPeriod: form.lockPeriod.trim(), label: form.label.trim(), days: Number(form.days), rate: form.rate.trim() }),
    invalidate: INVALIDATE,
    success: 'Lock period added',
    onSuccess: () => setForm({ lockPeriod: '', label: '', days: '', rate: '' })
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> Add lock period
        </Button>
      }
      title='New lock period'
      submitLabel='Add'
      validate={() => ({
        lockPeriod: check.required(form.lockPeriod, 'Key') ?? check.length(form.lockPeriod, 'Key', { max: 50 }),
        label: check.required(form.label, 'Label') ?? check.length(form.label, 'Label', { max: 100 }),
        days: check.number(form.days, 'Days', { integer: true, min: 1, max: 3650 }),
        rate: rateError(form.rate)
      })}
      onSubmit={() => add.mutateAsync()}
    >
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='vp-key' name='lockPeriod' label='Key' required placeholder='3m' hint='Short identifier' value={form.lockPeriod} onChange={e => setForm({ ...form, lockPeriod: e.target.value })} />
        <TextField id='vp-label' name='label' label='Label' required placeholder='3 months' value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
      </div>
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='vp-days' name='days' label='Days' required inputMode='numeric' min={1} max={3650} type='number' value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} />
        <TextField id='vp-rate' name='rate' inputMode='decimal' label='Rate %' required placeholder='7.5' hint={RATE_HINT} value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} />
      </div>
    </FormDialog>
  )
}

const EditRate = ({ p }: { p: VaultLockPeriod }) => {
  const [rate, setRate] = useState(p.rate)

  const update = useApiMutation({
    fn: () => api.put(`${PERIODS}/rate`, { lockPeriod: p.value, rate: rate.trim() }),
    invalidate: INVALIDATE,
    success: `${p.label} rate updated`
  })

  return (
    <FormDialog
      trigger={
        <Button variant='ghost' size='sm'>
          <PencilIcon /> Rate
        </Button>
      }
      title={`${p.label} — rate`}
      description='Open deposits keep the rate they were opened at.'
      submitLabel='Save'
      validate={() => ({ rate: rateError(String(rate ?? '')) })}
      onSubmit={() => update.mutateAsync()}
    >
      <TextField id={`vr-${p.value}`} name='rate' inputMode='decimal' label='Rate %' required hint={RATE_HINT} value={rate} onChange={e => setRate(e.target.value)} />
    </FormDialog>
  )
}

const DeletePeriod = ({ p }: { p: VaultLockPeriod }) => {
  const remove = useApiMutation({
    fn: () => api.delete(PERIODS, { lockPeriod: p.value }),
    invalidate: INVALIDATE,
    success: `${p.label} removed`
  })

  return (
    <ConfirmDialog
      trigger={
        <Button variant='ghost' size='sm' className='text-destructive'>
          <Trash2Icon />
        </Button>
      }
      title={`Remove "${p.label}"?`}
      description='Refused while any deposit is still open on this term. Closed deposits keep referencing it.'
      confirmLabel='Remove'
      destructive
      onConfirm={() => remove.mutateAsync()}
    />
  )
}

const periodColumns: Column<VaultLockPeriod>[] = [
  { key: 'key', header: 'Key', cell: p => <span className='font-mono text-xs'>{p.value}</span> },
  { key: 'label', header: 'Label', cell: p => <span className='font-medium'>{p.label}</span> },
  { key: 'days', header: 'Days', align: 'right', cell: p => formatNumber(p.days) },
  { key: 'rate', header: 'Rate %', align: 'right', cell: p => <span className='font-mono tabular-nums'>{p.rate}</span> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: p => (
      <Can permission='config:write'>
        <div className='flex justify-end gap-1'>
          <EditRate p={p} />
          <DeletePeriod p={p} />
        </div>
      </Can>
    )
  }
]

const Periods = () => {
  const q = useApi<VaultLockPeriod[]>(PERIODS)

  return <DataTable columns={periodColumns} rows={q.data} rowKey={p => p.value} loading={q.isLoading} error={q.error} dense emptyMessage='No lock periods configured — users cannot open a vault deposit.' />
}

const Vault = () => {
  const stats = useApi<VaultStats>(`${BASE}/stats`)
  const data = stats.data && !Array.isArray(stats.data) && typeof stats.data === 'object' ? stats.data : undefined
  const allRows = Array.isArray(data?.byCoin) ? data.byCoin : []
  const users = Number(data?.totalUsers ?? 0) || 0

  // The Stats tab's period; every coin, charts valued in the site's default coin.
  const f = useStatsFilters({ defaultPreset: '30d' })

  return (
    <div>
      <PageHeader
        title='Vault'
        description='Locked savings: users lock a coin for a term and earn the rate that applied when they opened it.'
        actions={
          <Can permission='config:write'>
            <AddPeriod />
          </Can>
        }
      />
      {stats.error ? (
        <div className='mb-4'>
          <ErrorState error={stats.error} title='Could not load vault stats' />
        </div>
      ) : null}
      {/* Lists pehle, cards + charts alag "Stats" tab me (Deposit / Withdraw screens jaisa). */}
      <Tabs defaultValue='deposits'>
        <TabsList className='mb-4'>
          <TabsTrigger value='deposits'>Deposits</TabsTrigger>
          <TabsTrigger value='interest'>Interest history</TabsTrigger>
          <TabsTrigger value='periods'>Lock periods</TabsTrigger>
          <TabsTrigger value='stats'>
            <ChartColumnIcon /> Stats
          </TabsTrigger>
        </TabsList>
        <TabsContent value='deposits'>
          <Deposits />
        </TabsContent>
        <TabsContent value='interest'>
          <Interest />
        </TabsContent>
        <TabsContent value='periods'>
          <Periods />
        </TabsContent>
        <TabsContent value='stats'>
          <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
            <StatCard label='Users in vault' value={formatNumber(users)} loading={stats.isLoading} hint={`${allRows.length} coin${allRows.length === 1 ? '' : 's'} · all coins`} />
            {allRows.slice(0, 2).map(r => (
              <StatCard key={r.coin} label={`${r.coin} locked`} value={<Money value={r.totalBalance} currency={r.coin} />} loading={stats.isLoading} />
            ))}
            {!stats.isLoading && allRows.length === 0 && <StatCard label='Locked balance' value='—' hint='No open deposits' />}
            <StatCard label='Interest paid today' value={formatNumber(Number(data?.todayInterest ?? 0) || 0)} loading={stats.isLoading} hint='All coins, credited today' />
          </div>
          <RewardStats section='vault' filters={f} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default Vault
