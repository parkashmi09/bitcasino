'use client'

import { useState } from 'react'

import Link from 'next/link'

import { EyeIcon, GavelIcon, RefreshCwIcon, SendIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextAreaField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import { FilterBar, useStatsFilters } from '@/components/shared/charts'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber, truncateId } from '@/lib/format'
import { check } from '@/lib/validate'
import FinanceStatsPanel from './FinanceStatsPanel'
import ListStatsTabs from './ListStatsTabs'
import { Details, ViewDialog, stop } from './shared'
import { TxnPasswordLabel } from './StaffFloat'
import { CRYPTO_WITHDRAW_STATUSES, type CryptoWithdrawSummary, type CryptoWithdrawalRow } from './types'

const LIST = 'admin/user/withdrawals/crypto'
const SUMMARY = `${LIST}/summary`

/** Legal moves (`cryptoWithdraw.constants.TRANSITIONS`): In Queue → Approved/Rejected; Approved → Sent/Rejected. */
const NEXT: Record<string, string[]> = { 'In Queue': ['Approved', 'Rejected'], Approved: ['Sent', 'Rejected'] }

/** `POST admin/user/withdrawals/crypto/:id/decision { status, txid?, comment? }`. */
const Decide = ({ row }: { row: CryptoWithdrawalRow }) => {
  const options = NEXT[row.status] ?? []
  const [form, setForm] = useState({ status: options[0] ?? '', txid: '', comment: '', transactionPassword: '' })

  const decide = useApiMutation({
    fn: () => {
      const body: Record<string, string> = { status: form.status, transactionPassword: form.transactionPassword }

      if (form.txid) body.txid = form.txid
      if (form.comment) body.comment = form.comment

      return api.post(`${LIST}/${row.id}/decision`, body)
    },
    invalidate: [['paged', LIST], ['api', SUMMARY], ['api', 'admin/reports/finance-stats']],
    success: `Withdrawal #${row.id} updated`
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm'>
          <GavelIcon /> Decide
        </Button>
      }
      title={`Withdrawal #${row.id}`}
      description={
        <>
          <Money value={row.amount} currency={row.coin} /> to <span className='font-mono'>{row.wallet}</span>. Approved is the instruction to send coin; Sent records the on-chain hash; Rejected returns the held balance to the user.
        </>
      }
      submitLabel='Apply'
      destructive={form.status === 'Rejected'}
      validate={() => ({
        status: form.status ? undefined : 'Pick the new status',

        // cryptoWithdraw validators: txid 16–120 alphanumerics; comment ≤ 500.
        txid:
          form.status === 'Sent' && !form.txid.trim()
            ? 'Transaction hash is required when marking as Sent'
            : form.txid.trim() && !/^[A-Za-z0-9]{16,120}$/.test(form.txid.trim())
              ? 'Transaction hash must be 16–120 letters or digits'
              : undefined,
        comment: check.length(form.comment, 'Note', { max: 500 }),
        transactionPassword: form.transactionPassword ? undefined : 'Transaction password is required'
      })}
      onSubmit={() => decide.mutateAsync()}
    >
      <SelectField id={`cw-st-${row.id}`} name='status' label='New status' value={form.status} onChange={status => setForm({ ...form, status })} options={options.map(v => ({ value: v, label: v }))} />
      <TextField id={`cw-tx-${row.id}`} name='txid' label='Transaction hash' hint='16–120 alphanumerics; record it when marking as Sent' value={form.txid} onChange={e => setForm({ ...form, txid: e.target.value })} required={form.status === 'Sent'} />
      <TextAreaField id={`cw-c-${row.id}`} name='comment' label='Note' hint='The user can read this (it is the reason a payout was refused)' value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} />
      <TextField id={`cw-tp-${row.id}`} name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required value={form.transactionPassword} onChange={e => setForm({ ...form, transactionPassword: e.target.value })} />
    </FormDialog>
  )
}

