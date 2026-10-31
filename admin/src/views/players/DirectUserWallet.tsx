'use client'

import { useMemo, useState } from 'react'

import Link from 'next/link'

import { HistoryIcon, MinusIcon, PlusIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, TrendingDownIcon, TrendingUpIcon, UsersIcon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { formatIn, useReportMoney } from '@/components/shared/ReportMoney'
import StatCard from '@/components/shared/StatCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useApi, useInvalidate, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useCurrencyCodes } from '@/views/finance/useCurrencyCodes'
import type { OwnerWallet } from '@/views/exchange/types'
import { PlayerAvatar } from '@/views/players/users/shared'

/** `GET admin/direct-wallet/users` ki ek row. Balances by uppercase coin. */
type DirectUserRow = { id: string; name: string; avatar: string | null; status: string | null; balances: Record<string, string> }

/** `GET admin/direct-wallet/currencies` — 1 unit = kitne INR. */
type CurrencyRate = { code: string; inrRate: string }

/** `GET admin/direct-wallet/users/:id/history` ki ek row. */
type HistoryRow = {
  id: string
  coin: string
  operation: 'credit' | 'debit' | string
  amount: string
  previousBalance: string
  newBalance: string
  description: string | null
  createdAt: string
}

type Operation = 'credit' | 'debit'

const BASE = 'admin/direct-wallet'

/** Fiat moves in paise; a coin up to the 8 places the API allows. */
const decimalsOf = (code: string) => (code === 'INR' || code === 'USD' ? 2 : 8)

/** Digits and one point, at most `dp` decimals. */
const cleanAmount = (v: string, dp: number) => {
  const s = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
  const [whole, frac] = s.split('.')

  return frac === undefined ? whole : `${whole}.${frac.slice(0, dp)}`
}

/** A coin amount for display: "1,234.5 BTC", fiat with its symbol. */
const coinAmount = (v: string | number | undefined, code: string) => formatIn(Number(v ?? 0), code, { digits: decimalsOf(code) === 2 ? 2 : undefined })

/** The coins (of those offered) this user holds a non-zero balance in. */
const nonZero = (row: DirectUserRow, codes: string[]) => codes.filter(c => Number(row.balances[c] ?? 0) !== 0)

/**
 * Adjust balance — credit or debit one coin for one direct user. Same call and rules as before
 * (`POST admin/direct-wallet/adjust` with the transaction password; a credit is paid from the Super
 * Admin's Direct User wallet at the coin's INR rate, a debit goes back to it).
 */
const AdjustDialog = ({
  row,
  codes,
  rateOf,
  onClose
}: {
  row: DirectUserRow | null
  codes: string[]
  rateOf: Map<string, string>
  onClose: () => void
}) => {
  const [currency, setCurrency] = useState('INR')
  const [operation, setOperation] = useState<Operation>('credit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const invalidate = useInvalidate()

  const reset = () => {
    setCurrency(codes.includes('INR') ? 'INR' : (codes[0] ?? 'INR'))
    setOperation('credit')
    setAmount('')
    setNote('')
    setPassword('')
  }

  const balance = Number(row?.balances[currency] ?? 0)
  const n = Number(amount) || 0
  const next = operation === 'credit' ? balance + n : balance - n
  const inrRate = Number(rateOf.get(currency) ?? 0)
  const isCredit = operation === 'credit'
  const label = n > 0 && row ? `${isCredit ? 'Credit' : 'Debit'} ${coinAmount(amount, currency)} ${isCredit ? 'to' : 'from'} ${row.name}` : isCredit ? 'Credit' : 'Debit'

  return (
    <FormDialog
      trigger={null}
      open={!!row}
      onOpenChange={o => {
        if (o) return
        reset()
        onClose()
      }}
      title='Adjust balance'
      description='Credits are paid from your Direct Users wallet at the coin’s INR rate; debits go back to it.'
      submitLabel={label}
      destructive={!isCredit}
      submitDisabled={!(n > 0) || !password}
      validate={() => ({
        amount: !(n > 0) ? 'Enter an amount above zero' : !isCredit && n > balance ? `Only ${coinAmount(balance, currency)} to debit` : '',
        transactionPassword: password ? '' : 'Enter your transaction password'
      })}
      onSubmit={async () => {
        if (!row) return

        const r = await api.post<{ inrValue?: string }>(`${BASE}/adjust`, {
          userId: row.id,
          currency,
          amount,
          operation,
          ...(note.trim() ? { note: note.trim() } : {}),
          transactionPassword: password
        })

        toast.success(
          `${isCredit ? 'Credited' : 'Debited'} ${coinAmount(amount, currency)} ${isCredit ? 'to' : 'from'} ${row.name} · ${formatIn(Number(r?.inrValue ?? 0), 'INR')} ${isCredit ? 'from' : 'back to'} your wallet`
        )
        invalidate([`paged`, `${BASE}/users`], ['api', 'admin/exchange/owner/wallet'], ['paged', 'admin/exchange/owner/direct-ledger'], ['paged', `${BASE}/users/${row.id}/history`])
        reset()
        onClose()
      }}
    >
      {row && (
        <div className='bg-muted/40 flex items-center gap-3 rounded-lg border p-3'>
          <PlayerAvatar name={row.name} avatar={row.avatar} />
          <div className='min-w-0'>
            <p className='truncate font-semibold'>{row.name}</p>
            <p className='text-muted-foreground font-mono text-xs'>UID {row.id}</p>
          </div>
        </div>
      )}

      <div className='grid gap-4 sm:grid-cols-2'>
        <SelectField
          id='adjust-currency'
          name='currency'
          label='Currency'
          value={currency}
          onChange={c => {
            setCurrency(c)
            setAmount(a => cleanAmount(a, decimalsOf(c)))
          }}
          options={codes.map(c => ({ value: c, label: c }))}
          hint={`Balance ${coinAmount(balance, currency)}`}
        />
        <div className='flex flex-col gap-2'>
          <span className='text-sm font-medium'>Operation</span>
          <div role='radiogroup' aria-label='Operation' className='bg-muted grid grid-cols-2 gap-1 rounded-lg p-1'>
            {(['credit', 'debit'] as const).map(op => (
              <button
                key={op}
                type='button'
                role='radio'
                aria-checked={operation === op}
                onClick={() => setOperation(op)}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors',
                  operation === op ? (op === 'credit' ? 'bg-success text-white' : 'bg-danger text-white') : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {op === 'credit' ? <PlusIcon className='size-3.5' /> : <MinusIcon className='size-3.5' />}
                {op === 'credit' ? 'Credit' : 'Debit'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <TextField
        id='adjust-amount'
        name='amount'
        label={`Amount (${currency})`}
        inputMode='decimal'
        autoComplete='off'
        placeholder={decimalsOf(currency) === 2 ? '0.00' : '0.00000000'}
        value={amount}
        onChange={e => setAmount(cleanAmount(e.target.value, decimalsOf(currency)))}
        hint={
          n > 0 ? (
            <>
              New balance <span className={cn('font-semibold', next < 0 ? 'text-danger' : 'text-foreground')}>{coinAmount(next, currency)}</span>
              {currency !== 'INR' && inrRate > 0 && <> · ≈ {formatIn(n * inrRate, 'INR')} {isCredit ? 'from' : 'back to'} your wallet</>}
            </>
          ) : (
            `Up to ${decimalsOf(currency)} decimals`
          )
        }
      />

      <TextField id='adjust-note' name='note' label='Note' placeholder='Optional reason, kept with the transaction' maxLength={200} value={note} onChange={e => setNote(e.target.value)} />

      <TextField
        id='adjust-password'
        name='transactionPassword'
        label='Transaction password'
        type='password'
        autoComplete='off'
        required
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
    </FormDialog>
  )
}

/** Ek user ki Transaction History — har coin, har row apna coin dikhati hai. */
const HistoryDialog = ({ user, onClose }: { user: DirectUserRow | null; onClose: () => void }) => {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)

  const list = usePagedApi<HistoryRow>(user ? `${BASE}/users/${user.id}/history` : null, {
    page,
    limit
  })

  const columns: Column<HistoryRow>[] = [
    {
      key: 'when',
      header: 'Date & Time',
      cell: r => (
        <span className='text-muted-foreground text-xs'>
          <DateTime value={r.createdAt} />
        </span>
      )
    },
    { key: 'coin', header: 'Coin', cell: r => <span className='text-xs font-bold uppercase'>{r.coin}</span> },
    {
      key: 'op',
      header: 'Operation',
      cell: r => {
        const isCredit = r.operation === 'credit'

        return (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize',
              isCredit ? 'bg-success-soft text-success border-success/30' : 'bg-danger-soft text-danger border-danger/30'
            )}
          >
            {isCredit ? <TrendingUpIcon className='size-3' /> : <TrendingDownIcon className='size-3' />}
            {r.operation}
          </span>
        )
      }
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <span className='font-mono text-xs font-semibold'>{r.amount}</span> },
    { key: 'prev', header: 'Prev balance', align: 'right', cell: r => <span className='text-muted-foreground font-mono text-xs'>{r.previousBalance}</span> },
    { key: 'new', header: 'New balance', align: 'right', cell: r => <span className='font-mono text-xs'>{r.newBalance}</span> },
    { key: 'note', header: 'Note', cell: r => <span className='text-muted-foreground block max-w-48 truncate text-xs'>{r.description || '—'}</span> }
  ]

  return (
    <Dialog open={!!user} onOpenChange={o => !o && onClose()}>
      <DialogContent className='sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <HistoryIcon className='text-muted-foreground size-5' /> Balance history
          </DialogTitle>
          <DialogDescription>
            {user?.name} · UID {user?.id}
          </DialogDescription>
        </DialogHeader>
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={setPage}
          onLimitChange={l => {
            setLimit(l)
            setPage(1)
          }}
          emptyMessage='No balance changes yet.'
          dense
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Wallets — the direct users' balances (players with no parent; agent-tree players are not here),
 * with Adjust balance (credit / debit one coin, transaction password) and each user's history.
 * Money moves against the Super Admin's Direct User wallet (`staff_balances`, kept in INR).
 * Totals are in the owner's default coin at the live rate (`useReportMoney`).
 */
const DirectUserWallet = () => {
  const { state, set, query } = useListState()
  const list = usePagedApi<DirectUserRow>(`${BASE}/users`, { limit: query.limit, page: query.page, search: query.search || undefined })
  const rates = useApi<CurrencyRate[]>(`${BASE}/currencies`)
  const wallet = useApi<OwnerWallet>('admin/exchange/owner/wallet')
  const enabled = useCurrencyCodes()
  const money = useReportMoney()

  // The owner's enabled coins that this wallet can move (have an INR rate). INR first.
  const codes = useMemo(() => {
    const allowed = new Set(enabled.map(c => c.toUpperCase()))
    const list = (rates.data ?? []).map(r => r.code.toUpperCase()).filter(c => c === 'INR' || allowed.has(c))

    return [...list.filter(c => c === 'INR'), ...list.filter(c => c !== 'INR')]
  }, [rates.data, enabled])

  const rateOf = useMemo(() => new Map((rates.data ?? []).map(r => [r.code.toUpperCase(), r.inrRate])), [rates.data])

  const [adjusting, setAdjusting] = useState<DirectUserRow | null>(null)
  const [historyUser, setHistoryUser] = useState<DirectUserRow | null>(null)

  /** A row's balances in the default coin; `partial` when a non-zero coin has no rate. */
  const totalOf = (row: DirectUserRow) => {
    const { value, partial } = money.sum(nonZero(row, codes).map(c => [row.balances[c], c] as const))

    return { sum: value, partial }
  }

  const rows = list.data?.rows
  const pageTotal = useMemo(() => (rows ?? []).reduce((acc, r) => acc + totalOf(r).sum, 0), [rows, codes, money]) // eslint-disable-line react-hooks/exhaustive-deps

  const pg = list.data?.pagination
  const offset = pg ? (pg.page - 1) * pg.limit : 0

  const columns: Column<DirectUserRow>[] = [
    { key: 'n', header: '#', cell: (_r, i) => <span className='text-muted-foreground text-xs'>{offset + i + 1}</span> },
    {
      key: 'user',
      header: 'User',
      cell: r => (
        <Link href={`/users/${r.id}`} className='flex min-w-0 items-center gap-3 hover:underline'>
          <PlayerAvatar name={r.name} avatar={r.avatar} className='size-8 text-[11px]' />
          <span className='truncate text-sm font-semibold'>{r.name}</span>
        </Link>
      )
    },
    { key: 'uid', header: 'UID', cell: r => <span className='bg-info/10 text-info rounded px-1.5 py-0.5 font-mono text-xs'>{r.id}</span> },
    {
      key: 'balances',
      header: 'Balances',
      cell: r => {
        const held = nonZero(r, codes)

        if (!held.length) return <span className='text-muted-foreground'>—</span>

        return (
          <div className='flex max-w-80 flex-wrap gap-1'>
            {held.map(c => (
              <span key={c} className='bg-muted rounded-md px-2 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums'>
                {coinAmount(r.balances[c], c)}
              </span>
            ))}
          </div>
        )
      }
    },
    {
      key: 'total',
      header: `Total (${money.code})`,
      align: 'right',
      cell: r => {
        const { sum, partial } = totalOf(r)

        return (
          <Tooltip>
            <TooltipTrigger render={<span className='font-semibold whitespace-nowrap tabular-nums' />}>
              {formatIn(sum, money.code)}
              {partial && <span className='text-muted-foreground'> +</span>}
            </TooltipTrigger>
            <TooltipContent>{partial ? 'Some coins have no exchange rate and are not in this total.' : `All coins at today’s rate, in ${money.code}.`}</TooltipContent>
          </Tooltip>
        )
      }
    },
    {
      key: 'status',
      header: 'Status',
      cell: r => {
        const active = !r.status || /^(active|1|enabled)$/i.test(String(r.status))

        return (
          <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-semibold capitalize', active ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            {active ? 'Active' : String(r.status).toLowerCase()}
          </span>
        )
      }
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <div className='flex justify-end gap-1.5' onClick={e => e.stopPropagation()}>
          <Button size='sm' variant='ghost' onClick={() => setHistoryUser(r)}>
            <HistoryIcon /> History
          </Button>
          <Button size='sm' variant='outline' onClick={() => setAdjusting(r)} disabled={!codes.length}>
            <SlidersHorizontalIcon /> Adjust balance
          </Button>
        </div>
      )
    }
  ]

  const directBalance = wallet.data?.directBalance

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Wallets'
        description='Balances of direct users (players who signed up on the site, no agent parent). Credit or debit a coin with Adjust balance; it moves against your Direct Users wallet.'
      />

      <div className='grid gap-4 sm:grid-cols-3'>
        <StatCard label='Direct users' value={(pg?.total ?? rows?.length ?? 0).toLocaleString('en-IN')} icon={<UsersIcon />} loading={list.isLoading} />
        <StatCard
          label={`Balance on this page (${money.code})`}
          value={formatIn(pageTotal, money.code)}
          hint='Every enabled coin, at today’s rate'
          icon={<WalletIcon />}
          loading={list.isLoading || !money.ready}
        />
        <StatCard
          label='Your Direct Users wallet'
          value={directBalance === undefined ? '—' : money.format(directBalance, 'INR')}
          hint={directBalance === undefined ? undefined : `${formatIn(Number(directBalance) || 0, 'INR')} held in INR`}
          icon={<WalletIcon />}
          loading={wallet.isLoading}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={pg}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        toolbar={
          <div className='flex w-full items-center gap-2'>
            <div className='relative w-full sm:w-72'>
              <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input value={String(state.search ?? '')} onChange={e => set({ search: e.target.value })} placeholder='Search by name or UID…' className='pl-8' />
            </div>
            <Button variant='outline' size='icon' title='Refresh' aria-label='Refresh' className='ml-auto' onClick={() => list.refetch()} disabled={list.isFetching}>
              <RefreshCwIcon className={cn(list.isFetching && 'animate-spin')} />
            </Button>
          </div>
        }
        emptyMessage={state.search ? 'No direct user matches your search.' : 'No direct users yet.'}
      />

      <AdjustDialog row={adjusting} codes={codes} rateOf={rateOf} onClose={() => setAdjusting(null)} />
      <HistoryDialog user={historyUser} onClose={() => setHistoryUser(null)} />
    </div>
  )
}

export default DirectUserWallet
