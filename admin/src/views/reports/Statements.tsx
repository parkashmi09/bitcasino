'use client'

import { useMemo, useState } from 'react'

import Link from 'next/link'

import { DownloadIcon, Loader2Icon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import ErrorState from '@/components/shared/ErrorState'
import JsonView from '@/components/shared/JsonView'
import Money from '@/components/shared/Money'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useListState, usePagedApi } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'
import { formatMoney, formatNumber } from '@/lib/format'

import { ACCOUNT_TYPES, STATEMENT_CATEGORIES, STATEMENT_CATEGORY_LABEL as CATEGORY_LABEL, STATEMENT_KIND_LABEL, daysAgo, downloadBlob, type Statement, type StatementRow, type TransferRow } from './types'

// Staff ka alag page nahi (agent wala system Sports Exchange me hai) — sirf naam; user ka link.
const party = (p: TransferRow['from']) => {
  const label = (
    <>
      {p.name ?? `${p.type} #${p.id}`}
      <span className='text-muted-foreground text-xs'> ({p.type})</span>
    </>
  )

  return p.type === 'staff' ? <span>{label}</span> : <Link href={`/users/${p.id}`} className='hover:underline'>{label}</Link>
}

const transferColumns: Column<TransferRow>[] = [
  { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
  { key: 'from', header: 'From', cell: r => party(r.from) },
  { key: 'to', header: 'To', cell: r => party(r.to) },
  { key: 'dir', header: 'Direction', cell: r => <StatusBadge value={r.direction} /> },
  { key: 'type', header: 'Type', cell: r => (r.transferType ? <Badge variant='outline'>{r.transferType}</Badge> : '—') },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} /> },
  { key: 'note', header: 'Note', cell: r => <span className='text-muted-foreground text-sm'>{r.note ?? ''}</span> }
]

/** Display-only sum of the amounts on this page (the wire carries decimal strings). */
const sumAmounts = (rows: { amount: string }[] | undefined) => rows?.reduce((acc, r) => acc + Number(r.amount || 0), 0) ?? 0

/** Transfers — Direct Users | Agent Users tab (`channel`): direct = jisme ek taraf direct user ho. */
const TransfersTab = ({ channel }: { channel: Channel }) => {
  const { state, set, query } = useListState(['accountType', 'accountId', 'from', 'to'])

  const list = usePagedApi<TransferRow>('admin/accounts/statement', {
    limit: query.limit,
    page: query.page,
    accountType: query.accountId ? query.accountType || 'user' : undefined,
    accountId: query.accountId,
    from: query.from,
    to: query.to,
    channel
  })

  const rows = list.data?.rows
  const pageTotal = useMemo(() => sumAmounts(rows), [rows])

  return (
    <div className='grid gap-4'>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Transfers' value={formatNumber(list.data?.pagination.total)} hint='matching the filter' loading={list.isLoading} />
        <StatCard label='This page' value={formatMoney(pageTotal)} hint={`${rows?.length ?? 0} rows summed`} loading={list.isLoading} />
        <StatCard label='Account' value={state.accountId ? `${state.accountType || 'user'} #${state.accountId}` : 'Whole tree'} />
        <StatCard label='Period' value={state.from || state.to ? `${state.from || '…'} → ${state.to || '…'}` : 'All time'} />
      </div>
      <DataTable
        columns={transferColumns}
        rows={rows}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        toolbar={
          <>
            <Select value={String(state.accountType || 'user')} onValueChange={v => v && set({ accountType: v })}>
              <SelectTrigger className='w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map(t => (
                  <SelectItem key={t} value={t}>
                    {t === 'user' ? 'User' : 'Staff'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder='Account id (blank = whole tree)' className='w-56' value={String(state.accountId ?? '')} onChange={e => set({ accountId: e.target.value.replace(/\D/g, '') })} />
            <DateRangePicker aria-label='Date range' from={String(state.from ?? '')} to={String(state.to ?? '')} onChange={set} />
          </>
        }
        dense
      />
    </div>
  )
}

const statementColumns: Column<StatementRow>[] = [
  { key: 'ts', header: 'When', cell: r => <DateTime value={r.ts} /> },
  { key: 'kind', header: 'Kind', cell: r => <Badge variant='outline'>{STATEMENT_KIND_LABEL[r.kind] ?? r.kind}</Badge> },
  { key: 'label', header: 'Entry', cell: r => <span>{r.label}{r.legacy ? <Badge variant='secondary' className='ml-1 font-normal'>{r.legacy}</Badge> : null}</span> },
  { key: 'party', header: 'Counterparty', cell: r => (typeof r.party === 'string' ? r.party : r.party ? String(r.party.name ?? r.party.id ?? '') : '—') },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} signed /> },
  { key: 'balance', header: 'Balance', align: 'right', cell: r => <Money value={r.balance} /> },
  { key: 'note', header: 'Note', cell: r => <span className='text-muted-foreground text-sm'>{r.note ?? ''}</span> }
]