/** Where "Send via CCPayment" may start (`cryptoWithdraw.constants.SENDABLE`); it needs the network. */
const SENDABLE = ['In Queue', 'Approved']

const INVALIDATE = [['paged', LIST], ['api', SUMMARY], ['api', 'admin/reports/finance-stats']]

/** `POST …/:id/send-ccpayment { transactionPassword }` — CCPayment sends the coin; its webhook finishes it. */
const SendCcpayment = ({ row }: { row: CryptoWithdrawalRow }) => {
  const [transactionPassword, setTransactionPassword] = useState('')

  const send = useApiMutation({
    fn: () => api.post<{ uncertain: boolean }>(`${LIST}/${row.id}/send-ccpayment`, { transactionPassword }),
    invalidate: INVALIDATE,
    success: r =>
      r.uncertain
        ? `Withdrawal #${row.id}: no answer from CCPayment yet — it stays Sending; use Check with CCPayment`
        : `Withdrawal #${row.id} sent to CCPayment — it turns Sent when the coin is on-chain`
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='outline'>
          <SendIcon /> CCPayment
        </Button>
      }
      title={`Send withdrawal #${row.id} via CCPayment`}
      description={
        <>
          CCPayment sends <Money value={row.amount} currency={row.coin} /> on {row.chain} to <span className='font-mono'>{row.wallet}</span> from your CCPayment balance. The
          network fee comes out of the amount. If CCPayment fails it, the request is rejected and the user refunded automatically.
        </>
      }
      submitLabel='Send'
      validate={() => ({ transactionPassword: transactionPassword ? undefined : 'Transaction password is required' })}
      onSubmit={() => send.mutateAsync()}
    >
      <TextField id={`cw-cc-${row.id}`} name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required value={transactionPassword} onChange={e => setTransactionPassword(e.target.value)} />
    </FormDialog>
  )
}

/** A withdrawal still Sending (its webhook never came): ask CCPayment now. */
const CheckCcpayment = ({ row }: { row: CryptoWithdrawalRow }) => {
  const check = useApiMutation({
    fn: () => api.post<{ pending?: boolean; status?: string }>(`${LIST}/${row.id}/check-ccpayment`),
    invalidate: INVALIDATE,
    success: r => (r.pending ? `Withdrawal #${row.id} is still being processed by CCPayment` : `Withdrawal #${row.id}: ${r.status}`)
  })

  return (
    <Button size='sm' variant='outline' disabled={check.isPending} onClick={() => check.mutate()}>
      <RefreshCwIcon /> Check
    </Button>
  )
}

const Detail = ({ row }: { row: CryptoWithdrawalRow }) => (
  <ViewDialog
    trigger={
      <Button variant='ghost' size='sm'>
        <EyeIcon /> View
      </Button>
    }
    title={`Withdrawal #${row.id}`}
    description={
      <span className='inline-flex items-center gap-2'>
        <StatusBadge value={row.status} /> <DateTime value={row.date} />
      </span>
    }
  >
    <Details
      items={[
        ['User', <Link key='p' href={`/users/${row.userId}`} className='underline'>#{row.userId}</Link>],
        ['Amount', <Money key='a' value={row.amount} currency={row.coin} />],
        ['Chain', row.chain],
        ['Wallet', <span key='w' className='font-mono text-xs'>{row.wallet}</span>],
        ['Tx hash', <span key='t' className='font-mono text-xs'>{row.txid}</span>],
        ['Note', row.note],
        ['Decided by', row.decidedBy ? `#${row.decidedBy}` : null],
        ['Decided at', row.decidedAt ? <DateTime key='d' value={row.decidedAt} /> : null]
      ]}
    />
  </ViewDialog>
)

const columns: Column<CryptoWithdrawalRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'user', header: 'User', cell: r => <Link href={`/users/${r.userId}`} className='font-mono text-xs hover:underline'>#{r.userId}</Link> },
  { key: 'coin', header: 'Coin', cell: r => <span className='text-sm'>{r.coin}{r.chain ? <span className='text-muted-foreground'> · {r.chain}</span> : null}</span> },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.coin} /> },
  { key: 'wallet', header: 'Address', cell: r => <span className='font-mono text-xs' title={r.wallet}>{truncateId(r.wallet, 8)}</span> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'txid', header: 'Tx hash', cell: r => <span className='font-mono text-xs' title={r.txid ?? ''}>{truncateId(r.txid, 6)}</span> },
  { key: 'at', header: 'Requested', cell: r => <DateTime value={r.date} /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <div className='flex justify-end gap-1' onClick={stop}>
        <Detail row={r} />
        {SENDABLE.includes(r.status) && r.chain ? (
          <Can permission='withdrawals:approve'>
            <SendCcpayment row={r} />
          </Can>
        ) : null}
        {r.status === 'Sending' ? (
          <Can permission='withdrawals:approve'>
            <CheckCcpayment row={r} />
          </Can>
        ) : null}
        {NEXT[r.status]?.length ? (
          <Can permission='withdrawals:approve'>
            <Decide row={r} />
          </Can>
        ) : null}
      </div>
    )
  }
]

