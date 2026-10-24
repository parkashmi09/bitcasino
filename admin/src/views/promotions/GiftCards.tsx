'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PlusIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { DateField, SwitchField, TextAreaField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { check } from '@/lib/validate'
import type { GiftCard, GiftCardAnalytics, GiftCardRecord } from './types'
import { useLocalList } from './useLocalList'

const INVALIDATE = [
  ['paged', 'admin/user/gift-cards'],
  ['paged', 'admin/user/gift-cards/records'],
  ['api', 'admin/user/gift-cards/analytics']
]

const EMPTY = {
  uniqueKey: '',
  description: '',
  amount: '',
  periodDays: '',
  endDate: '',
  depositRequired: false,
  depositAmount: '',
  wagerRequired: false,
  wagerTimes: '',
  allUsers: true,
  isActive: true
}

const CreateCard = () => {
  const [f, setF] = useState(EMPTY)

  const create = useApiMutation({
    fn: () => {
      const body: Record<string, string | number | boolean> = {
        uniqueKey: f.uniqueKey.trim(),
        amount: f.amount,
        depositRequired: f.depositRequired,
        wagerRequired: f.wagerRequired,
        allUsers: f.allUsers,
        isActive: f.isActive
      }

      if (f.description) body.description = f.description
      if (f.periodDays) body.periodDays = Number(f.periodDays)
      if (f.endDate) body.endDate = f.endDate
      if (f.depositRequired && f.depositAmount) body.depositAmount = f.depositAmount
      if (f.wagerRequired && f.wagerTimes) body.wagerTimes = Number(f.wagerTimes)

      return api.post('admin/user/gift-cards', body)
    },
    invalidate: INVALIDATE,
    success: 'Gift card created',
    onSuccess: () => setF(EMPTY)
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> New gift card
        </Button>
      }
      title='Create a gift card'
      description='A promise to pay every eligible user a fixed amount once they meet the conditions. Amounts are USDT.'
      submitLabel='Create'
      onSubmit={() => create.mutateAsync()}
      validate={() => ({
        'gc-key': check.required(f.uniqueKey, 'Code') || check.length(f.uniqueKey, 'Code', { max: 80 }),
        'gc-amount': check.amount(f.amount),
        'gc-desc': check.length(f.description, 'Description', { max: 500 }),
        'gc-period': check.number(f.periodDays, 'Window', { integer: true, min: 1, max: 3650, optional: true }),
        'gc-end': f.endDate && new Date(f.endDate).getTime() < new Date(new Date().toDateString()).getTime() ? 'End date cannot be in the past' : undefined,
        'gc-dep-amt': f.depositRequired ? check.amount(f.depositAmount, 'Deposit amount') : undefined,
        'gc-wag-x': f.wagerRequired ? check.number(f.wagerTimes, 'Wager multiple', { integer: true, min: 0, max: 10000 }) : undefined
      })}
      wide
    >
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='gc-key' name='uniqueKey' label='Code' required maxLength={80} placeholder='WELCOME50' value={f.uniqueKey} onChange={e => setF({ ...f, uniqueKey: e.target.value })} />
        <TextField id='gc-amount' name='amount' label='Amount' required placeholder='50.00' value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
      </div>
      <TextAreaField id='gc-desc' label='Description' maxLength={500} rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='gc-period' name='periodDays' label='Window (days)' type='number' min={1} max={3650} hint='How long after activation the conditions stay open.' value={f.periodDays} onChange={e => setF({ ...f, periodDays: e.target.value })} />
        <DateField id='gc-end' label='End date' hint='Last day the card can be activated.' value={f.endDate} onChange={endDate => setF({ ...f, endDate })} />
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='grid gap-3'>
          <SwitchField id='gc-dep' label='Deposit required' checked={f.depositRequired} onChange={depositRequired => setF({ ...f, depositRequired })} />
          {f.depositRequired && <TextField id='gc-dep-amt' name='depositAmount' label='Deposit amount' required placeholder='100.00' value={f.depositAmount} onChange={e => setF({ ...f, depositAmount: e.target.value })} />}
        </div>
        <div className='grid gap-3'>
          <SwitchField id='gc-wag' label='Wager required' checked={f.wagerRequired} onChange={wagerRequired => setF({ ...f, wagerRequired })} />
          {f.wagerRequired && <TextField id='gc-wag-x' name='wagerTimes' label='Wager × amount' type='number' min={0} max={10000} required value={f.wagerTimes} onChange={e => setF({ ...f, wagerTimes: e.target.value })} />}
        </div>
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <SwitchField id='gc-all' label='Visible to all users' hint='Off: only users the platform targets explicitly.' checked={f.allUsers} onChange={allUsers => setF({ ...f, allUsers })} />
        <SwitchField id='gc-active' label='Active' checked={f.isActive} onChange={isActive => setF({ ...f, isActive })} />
      </div>
    </FormDialog>
  )
}