const StatementTab = () => {
  const [form, setForm] = useState({ subject: 'user', id: '', from: daysAgo(30), to: daysAgo(0), category: 'all' })
  const [applied, setApplied] = useState<typeof form | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(100)
  const [betKind, setBetKind] = useState('sports')
  const [betPage, setBetPage] = useState(1)

  const base = applied ? (applied.subject === 'user' ? `admin/statements/user/${applied.id}` : `admin/statements/${applied.id}`) : null

  // A user's statement is per wallet: the site's default coin (no currency picker). A staff statement is INR points.
  const wallet = useDefaultCurrency().code
  const range = applied ? { from: applied.from || undefined, to: applied.to || undefined, ...(applied.subject === 'user' ? { currency: wallet } : {}) } : {}
  const stmt = useApi<Statement>(base ? `${base}/statement` : null, { ...range, category: applied?.category, page, limit })
  const bets = usePagedApi<Record<string, unknown>>(base ? `${base}/bets` : null, { ...range, kind: betKind, page: betPage, limit: 50 })
  const s = stmt.data

  const [downloading, setDownloading] = useState(false)

  const pdf = async () => {
    if (!base || !applied) return
    setDownloading(true)

    try {
      const blob = await api.blob(`${base}/pdf`, { ...range, category: applied.category })

      downloadBlob(blob, `statement-${applied.subject}-${applied.id}.pdf`)
      toast.success('Statement PDF downloaded')
    } catch (e) {
      toast.error(`PDF download failed: ${errorMessage(e)}`)
    } finally {
      setDownloading(false)
    }
  }

  const betRows = bets.data?.rows
  const betKeys = betRows?.length ? Object.keys(betRows[0]) : []
  const betColumns: Column<Record<string, unknown>>[] = betKeys.map(k => ({ key: k, header: k, cell: r => <span className='text-xs'>{typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : String(r[k] ?? '—')}</span> }))

  return (
    <div className='grid gap-4'>
      <Card className='shadow-none'>
        <CardContent className='flex flex-wrap items-end gap-3'>
          <Select value={form.subject} onValueChange={v => v && setForm({ ...form, subject: v })}>
            <SelectTrigger className='w-28'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='user'>User</SelectItem>
              <SelectItem value='staff'>Staff</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder='Account id' className='w-40' value={form.id} onChange={e => setForm({ ...form, id: e.target.value.replace(/\D/g, '') })} />
          <DateRangePicker aria-label='Statement period' from={form.from} to={form.to} onChange={r => setForm({ ...form, ...r })} />
          <Select value={form.category} onValueChange={v => v && setForm({ ...form, category: v })}>
            <SelectTrigger className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATEMENT_CATEGORIES.map(c => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!form.id}
            onClick={() => {
              setApplied(form)
              setPage(1)
              setBetPage(1)
            }}
          >
            <SearchIcon /> Load statement
          </Button>
          <Button variant='outline' disabled={!applied || downloading} onClick={pdf}>
            {downloading ? <Loader2Icon className='animate-spin' /> : <DownloadIcon />} PDF
          </Button>
        </CardContent>
      </Card>

      {stmt.error && <ErrorState error={stmt.error} />}
      {!applied && <p className='text-muted-foreground text-sm'>Enter a user or staff id and a period to load their statement.</p>}

      {s && (
        <>
          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
                {s.subject.type === 'USER' ? (
                  <Link href={`/users/${s.subject.id}`} className='hover:underline'>
                    {s.subject.name}
                  </Link>
                ) : (
                  <span>{s.subject.name}</span>
                )}
                <Badge variant='secondary'>{s.subject.role}</Badge>
                {s.subject.parentName && <span className='text-muted-foreground text-sm font-normal'>under {s.subject.parentName}</span>}
                {applied?.subject === 'user' && s.currency && <Badge variant='outline'>{s.currency}</Badge>}
                <span className='text-muted-foreground ml-auto text-sm font-normal'>
                  {s.period.from ?? 'start'} → {s.period.to ?? 'now'} · {s.category}
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            <StatCard label='Opening' value={<Money value={s.balance.opening} currency={s.currency} />} hint='balance before the period' />
            <StatCard label='Closing' value={<Money value={s.balance.closing} currency={s.currency} />} hint={<>live <Money value={s.balance.live} currency={s.currency} /></>} />
            <StatCard label='Total in' value={<Money value={s.balance.totalIn} currency={s.currency} />} hint={<span title='Credits the upline (agent or staff) transferred to this account in the period. Gateway and bank deposits are in the rows, not in this figure.'>credits from upline <Money value={s.balance.depositIn} /></span>} />
            <StatCard label='Total out' value={<Money value={s.balance.totalOut} currency={s.currency} />} hint={<>withdrawals <Money value={s.balance.withdrawOut} /></>} />
            <StatCard label='Movement' value={<Money value={s.balance.movement} currency={s.currency} signed />} hint={
                <>
                  unexplained <Money value={s.balance.unexplained} />
                  {/* The period can add up while the account as a whole does not (live ≠ ledger). */}
                  {Number(s.balance.lifetimeUnreconciled ?? 0) !== 0 && (
                    <>
                      {' · all time '}
                      <Money value={s.balance.lifetimeUnreconciled} />
                    </>
                  )}
                </>
              }
            />
            <StatCard label='Open exposure' value={<Money value={s.balance.openExposure} />} />
            {s.balance.adminCredit !== undefined && (
              <StatCard
                label='Admin credit'
                value={<Money value={s.balance.adminCredit} currency={s.currency} />}
                hint={<>not a deposit · bonuses, swaps net <Money value={s.balance.otherNet} signed /></>}
              />
            )}
            <StatCard label='Sports P&L' value={<Money value={s.gaming.total.headlineSports} currency={s.currency} signed />} hint={`${formatNumber(s.gaming.counts.settledBets)} settled · ${formatNumber(s.gaming.counts.openBets)} open`} />
            <StatCard label='Casino P&L' value={<Money value={s.gaming.total.headlineCasino} currency={s.currency} signed />} hint={`${formatNumber(s.gaming.counts.casinoBets)} bets · ${formatNumber(s.gaming.counts.casinoWins)} wins`} />
          </div>

          <Tabs defaultValue='rows'>
            <TabsList className='mb-4'>
              <TabsTrigger value='rows'>Statement rows</TabsTrigger>
              <TabsTrigger value='bets'>Bets</TabsTrigger>
              <TabsTrigger value='raw'>Everything else</TabsTrigger>
            </TabsList>
            <TabsContent value='rows'>
              <DataTable
                columns={statementColumns}
                rows={s.rows}
                rowKey={r => r.id}
                loading={stmt.isLoading}
                fetching={stmt.isFetching}
                pagination={{ ...s.pagination, hasNext: s.pagination.page < s.pagination.totalPages, hasPrev: s.pagination.page > 1 }}
                onPageChange={setPage}
                onLimitChange={l => {
                  setLimit(l)
                  setPage(1)
                }}
                dense
              />
            </TabsContent>
            <TabsContent value='bets'>
              <DataTable
                columns={betColumns.length ? betColumns : [{ key: 'none', header: 'Bets', cell: () => null }]}
                rows={betRows}
                rowKey={(r, i) => String(r.id ?? i)}
                loading={bets.isLoading}
                error={bets.error}
                pagination={bets.data?.pagination}
                onPageChange={setBetPage}
                toolbar={
                  <Select value={betKind} onValueChange={v => v && (setBetKind(v), setBetPage(1))}>
                    <SelectTrigger className='w-32'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='sports'>Sports</SelectItem>
                      <SelectItem value='casino'>Casino</SelectItem>
                    </SelectContent>
                  </Select>
                }
                emptyMessage={`No ${betKind} bets in this period.`}
                dense
              />
            </TabsContent>
            <TabsContent value='raw'>
              <JsonView value={{ balance: s.balance, gaming: s.gaming, daily: s.daily, sportsDaily: s.sportsDaily, casinoDaily: s.casinoDaily, players: s.players }} className='max-h-[32rem]' />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

/**
 * The account statement reads `admin/statements` (reports:read); the transfer list reads
 * `admin/accounts/statement` (users:read). Each tab shows only for the grant it needs.
 */
const Statements = () => {
  const { can } = useSession()
  const canStatement = can('reports:read')
  const canTransfers = can('users:read')

  return (
    <div>
      <PageHeader title='Statements' description='Transfers between accounts in your tree, and the full account statement for one user or staff member.' />
      <Tabs defaultValue={canStatement ? 'statement' : 'transfers'}>
        <TabsList className='mb-4'>
          {canStatement && <TabsTrigger value='statement'>Account statement</TabsTrigger>}
          {canTransfers && <TabsTrigger value='transfers'>Transfers</TabsTrigger>}
        </TabsList>
        {canStatement && (
          <TabsContent value='statement'>
            <StatementTab />
          </TabsContent>
        )}
        {canTransfers && (
          <TabsContent value='transfers'>
            <ChannelTabs>{channel => <TransfersTab channel={channel} />}</ChannelTabs>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

export default Statements
