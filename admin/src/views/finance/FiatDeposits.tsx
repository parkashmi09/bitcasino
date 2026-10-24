'use client'

import { useState } from 'react'

import Link from 'next/link'

import { CheckIcon, CircleCheckIcon, CircleXIcon, ClockIcon, EyeIcon, SearchIcon, SunIcon, XIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { TextAreaField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import { FilterBar, PRESETS, toApiRange, useStatsFilters, type StatsFilters } from '@/components/shared/charts'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import FinanceStatsPanel, { useStatsQuery, type FinanceStats } from './FinanceStatsPanel'
import ListStatsTabs from './ListStatsTabs'
import { CopyButton, Details, ImageDialog, ViewDialog, stop } from './shared'
import { PlayerAvatar } from '@/views/players/users/shared'

import type { FiatDepositRow } from './types'

const LIST = 'admin/user/deposits/fiat'
const STATS = 'admin/reports/finance-stats'
const INVALIDATE = [['paged', LIST], ['api', 'admin/reports/finance-stats']]

/** The server mounts approve/reject behind `deposits:approve`; the inventory lists `withdrawals:approve`. Either shows the buttons; the platform decides. */
const APPROVE = ['deposits:approve', 'withdrawals:approve']

const Approve = ({ row }: { row: FiatDepositRow }) => {
  // Prefilled with the requested amount (no trailing zeros); the admin may only lower it.
  const requested = String(Number(row.amount))
  const [form, setForm] = useState({ creditAmount: requested, comment: '', transactionPassword: '' })
  const typed = form.creditAmount.trim()

  const amountError = !typed
    ? 'Enter the amount to credit'
    : (check.amount(typed, 'Credit amount', { decimals: 8 }) ??
      (Number(typed) > Number(row.amount) ? `Cannot be more than the requested ${Number(row.amount).toLocaleString('en-IN')} ${row.currency}` : undefined))

  const reduced = !amountError && Number(typed) < Number(row.amount)

  const approve = useApiMutation({
    fn: () => {
      const body: Record<string, string> = { transactionPassword: form.transactionPassword }

      if (reduced) {
        body.creditAmount = typed
        body.comment = form.comment.trim()
      }

      return api.put(`${LIST}/${row.depositId}/approve`, body)
    },
    invalidate: INVALIDATE,
    success: 'Deposit approved and credited'
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm'>
          <CheckIcon /> Approve
        </Button>
      }
      title={`Approve deposit #${row.depositId}`}
      description={
        <>
          Credits user #{row.userId} with <Money value={row.amount} currency={row.currency} />. Lower the amount only when the bank statement shows less, with the
          reason the user will see. More than the requested amount cannot be credited.
        </>
      }
      submitLabel='Approve & credit'
      submitDisabled={!!amountError}
      validate={() => ({
        // fiatDeposit.validators.js approve: creditAmount optional money (> 0, ≤ 8 dp); comment ≤ 500.
        creditAmount: amountError,
        comment: reduced && !form.comment.trim() ? 'Say why you credit less than requested (the user sees it)' : check.length(form.comment, 'Comment', { max: 500 }),
        transactionPassword: form.transactionPassword ? undefined : 'Enter your transaction password'
      })}
      onSubmit={() => approve.mutateAsync()}
    >
      <TextField
        id={`ap-amt-${row.depositId}`}
        name='creditAmount'
        inputMode='decimal'
        autoComplete='off'
        label='Credit amount'
        hint={`Requested ${Number(row.amount).toLocaleString('en-IN')} ${row.currency}. Lower it to credit less; it cannot go higher.`}
        error={typed !== requested && amountError}
        value={form.creditAmount}
        onChange={e => setForm({ ...form, creditAmount: e.target.value })}
      />
      <TextAreaField
        id={`ap-c-${row.depositId}`}
        name='comment'
        label={reduced ? 'Reason for the lower amount (the user sees it)' : 'Comment'}
        required={reduced}
        disabled={!reduced}
        placeholder={reduced ? 'e.g. Bank statement shows ₹15,000 received' : 'Only needed when you credit less than requested'}
        value={form.comment}
        onChange={e => setForm({ ...form, comment: e.target.value })}
      />
      <TextField id={`ap-pw-${row.depositId}`} name='transactionPassword' label='Transaction password' type='password' autoComplete='new-password' required value={form.transactionPassword} onChange={e => setForm({ ...form, transactionPassword: e.target.value })} />
    </FormDialog>
  )
}

const Reject = ({ row }: { row: FiatDepositRow }) => {
  const [comment, setComment] = useState('')

  const reject = useApiMutation({
    fn: () => api.put(`${LIST}/${row.depositId}/reject`, { comment: comment.trim() }),
    invalidate: INVALIDATE,
    success: 'Deposit rejected'
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='outline' className='text-danger hover:bg-danger-soft hover:text-danger'>
          <XIcon /> Reject
        </Button>
      }
      title={`Reject deposit #${row.depositId}`}
      description='The user sees this reason on their deposit history.'
      submitLabel='Reject'
      destructive
      validate={() => ({ comment: check.required(comment, 'Reason') ?? check.length(comment, 'Reason', { max: 500 }) })}
      onSubmit={() => reject.mutateAsync()}
    >
      <TextAreaField id={`rj-c-${row.depositId}`} name='comment' label='Reason' required value={comment} onChange={e => setComment(e.target.value)} />
    </FormDialog>
  )
}

const Detail = ({ row }: { row: FiatDepositRow }) => (
  <ViewDialog
    trigger={
      <Button variant='ghost' size='icon-sm' aria-label={`View deposit #${row.depositId}`} title='View details'>
        <EyeIcon />
      </Button>
    }
    title={`Deposit #${row.depositId}`}
    description={
      <span className='inline-flex items-center gap-2'>
        <StatusBadge value={row.status} /> <DateTime value={row.createdAt} />
      </span>
    }
  >
    <Details
      items={[
        ['User', <Link key='p' href={`/users/${row.userId}`} className='underline'>#{row.userId}</Link>],
        ['Amount', <Money key='a' value={row.amount} currency={row.currency} />],
        [
          row.network ? 'Transaction hash' : 'Bank reference',
          <span key='t' className='inline-flex items-start gap-1'>
            <span className='font-mono break-all'>{row.transactionId}</span>
            {row.transactionId && <CopyButton value={row.transactionId} label='Copy reference' />}
          </span>
        ],
        ['Method', <DepositMethod key='m' row={row} />],
        ['Bank', row.bankName],
        ['Account holder', row.accountHolderName],
        ['Account number', row.accountNumber],
        ['IFSC', row.ifscCode],
        ['UPI id', row.upiId],
        ['Admin comment', row.adminComment],
        ['Handled by', row.handledBy ? `#${row.handledBy}` : null],
        ['Handled at', row.handledAt ? <DateTime key='h' value={row.handledAt} /> : null]
      ]}
    />
    {row.hasScreenshot ? (
      <div className='mt-2'>
        <ImageDialog path={`${LIST}/${row.depositId}/screenshot`} title={`Proof of payment — deposit #${row.depositId}`} label='View screenshot' />
      </div>
    ) : (
      <p className='text-muted-foreground text-xs'>No proof of payment was uploaded.</p>
    )}
  </ViewDialog>
)

/**
 * How the player paid. The site sends the UPI id for a UPI deposit and the bank account for a
 * bank transfer; older rows carry both (the site used to send every receiving detail), so a row
 * with a UPI id and no account number is UPI, one with both shows both.
 */
const DepositMethod = ({ row }: { row: FiatDepositRow }) => {
  if (row.network)
    return (
      <span className='text-sm'>
        Crypto · {row.currency}·{row.network} <span className='text-muted-foreground block font-mono text-xs'>{row.walletAddress ?? ''}</span>
      </span>
    )
  if (row.upiId && !row.accountNumber) return <span className='text-sm'>UPI <span className='text-muted-foreground font-mono text-xs'>{row.upiId}</span></span>
  if (row.upiId && row.bankName) return <span className='text-sm'>UPI or {row.bankName} <span className='text-muted-foreground font-mono text-xs'>{row.upiId}</span></span>

  return <span className='text-sm'>{row.bankName ? `Bank · ${row.bankName}` : '—'}</span>
}

const columns: Column<FiatDepositRow>[] = [
  {
    key: 'user',
    header: 'Player',
    cell: r => (
      <Link href={`/users/${r.userId}`} className='group flex items-center gap-2.5' onClick={stop}>
        <PlayerAvatar name={r.username} avatar={r.avatar} className='size-8 text-[11px]' />
        <span className='min-w-0'>
          <span className='block truncate font-medium group-hover:underline'>{r.username || `#${r.userId}`}</span>
          <span className='text-muted-foreground block font-mono text-xs'>
            {r.username ? `#${r.userId} · ` : ''}dep {r.depositId}
          </span>
        </span>
      </Link>
    )
  },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} className='font-semibold' /> },
  {
    key: 'ref',
    header: 'UTR / tx id',
    cell: r =>
      r.transactionId ? (
        <span className='flex max-w-56 items-center gap-1'>
          <span className='truncate font-mono text-xs' title={r.transactionId}>
            {r.transactionId}
          </span>
          <CopyButton value={r.transactionId} label='Copy reference' />
        </span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      )
  },
  { key: 'bank', header: 'Method', cell: r => <DepositMethod row={r} /> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  {
    key: 'proof',
    header: 'Proof',
    cell: r =>
      r.hasScreenshot ? (
        <span onClick={stop}>
          <ImageDialog thumbnail path={`${LIST}/${r.depositId}/screenshot`} title={`Proof of payment — deposit #${r.depositId}`} label='View screenshot' />
        </span>
      ) : (
        <span className='text-muted-foreground text-xs'>None</span>
      )
  },
  { key: 'at', header: 'Created', cell: r => <DateTime value={r.createdAt} relative /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <div className='flex justify-end gap-1.5' onClick={stop}>
        {r.status === 'pending' && (
          <Can permission={APPROVE}>
            <Approve row={r} />
            <Reject row={r} />
          </Can>
        )}
        <Detail row={r} />
      </div>
    )
  }
]

/**
 * Headline tiles above the queue, from the same `admin/reports/finance-stats` the Stats tab reads
 * (reports:read): the selected period's pending / approved / rejected, plus today's approvals.
 */
const Summary = ({ filters }: { filters: StatsFilters }) => {
  const query = useStatsQuery('deposits', 'fiat', filters)
  const today = new Date().toISOString().slice(0, 10)
  const period = useApi<FinanceStats>(STATS, query)
  const todays = useApi<FinanceStats>(STATS, { ...query, ...toApiRange(today, today) })
  const t = period.data?.totals.byStatus
  const currency = period.data?.currency ?? query.convertTo
  const label = PRESETS.find(p => p.value === filters.preset)?.label ?? 'Selected period'
  const count = (n?: number) => (n ?? 0).toLocaleString('en-IN')

  return (
    <div className='mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4'>
      <StatCard
        label='Pending review'
        icon={<ClockIcon />}
        loading={period.isLoading}
        value={<span className='text-warning'>{count(t?.pending.count)}</span>}
        hint={<><Money value={t?.pending.amount ?? 0} currency={currency} /> · {label}</>}
      />
      <StatCard
        label='Approved today'
        icon={<SunIcon />}
        loading={todays.isLoading}
        value={<Money value={todays.data?.totals.byStatus.success.amount ?? 0} currency={todays.data?.currency ?? currency} />}
        hint={`${count(todays.data?.totals.byStatus.success.count)} deposits`}
      />
      <StatCard
        label='Approved'
        icon={<CircleCheckIcon />}
        loading={period.isLoading}
        value={<Money value={t?.success.amount ?? 0} currency={currency} />}
        hint={`${count(t?.success.count)} deposits · ${label}`}
      />
      <StatCard
        label='Rejected'
        icon={<CircleXIcon />}
        loading={period.isLoading}
        value={<span className='text-danger'>{count(t?.failed.count)}</span>}
        hint={<><Money value={t?.failed.amount ?? 0} currency={currency} /> · {label}</>}
      />
    </div>
  )
}

const FiatDeposits = () => {
  const { can } = useSession()
  const { state, set, query } = useListState(['status', 'userId'], { status: 'pending' })

  // Period and bucket size for the charts (every currency, in the default coin). The review queue
  // lists every currency and has no date filter.
  const filters = useStatsFilters()

  const list = usePagedApi<FiatDepositRow>(LIST, {
    // Agent ke users ye use nahi kar sakte — sirf direct users.
    channel: 'direct',
    limit: query.limit,
    page: query.page,
    status: query.status,
    userId: query.userId,
    search: query.search
  })

  return (
    <div>
      <PageHeader title='Manual deposits' description='Manual bank-transfer deposits awaiting review. Approving credits the user; rejecting records a reason they can see.' />
      {can('reports:read') && <Summary filters={filters} />}
      <FilterBar filters={filters} className='mb-4'>
        <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
          <SelectTrigger className='w-36' aria-label='Status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All statuses</SelectItem>
            <SelectItem value='pending'>Pending</SelectItem>
            <SelectItem value='approved'>Approved</SelectItem>
            <SelectItem value='rejected'>Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder='User id' inputMode='numeric' aria-label='User id' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value.replace(/\D/g, '') })} className='w-28' />
        <div className='relative w-full sm:w-64'>
          <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input value={String(state.search ?? '')} onChange={e => set({ search: e.target.value })} placeholder='UTR, bank reference, holder…' aria-label='Search' className='pl-8' />
        </div>
      </FilterBar>
      <ListStatsTabs stats={can('reports:read') ? <FinanceStatsPanel kind='deposits' rail='fiat' filters={filters} statusLabels={{ success: 'Successful', pending: 'Pending', failed: 'Failed' }} /> : null}>
        <DataTable
          dense
          columns={columns}
          rows={list.data?.rows}
          rowKey={r => r.depositId}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={page => set({ page })}
          onLimitChange={limit => set({ limit })}
          emptyMessage={state.status ? `No ${state.status} deposits.` : 'No deposits.'}
        />
      </ListStatsTabs>
    </div>
  )
}

export default FiatDeposits