const Cards = () => {
  const { state, set, query } = useListState(['activeOnly'])

  const list = usePagedApi<GiftCard>('admin/user/gift-cards', {
    limit: query.limit,
    page: query.page,
    search: state.search || undefined,
    activeOnly: state.activeOnly === '1' ? true : undefined
  })

  const remove = useApiMutation<number>({
    fn: id => api.delete(`admin/user/gift-cards/${id}`),
    invalidate: INVALIDATE,
    success: 'Gift card deleted'
  })

  const columns: Column<GiftCard>[] = [
    {
      key: 'key',
      header: 'Code',
      cell: r => (
        <div className='flex flex-col'>
          <span className='font-mono text-sm font-medium'>{r.uniqueKey}</span>
          {r.description && <span className='text-muted-foreground line-clamp-1 max-w-xs text-xs'>{r.description}</span>}
        </div>
      )
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
    { key: 'period', header: 'Window', cell: r => (r.periodDays ? `${r.periodDays} d` : '—') },
    { key: 'end', header: 'Ends', cell: r => <DateTime value={r.endDate} /> },
    { key: 'dep', header: 'Deposit cond.', cell: r => (r.depositRequired ? <Money value={r.depositAmount} /> : <span className='text-muted-foreground'>none</span>) },
    { key: 'wag', header: 'Wager cond.', cell: r => (r.wagerRequired ? `${r.wagerTimes ?? 0}×` : <span className='text-muted-foreground'>none</span>) },
    { key: 'users', header: 'Audience', cell: r => <Badge variant='outline'>{r.allUsers ? 'All users' : 'Targeted'}</Badge> },
    { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.isActive ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <Can permission='config:write'>
          <ConfirmDialog
            trigger={<Button variant='ghost' size='icon-sm' aria-label='Delete'><Trash2Icon /></Button>}
            title={`Delete ${r.uniqueKey}?`}
            description='Refused by the platform once any user has activated it.'
            confirmLabel='Delete'
            destructive
            onConfirm={() => remove.mutateAsync(r.id)}
          />
        </Can>
      )
    }
  ]

  return (
    <DataTable
      columns={columns}
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
      searchPlaceholder='Code…'
      emptyMessage='No gift cards yet.'
      toolbar={
        <Select value={state.activeOnly === '1' ? '1' : 'all'} onValueChange={v => v && set({ activeOnly: v === '1' ? '1' : '' })}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All cards</SelectItem>
            <SelectItem value='1'>Active only</SelectItem>
          </SelectContent>
        </Select>
      }
    />
  )
}

