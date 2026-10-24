'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PlusIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { DateField, SelectField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import { FilterBar, useStatsFilters } from '@/components/shared/charts'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSession } from '@/contexts/SessionContext'
import { useApiMutation, useListState } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { truncateId } from '@/lib/format'
import { check } from '@/lib/validate'
import FinanceStatsPanel from './FinanceStatsPanel'
import ListStatsTabs from './ListStatsTabs'
import { usePageNumbered } from './shared'
import type { CryptoDepositRow } from './types'

const LIST = 'admin/user/history/crypto/deposits'

/** `POST admin/user/crypto/inr-deposits` — a staff-entered INR credit for an on-chain deposit. */
const RecordInrDeposit = () => {
  const [form, setForm] = useState({ userId: '', amount: '', transactionId: '', status: 'pending', date: '' })

  const record = useApiMutation({
    fn: () => {
      const body: Record<string, string | number> = { userId: Number(form.userId), amount: form.amount, transactionId: form.transactionId, status: form.status }

      if (form.date) body.date = form.date

      return api.post('admin/user/crypto/inr-deposits', body)
    },
    invalidate: [['paged', LIST], ['api', 'admin/reports/finance-stats']],
    success: 'INR deposit recorded',
    onSuccess: () => setForm({ userId: '', amount: '', transactionId: '', status: 'pending', date: '' })
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> Record INR deposit
        </Button>
      }
      title='Record an INR deposit'
      description='Enters a deposit the user made out of band. Audited under your name; only "success" counts as money that arrived.'
      submitLabel='Record'
      validate={() => ({
        userId: check.id(form.userId, 'User id'),
        amount: check.amount(form.amount, 'Amount', { decimals: 8 }),
        transactionId: check.required(form.transactionId, 'Transaction id') ?? check.length(form.transactionId, 'Transaction id', { max: 120 }),
        'ir-date': form.date && new Date(form.date).getTime() > Date.now() ? 'Date cannot be in the future' : undefined
      })}
      onSubmit={() => record.mutateAsync()}
    >
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='ir-user' name='userId' label='User id' required inputMode='numeric' value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value.replace(/\D/g, '') })} />
        <TextField id='ir-amt' name='amount' inputMode='decimal' label='Amount (INR)' required placeholder='1000.00' value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
      </div>
      <TextField id='ir-tx' name='transactionId' label='Transaction id' required value={form.transactionId} onChange={e => setForm({ ...form, transactionId: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <SelectField id='ir-status' label='Status' value={form.status} onChange={status => setForm({ ...form, status })} options={['pending', 'success', 'failed'].map(v => ({ value: v, label: v }))} />
        <DateField id='ir-date' label='Date' value={form.date} onChange={date => setForm({ ...form, date })} />
      </div>
    </FormDialog>
  )
}

/** `"0.00100000"` → `"0.001"`: a coin amount keeps its precision but not the padding. */
const trimCoin = (value: string | null | undefined) => {
  if (value == null || value === '') return '—'

  return value.includes('.') ? value.replace(/\.?0+$/, '') : value
}

const columns: Column<CryptoDepositRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'user', header: 'User', cell: r => <Link href={`/users/${r.userId}`} className='font-mono text-xs hover:underline'>#{r.userId}</Link> },
  { key: 'chain', header: 'Chain', cell: r => <span className='text-sm'>{r.chain ?? '—'}</span> },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: r => (
      <div className='flex flex-col items-end'>
        <span className='font-mono text-sm tabular-nums'>
          {trimCoin(r.amount)} <span className='text-muted-foreground'>{r.coin ?? '—'}</span>
        </span>
        {r.amountUsd != null && (
          <span className='text-muted-foreground text-xs'>
            ≈ <Money value={r.amountUsd} currency='USD' />
          </span>
        )}
      </div>
    )
  },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'order', header: 'Order', cell: r => <span className='font-mono text-xs' title={r.orderId ?? ''}>{truncateId(r.orderId)}</span> },
  { key: 'addr', header: 'Address', cell: r => <span className='font-mono text-xs' title={r.address ?? ''}>{truncateId(r.address, 6)}</span> },
  { key: 'at', header: 'Created', cell: r => <DateTime value={r.createdAt} /> }
]

const CryptoDeposits = () => {
  const { can } = useSession()
  const { state, set, query } = useListState(['status', 'chain', 'userid'])

  // One period for the charts and the table (every coin): the list takes inclusive days.
  const filters = useStatsFilters()
  const range = { startDate: filters.from, endDate: filters.to }
  const list = usePageNumbered<CryptoDepositRow>(LIST, { channel: 'direct', limit: query.limit, page: query.page, status: query.status, chain: query.chain, userid: query.userid, ...range })

  return (
    <div>
      <PageHeader
        title='Crypto deposits'
        description='On-chain deposits seen by the payment provider, scoped to your agent tree. Amounts are in the coin the chain moved; USD is at the current rate, where one is set.'
        actions={
          <Can permission='deposits:approve'>
            <RecordInrDeposit />
          </Can>
        }
      />
      <FilterBar filters={filters} className='mb-4' />
      <ListStatsTabs stats={can('reports:read') ? <FinanceStatsPanel kind='deposits' rail='crypto' filters={filters} statusLabels={{ success: 'Successful', pending: 'Processing', failed: 'Failed' }} /> : null}>
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
          toolbar={
            <>
              <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
                <SelectTrigger className='w-36'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All statuses</SelectItem>
                  <SelectItem value='success'>Success</SelectItem>
                  <SelectItem value='pending'>Pending</SelectItem>
                  <SelectItem value='failed'>Failed</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder='Chain' aria-label='Chain' value={String(state.chain ?? '')} onChange={e => set({ chain: e.target.value })} className='w-28' />
              <Input placeholder='User id' aria-label='User id' inputMode='numeric' value={String(state.userid ?? '')} onChange={e => set({ userid: e.target.value.replace(/\D/g, '') })} className='w-28' />
            </>
          }
        />
      </ListStatsTabs>
    </div>
  )
}

export default CryptoDeposits