const CryptoWithdrawals = () => {
  const { state, set, query } = useListState(['status', 'userId'], { status: 'In Queue' })
  const { can } = useSession()

  // One period for the charts and the table, every coin. The list's `to` is inclusive.
  const filters = useStatsFilters()

  const list = usePagedApi<CryptoWithdrawalRow>(LIST, {
    // Agent ke users ye use nahi kar sakte — sirf direct users.
    channel: 'direct',
    limit: query.limit,
    page: query.page,
    status: query.status,
    userId: query.userId,
    from: filters.apiRange.from,
    to: `${filters.to}T23:59:59.999Z`
  })

  const summary = useApi<CryptoWithdrawSummary[]>(SUMMARY)

  const byStatus = (status: string) => {
    const rows = (summary.data ?? []).filter(r => r.status === status)

    return { count: rows.reduce((n, r) => n + r.count, 0), hint: rows.map(r => `${r.total} ${r.coin}`).join(' · ') || '—' }
  }

  return (
    <div>
      <PageHeader title='Crypto withdrawals' description='On-chain payout requests. Send via CCPayment (it marks Sent itself), or approve → send coin by hand → mark Sent with the hash. Rejecting returns the held balance.' />
      <FilterBar filters={filters} className='mb-4' />
      <ListStatsTabs stats={<>
          {can('reports:read') && (
            <FinanceStatsPanel kind='withdrawals' rail='crypto' filters={filters} statusLabels={{ success: 'Sent', pending: 'In queue / approved', failed: 'Rejected' }} />
          )}
          {summary.error ? (
            <div className='mb-4'>
              <ErrorState error={summary.error} title='Could not load the queue summary' />
            </div>
          ) : null}
          <p className='text-muted-foreground mb-2 text-xs font-medium'>Queue right now, all dates · all coins</p>
          <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
            {CRYPTO_WITHDRAW_STATUSES.map(s => {
              const v = byStatus(s)
    
              return <StatCard key={s} label={s} value={formatNumber(v.count)} hint={v.hint} loading={summary.isLoading} />
            })}
          </div>
        </>}>
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
          emptyMessage={state.status ? `Nothing ${String(state.status).toLowerCase()}.` : 'No withdrawal requests.'}
          toolbar={
            <>
              <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
                <SelectTrigger className='w-36'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All statuses</SelectItem>
                  {CRYPTO_WITHDRAW_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder='User id' aria-label='User id' inputMode='numeric' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value.replace(/\D/g, '') })} className='w-28' />
            </>
          }
        />
      </ListStatsTabs>
    </div>
  )
}

export default CryptoWithdrawals
