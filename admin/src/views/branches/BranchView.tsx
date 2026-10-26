'use client'

import { useState, type ReactNode } from 'react'

import Link from 'next/link'

import { ArrowDownToLineIcon, ArrowUpFromLineIcon, DicesIcon, ReceiptTextIcon, ScaleIcon, TrophyIcon, UserPlusIcon, UsersIcon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import TabbedPage from '@/components/shared/TabbedPage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { casinoSourceLabel } from '@/lib/casinoSource'
import { check } from '@/lib/validate'
import { defaultRange } from '@/views/exchange/reports/reportKit'

/**
 * One branch's screens, shared by the Super Admin (`base` = `admin/branches/<id>`) and the branch's
 * own panel (`base` = `admin/branches/portal`): the totals (the Dashboard's figures for the
 * branch's players), its players (and Create ID), their deposits / withdrawals (every rail, with
 * the payment method), their originals / casino / sports bets and their ledger.
 */

export type Branch = {
  id: number
  name: string
  username: string
  status: 'active' | 'inactive'
  createdAt: string
  lastLoginAt: string | null
  players?: number
}

export type BranchTotals = {
  deposits: string
  withdrawals: string
  net: string
  casinoWagered: string
  casinoWon: string
  casinoGgr: string
  sportsStaked: string
  sportsGgr: string
  registrations: number
  depositCount: number
  withdrawalCount: number
  casinoBets: number
  sportsBets: number
}

type Summary = { branch: Branch; players: number; currency: string; totals: BranchTotals; unconverted: unknown[] }

type Player = {
  id: string
  name: string
  email: string | null
  phone: string | null
  country?: string | null
  status: string | null
  createdAt: string
  lastIp?: string | null
  balances: Record<string, string>
}

/** Every report answers `{ rows, total, page, totalPages }`. */
type Report<T> = { rows: T[]; total: number; page: number; totalPages: number }

type LedgerRow = {
  id: string
  date: string
  category: string
  void: boolean
  currency: string
  credit: string
  debit: string
  closing: string
  description: string
  user: { id: string; name: string }
  bet: { sport: string | null; event: string | null; market: string | null; selection: string | null; side: string | null; odds: string | null; stake: string | null } | null
}

type MoneyRow = {
  id: string | number
  date: string | null
  method: string
  type: string
  amount: string
  currency: string | null
  status: string
  reference: string | null
  details: string | null
  user: { id: string; name: string | null }
}

type SportsBet = { id: string; ts: string; user: string; match: string | null; selection: string | null; market: string | null; side: string | null; odds: string | null; stake: string; status: string | null; result: string | null }

type CasinoBet = { id: string; ts: string; user: string; source: string; game: string | null; round: string | null; currency: string; stake: string | null; profit: string | null; amount: string | null; status: string | null }

export type BetKind = 'originals' | 'casino' | 'sports'

const CATEGORIES = ['ALL', 'DEPOSIT', 'WITHDRAW', 'SPORTS', 'CASINO', 'ORIGINAL_GAME', 'BONUS', 'ADMIN', 'TRANSFER', 'OTHER']
const MONEY_STATUSES = ['pending', 'approved', 'success', 'paid', 'completed', 'rejected', 'failed']

const METHOD_LABELS: Record<string, string> = { crypto: 'Crypto', manual: 'Bank / manual', apay: 'A-Pay', waypay: 'WayPay', f2pay: 'F2Pay' }

/** `{ from, to }` days (to included) as the half-open window the totals routes take. */
export const windowOf = (range: { from: string; to: string }) => ({
  from: new Date(`${range.from}T00:00:00`).toISOString(),
  to: new Date(new Date(`${range.to}T00:00:00`).getTime() + 86_400_000).toISOString()
})

const paginationOf = (data: Report<unknown> | undefined, page: number, limit: number) =>
  data && { page, limit, total: data.total, totalPages: data.totalPages, hasNext: page < data.totalPages, hasPrev: page > 1 }

/** A page title without PageHeader's breadcrumb (its Home link is the staff panel's). */
export const BranchTitle = ({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) => (
  <div className='mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3'>
    <div className='min-w-0'>
      <h1 className='text-heading text-xl font-semibold'>{title}</h1>
      {description && <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-[13px]'>{description}</div>}
    </div>
    {actions && <div className='flex flex-wrap items-center gap-2'>{actions}</div>}
  </div>
)

/**
 * The report filters every list shares, kept in the URL: a day range, a player (unless the page is
 * one player's), page and size. `extra` names the list's own filters.
 */
const useReportState = (extra: string[] = [], defaults: Record<string, string> = {}) => {
  const initial = defaultRange()
  const list = useListState(['userId', 'from', 'to', ...extra], { from: initial.from, to: initial.to, ...defaults })
  const page = Number(list.state.page) || 1
  const limit = Number(list.state.limit) || 50

  return { ...list, page, limit, from: String(list.state.from), to: String(list.state.to) }
}

const PlayerIdFilter = ({ value, onChange }: { value: string; onChange: (id: string | null) => void }) => {
  const [text, setText] = useState(value)

  return (
    <Input
      className='w-40'
      placeholder='Player ID'
      inputMode='numeric'
      value={text}
      onChange={e => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={() => onChange(text || null)}
      onKeyDown={e => e.key === 'Enter' && onChange(text || null)}
    />
  )
}

const PlayerCell = ({ id, name }: { id: string; name: string | null }) => (
  <span className='text-sm'>
    {name ?? '—'} <span className='text-muted-foreground font-mono text-xs'>{id}</span>
  </span>
)

// ══ Dashboard ════════════════════════════════════════════════════════════

const BranchSummary = ({ data, loading }: { data?: Summary; loading: boolean }) => {
  const t = data?.totals
  const cur = data?.currency

  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      <StatCard label='Players' value={data?.players ?? 0} hint={`${t?.registrations ?? 0} new in this period`} icon={<UsersIcon />} loading={loading} />
      <StatCard label='Total deposit' value={<Money value={t?.deposits} currency={cur} />} hint={`${t?.depositCount ?? 0} deposits`} icon={<ArrowDownToLineIcon />} loading={loading} />
      <StatCard label='Total withdraw' value={<Money value={t?.withdrawals} currency={cur} />} hint={`${t?.withdrawalCount ?? 0} withdrawals`} icon={<ArrowUpFromLineIcon />} loading={loading} />
      <StatCard label='Net (deposit − withdraw)' value={<Money value={t?.net} currency={cur} signed />} icon={<ScaleIcon />} loading={loading} />
      <StatCard label='Casino bets' value={<Money value={t?.casinoWagered} currency={cur} />} hint={<>{t?.casinoBets ?? 0} bets · won <Money value={t?.casinoWon} /></>} icon={<DicesIcon />} loading={loading} />
      <StatCard label='Casino GGR' value={<Money value={t?.casinoGgr} currency={cur} signed />} icon={<TrophyIcon />} loading={loading} />
      <StatCard label='Sports bets' value={<Money value={t?.sportsStaked} currency={cur} />} hint={`${t?.sportsBets ?? 0} bets`} icon={<ReceiptTextIcon />} loading={loading} />
      <StatCard label='Sports GGR' value={<Money value={t?.sportsGgr} currency={cur} signed />} icon={<TrophyIcon />} loading={loading} />
    </div>
  )
}

/** The branch's name, then its totals over a date range. */
export const BranchDashboard = ({ base, actions }: { base: string; actions?: ReactNode }) => {
  const [range, setRange] = useState(defaultRange())
  const q = useApi<Summary>(`${base}/summary`, windowOf(range))
  const branch = q.data?.branch

  return (
    <div>
      <BranchTitle
        title={branch?.name ?? 'Branch'}
        description={branch && <>Login <span className='font-mono'>{branch.username}</span> <StatusBadge value={branch.status} /></>}
        actions={actions}
      />
      <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>Totals for the period. Amounts in other coins are converted at today&apos;s rate.</p>
        <DateRangePicker from={range.from} to={range.to} max={defaultRange().to} clearable={false} onChange={r => setRange({ from: r.from, to: r.to })} />
      </div>
      <BranchSummary data={q.data} loading={q.isLoading} />
    </div>
  )
}

// ══ Users ════════════════════════════════════════════════════════════════

export const CreatePlayer = ({ base }: { base: string }) => {
  const empty = { username: '', password: '', confirm: '', email: '', phone: '' }
  const [form, setForm] = useState(empty)

  const create = useApiMutation({
    fn: () =>
      api.post(`${base}/players`, {
        username: form.username.trim(),
        password: form.password,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {})
      }),
    invalidate: [['paged', `${base}/players`], ['api', `${base}/summary`]],
    success: 'Player ID created',
    onSuccess: () => setForm(empty)
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <UserPlusIcon /> Create ID
        </Button>
      }
      title='Create a player ID'
      description='A site player of this branch: they sign in on the site, deposit and withdraw themselves.'
      submitLabel='Create'
      validate={() => ({
        username:
          check.required(form.username, 'Username') ||
          check.length(form.username, 'Username', { min: 3, max: 30 }) ||
          (!/^[A-Za-z0-9._-]+$/.test(form.username.trim()) && 'Username may contain letters, digits and . _ - only'),
        password: !form.password ? 'Password is required' : check.length(form.password, 'Password', { min: 8, max: 72 }),
        confirm: !form.confirm ? 'Confirm the password' : check.match(form.password, form.confirm, 'Passwords do not match')
      })}
      onSubmit={() => create.mutateAsync()}
    >
      <TextField id='bp-user' name='username' label='Username' required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='bp-pw' name='password' label='Password' type='password' required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <TextField id='bp-pw2' name='confirm' label='Confirm password' type='password' required value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
      </div>
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='bp-email' name='email' label='Email (optional)' type='email' value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <TextField id='bp-phone' name='phone' label='Phone (optional)' value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
      </div>
    </FormDialog>
  )
}

const Balances = ({ value }: { value: Record<string, string> }) => {
  const list = Object.entries(value)

  if (!list.length) return <span className='text-muted-foreground'>0</span>

  return (
    <div className='flex flex-col gap-0.5'>
      {list.map(([code, amount]) => (
        <Money key={code} value={amount} currency={code} />
      ))}
    </div>
  )
}

/** The branch's players; a row opens the player's page (`playerHref`). */
export const BranchPlayers = ({ base, playerHref }: { base: string; playerHref: (id: string) => string }) => {
  const { state, set, query } = useListState()
  const list = usePagedApi<Player>(`${base}/players`, { limit: query.limit, page: query.page, search: query.search })

  const columns: Column<Player>[] = [
    { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
    { key: 'name', header: 'Username', cell: r => <Link href={playerHref(r.id)} className='font-medium hover:underline'>{r.name}</Link> },
    { key: 'contact', header: 'Email / phone', cell: r => <span className='text-sm'>{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
    { key: 'balance', header: 'Balance', cell: r => <Balances value={r.balances} /> },
    { key: 'created', header: 'Created', cell: r => <DateTime value={r.createdAt} /> },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: r => (
        <Button variant='outline' size='sm' nativeButton={false} render={<Link href={playerHref(r.id)} />}>
          View
        </Button>
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
      searchPlaceholder='Username or ID…'
      toolbar={<CreatePlayer base={base} />}
    />
  )
}

// ══ Deposits / withdrawals ═══════════════════════════════════════════════

/** Every deposit or withdrawal request, on every rail and in every status, with its payment method. */
export const MoneyReport = ({ base, kind, userId }: { base: string; kind: 'deposits' | 'withdrawals'; userId?: string }) => {
  const r = useReportState(['status'])
  const player = userId ?? (r.state.userId ? String(r.state.userId) : undefined)

  const q = useApi<Report<MoneyRow>>(`${base}/${kind}`, {
    fromDate: r.from,
    toDate: r.to,
    status: r.state.status ? String(r.state.status) : undefined,
    userId: player,
    page: r.page,
    limit: r.limit
  })

  const columns: Column<MoneyRow>[] = [
    { key: 'date', header: 'Date', cell: x => <DateTime value={x.date} /> },
    ...(userId ? [] : [{ key: 'player', header: 'Player', cell: (x: MoneyRow) => <PlayerCell id={x.user.id} name={x.user.name} /> }]),
    {
      key: 'method',
      header: 'Payment method',
      cell: x => (
        <span className='flex flex-col'>
          <span className='text-sm font-medium'>{METHOD_LABELS[x.method] ?? x.method}</span>
          <span className='text-muted-foreground text-xs'>{x.type}</span>
        </span>
      )
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: x => <Money value={x.amount} currency={x.currency} /> },
    { key: 'status', header: 'Status', cell: x => <StatusBadge value={x.status} /> },
    { key: 'ref', header: 'Reference', cell: x => <span className='font-mono text-xs break-all'>{x.reference ?? '—'}</span> },
    { key: 'details', header: 'Details', cell: x => <span className='text-sm'>{x.details ?? '—'}</span> }
  ]

  return (
    <DataTable
      columns={columns}
      rows={q.data?.rows}
      rowKey={(x, i) => `${x.method}-${x.id}-${i}`}
      loading={q.isLoading}
      fetching={q.isFetching}
      error={q.error}
      pagination={paginationOf(q.data, r.page, r.limit)}
      onPageChange={page => r.set({ page })}
      onLimitChange={limit => r.set({ limit })}
      toolbar={
        <div className='flex flex-wrap items-center gap-2'>
          <DateRangePicker from={r.from} to={r.to} clearable={false} onChange={v => r.set({ from: v.from, to: v.to })} />
          <Select value={String(r.state.status || 'all')} onValueChange={v => v && r.set({ status: v === 'all' ? null : v })}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Any status</SelectItem>
              {MONEY_STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!userId && <PlayerIdFilter value={String(r.state.userId ?? '')} onChange={id => r.set({ userId: id })} />}
        </div>
      }
    />
  )
}

// ══ Originals / casino / sports ══════════════════════════════════════════

const sportsColumns = (withPlayer: boolean): Column<SportsBet>[] => [
  { key: 'ts', header: 'Date', cell: b => <DateTime value={b.ts} /> },
  ...(withPlayer ? [{ key: 'user', header: 'Player', cell: (b: SportsBet) => <span className='text-sm'>{b.user}</span> }] : []),
  { key: 'match', header: 'Match', cell: b => <span className='text-sm'>{b.match ?? '—'}</span> },
  { key: 'market', header: 'Market', cell: b => <span className='text-sm'>{b.market ?? '—'}</span> },
  { key: 'selection', header: 'Selection', cell: b => <span className='text-sm'>{b.selection ?? '—'}</span> },
  { key: 'side', header: 'Back / lay', cell: b => (b.side ? <Badge variant='outline'>{b.side}</Badge> : '—') },
  { key: 'odds', header: 'Odds', align: 'right', cell: b => <span className='tabular-nums'>{b.odds ?? '—'}</span> },
  { key: 'stake', header: 'Stake', align: 'right', cell: b => <Money value={b.stake} /> },
  { key: 'status', header: 'Status', cell: b => <StatusBadge value={b.status} /> },
  { key: 'result', header: 'Result', cell: b => <span className='text-sm'>{b.result ?? '—'}</span> }
]

const casinoColumns = (withPlayer: boolean): Column<CasinoBet>[] => [
  { key: 'ts', header: 'Date', cell: b => <DateTime value={b.ts} /> },
  ...(withPlayer ? [{ key: 'user', header: 'Player', cell: (b: CasinoBet) => <span className='text-sm'>{b.user}</span> }] : []),
  { key: 'game', header: 'Game', cell: b => <span className='text-sm'>{b.game ?? '—'}</span> },
  { key: 'source', header: 'Provider', cell: b => <Badge variant='outline'>{casinoSourceLabel(b.source)}</Badge> },
  { key: 'stake', header: 'Stake', align: 'right', cell: b => (b.stake == null ? '—' : <Money value={b.stake} currency={b.currency} />) },
  { key: 'amount', header: 'Wallet move', align: 'right', cell: b => (b.amount == null ? '—' : <Money value={b.amount} currency={b.currency} signed />) },
  { key: 'status', header: 'Status', cell: b => (b.status ? <StatusBadge value={b.status} /> : '—') }
]

/** Originals, casino or sports bets of the branch's players (or of one player). */
export const BetsReport = ({ base, kind, userId }: { base: string; kind: BetKind; userId?: string }) => {
  const r = useReportState()
  const player = userId ?? (r.state.userId ? String(r.state.userId) : undefined)

  const q = useApi<Report<SportsBet & CasinoBet>>(`${base}/bets`, { kind, fromDate: r.from, toDate: r.to, userId: player, page: r.page, limit: r.limit })
  const columns = (kind === 'sports' ? sportsColumns(!userId) : casinoColumns(!userId)) as Column<SportsBet & CasinoBet>[]

  return (
    <DataTable
      columns={columns}
      rows={q.data?.rows}
      rowKey={b => b.id}
      loading={q.isLoading}
      fetching={q.isFetching}
      error={q.error}
      pagination={paginationOf(q.data, r.page, r.limit)}
      onPageChange={page => r.set({ page })}
      onLimitChange={limit => r.set({ limit })}
      toolbar={
        <div className='flex flex-wrap items-center gap-2'>
          <DateRangePicker from={r.from} to={r.to} clearable={false} onChange={v => r.set({ from: v.from, to: v.to })} />
          {!userId && <PlayerIdFilter value={String(r.state.userId ?? '')} onChange={id => r.set({ userId: id })} />}
        </div>
      }
    />
  )
}

// ══ Statement ════════════════════════════════════════════════════════════

/** Every balance change of the branch's players (`point_ledger_direct`), newest first. */
export const BranchStatement = ({ base, userId }: { base: string; userId?: string }) => {
  const r = useReportState(['category'], { category: 'ALL' })
  const player = userId ?? (r.state.userId ? String(r.state.userId) : undefined)

  const q = useApi<Report<LedgerRow>>(`${base}/statement`, {
    fromDate: r.from,
    toDate: r.to,
    category: String(r.state.category || 'ALL'),
    userId: player,
    page: r.page,
    limit: r.limit
  })

  const columns: Column<LedgerRow>[] = [
    { key: 'date', header: 'Date', cell: x => <DateTime value={x.date} /> },
    ...(userId ? [] : [{ key: 'player', header: 'Player', cell: (x: LedgerRow) => <PlayerCell id={x.user.id} name={x.user.name} /> }]),
    {
      key: 'type',
      header: 'Type',
      cell: x => (
        <span className='flex gap-1'>
          <Badge variant='outline'>{x.category.replace('_', ' ').toLowerCase()}</Badge>
          {x.void && <Badge variant='secondary'>void</Badge>}
        </span>
      )
    },
    {
      key: 'desc',
      header: 'Description',
      cell: x =>
        x.bet ? (
          <span className='text-sm'>
            {[x.bet.sport, x.bet.event, x.bet.market, x.bet.selection].filter(Boolean).join(' · ')}
            {x.bet.stake && <span className='text-muted-foreground'> — {x.bet.side} {x.bet.odds} × {x.bet.stake}</span>}
          </span>
        ) : (
          <span className='text-sm'>{x.description || '—'}</span>
        )
    },
    { key: 'credit', header: 'Credit', align: 'right', cell: x => (x.credit === '-' ? '—' : <Money value={x.credit} className='text-success' />) },
    { key: 'debit', header: 'Debit', align: 'right', cell: x => (x.debit === '-' ? '—' : <Money value={x.debit} className='text-danger' />) },
    { key: 'closing', header: 'Balance', align: 'right', cell: x => (x.closing === '-' ? '—' : <Money value={x.closing} />) },
    { key: 'cur', header: 'Currency', cell: x => <span className='text-xs'>{x.currency}</span> }
  ]

  return (
    <DataTable
      columns={columns}
      rows={q.data?.rows}
      rowKey={x => x.id}
      loading={q.isLoading}
      fetching={q.isFetching}
      error={q.error}
      pagination={paginationOf(q.data, r.page, r.limit)}
      onPageChange={page => r.set({ page })}
      onLimitChange={limit => r.set({ limit })}
      toolbar={
        <div className='flex flex-wrap items-center gap-2'>
          <DateRangePicker from={r.from} to={r.to} clearable={false} onChange={v => r.set({ from: v.from, to: v.to })} />
          <Select value={String(r.state.category || 'ALL')} onValueChange={v => v && r.set({ category: v })}>
            <SelectTrigger className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c} value={c}>
                  {c === 'ALL' ? 'All types' : c.replace('_', ' ').toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!userId && <PlayerIdFilter value={String(r.state.userId ?? '')} onChange={id => r.set({ userId: id })} />}
        </div>
      }
    />
  )
}

// ══ Everything at once ═══════════════════════════════════════════════════

/** Every report as tabs — one player's page, and the Super Admin's view of a branch. */
const ReportTabs = ({ base, userId, players }: { base: string; userId?: string; players?: ReactNode }) => (
  <TabbedPage
    tabs={[
      ...(players ? [{ value: 'users', label: 'Users', render: () => players }] : []),
      { value: 'deposits', label: 'Deposits', render: () => <MoneyReport base={base} kind='deposits' userId={userId} /> },
      { value: 'withdrawals', label: 'Withdrawals', render: () => <MoneyReport base={base} kind='withdrawals' userId={userId} /> },
      { value: 'originals', label: 'Originals', render: () => <BetsReport base={base} kind='originals' userId={userId} /> },
      { value: 'casino', label: 'Casino', render: () => <BetsReport base={base} kind='casino' userId={userId} /> },
      { value: 'sports', label: 'Sports', render: () => <BetsReport base={base} kind='sports' userId={userId} /> },
      { value: 'statement', label: 'Statement', render: () => <BranchStatement base={base} userId={userId} /> }
    ]}
  />
)

/** The Super Admin's view of one branch: its dashboard, then every report. */
export const BranchDetail = ({ base, actions, playerHref }: { base: string; actions?: ReactNode; playerHref: (id: string) => string }) => (
  <div className='grid gap-6'>
    <BranchDashboard base={base} actions={actions} />
    <ReportTabs base={base} players={<BranchPlayers base={base} playerHref={playerHref} />} />
  </div>
)

/** One player of the branch: profile and balances, then their deposits, withdrawals, bets and ledger. */
export const PlayerPage = ({ base, userId, back }: { base: string; userId: string; back?: ReactNode }) => {
  const q = useApi<Player>(`${base}/players/${encodeURIComponent(userId)}`)
  const p = q.data

  return (
    <div className='grid gap-6'>
      <BranchTitle
        title={p?.name ?? 'Player'}
        description={p && <>ID <span className='font-mono'>{p.id}</span> <StatusBadge value={p.status} /></>}
        actions={back}
      />
      {q.error ? (
        <p className='text-danger text-sm'>{q.error instanceof Error ? q.error.message : 'Could not load the player'}</p>
      ) : (
        <Card className='py-0 shadow-none'>
          <CardContent className='grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4'>
            <div>
              <p className='text-muted-foreground text-xs uppercase'>Email</p>
              <p>{p?.email ?? '—'}</p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs uppercase'>Phone</p>
              <p>{p?.phone ?? '—'}</p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs uppercase'>Created</p>
              <DateTime value={p?.createdAt} />
            </div>
            <div>
              <p className='text-muted-foreground text-xs uppercase'>Balance</p>
              {p ? <Balances value={p.balances} /> : '—'}
            </div>
          </CardContent>
        </Card>
      )}
      <ReportTabs base={base} userId={userId} />
    </div>
  )
}