const Records = () => {
  const { page, limit, set } = useLocalList()
  const [status, setStatus] = useState('all')
  const [userId, setUserId] = useState('')

  const list = usePagedApi<GiftCardRecord>('admin/user/gift-cards/records', {
    // Agent ke users ye use nahi kar sakte — sirf direct users.
    channel: 'direct',
    limit,
    page,
    status: status === 'all' ? undefined : status,
    userId: userId || undefined
  })

  const columns: Column<GiftCardRecord>[] = [
    { key: 'id', header: '#', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
    {
      key: 'user',
      header: 'User',
      cell: r => (
        <Link href={`/users/${r.userId}`} className='font-mono text-xs hover:underline'>
          #{String(r.userId)}
        </Link>
      )
    },
    { key: 'card', header: 'Gift code', cell: r => <span className='font-mono text-sm'>{r.card?.uniqueKey ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.card?.amount} currency={r.card?.currency} /> },
    { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
    { key: 'start', header: 'Activated', cell: r => <DateTime value={r.startDate} /> },
    { key: 'window', header: 'Window', cell: r => (r.card?.periodDays ? `${r.card.periodDays} d` : r.card?.endDate ? <DateTime value={r.card.endDate} /> : '—') }
  ]

  return (
    <DataTable
      columns={columns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={p => set({ page: p })}
      onLimitChange={l => set({ limit: l })}
      emptyMessage='No user has activated a gift card.'
      toolbar={
        <>
          <Input className='w-40' placeholder='User id' inputMode='numeric' value={userId} onChange={e => { setUserId(e.target.value.replace(/\D/g, '')); set({ page: 1 }) }} />
          <Select value={status} onValueChange={v => { if (v) { setStatus(v); set({ page: 1 }) } }}>
            <SelectTrigger className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All statuses</SelectItem>
              <SelectItem value='Activated'>Activated</SelectItem>
              <SelectItem value='Claimed'>Claimed</SelectItem>
              <SelectItem value='Expired'>Expired</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
    />
  )
}

const Analytics = ({ q }: { q: ReturnType<typeof useApi<GiftCardAnalytics>> }) => {
  const columns: Column<GiftCardAnalytics['cards'][number]>[] = [
    { key: 'key', header: 'Gift code', cell: r => <span className='font-mono text-sm'>{r.uniqueKey}</span> },
    { key: 'amount', header: 'Claim amount', align: 'right', cell: r => <Money value={r.amount} /> },
    { key: 'act', header: 'Activations', align: 'right', cell: r => formatNumber(r.activations) },
    { key: 'claims', header: 'Claims', align: 'right', cell: r => formatNumber(r.claims) },
    { key: 'conv', header: 'Conversion', align: 'right', cell: r => (r.activations ? `${((r.claims / r.activations) * 100).toFixed(1)}%` : '—') },
    { key: 'at', header: 'Created', cell: r => <DateTime value={r.createdAt} /> }
  ]

  return <DataTable columns={columns} rows={q.data?.cards} rowKey={r => r.id} loading={q.isLoading} error={q.error} dense emptyMessage='No cards to analyse.' />
}

const GiftCards = () => {
  const analytics = useApi<GiftCardAnalytics>('admin/user/gift-cards/analytics')
  const a = analytics.data

  return (
    <div>
      <PageHeader
        title='Gift cards'
        description='Promotional cards users activate and claim once they meet a deposit or wagering condition.'
        actions={
          <Can permission='config:write'>
            <CreateCard />
          </Can>
        }
      />
      {analytics.error && <div className='mb-4'><ErrorState error={analytics.error} /></div>}
      <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Total cards' value={formatNumber(a?.totalCards)} loading={analytics.isLoading} />
        <StatCard label='Activated' value={formatNumber(a?.activated)} hint='waiting on conditions' loading={analytics.isLoading} />
        <StatCard label='Claimed' value={formatNumber(a?.claimed)} hint='paid out' loading={analytics.isLoading} />
        <StatCard label='Expired' value={formatNumber(a?.expired)} loading={analytics.isLoading} />
      </div>
      <Tabs defaultValue='cards'>
        <TabsList className='mb-4'>
          <TabsTrigger value='cards'>Cards</TabsTrigger>
          <TabsTrigger value='records'>Records</TabsTrigger>
          <TabsTrigger value='analytics'>Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value='cards'><Cards /></TabsContent>
        <TabsContent value='records'><Records /></TabsContent>
        <TabsContent value='analytics'><Analytics q={analytics} /></TabsContent>
      </Tabs>
    </div>
  )
}

export default GiftCards
