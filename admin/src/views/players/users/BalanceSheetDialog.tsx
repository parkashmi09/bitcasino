'use client'

import { useState } from 'react'

import { HourglassIcon, ReceiptTextIcon, RefreshCwIcon, TrendingDownIcon, TrendingUpIcon, WalletIcon } from 'lucide-react'

import { useQueries } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import { formatIn, useReportMoney } from '@/components/shared/ReportMoney'
import { inrSign, localeFor } from '@/lib/format'
import { useApi } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useCurrencyCodes } from '@/views/finance/useCurrencyCodes'
import { Chip, StatCard, type Tone } from './shared'

/**
 * Direct user: `GET admin/reports/balance-sheet/:userId?currency&limit&offset`.
 * Client user (parent wala): `GET admin/reports/client-balance-sheet/:userId?limit&offset` — point ledger, INR.
 */
type Sheet = {
  subject: { id: string; name: string | null; email: string | null; agent: string | null }
  currency: string

  /** 'point_ledger' = client user (parent wala): sheet `mssports.point_ledger` se, INR. */
  source?: 'point_ledger'

  /** Client user only: the wallet's point buckets (casino = third-party games). */
  points?: { total: string; sports: string; casino: string; original?: string; upper: string; down: string; balance: string; credit: string }
  balance: { live: string; ledger: string; openExposure: string; unexplained: string; credited: string; debited: string }
  total: number
  rows: { ts: string; category: string; type: string; description: string; amount: string; balance?: string }[]
}

const LIMITS = [25, 50, 100, 200]


/** The route's page ceiling (reports.validators BALANCE_SHEET_MAX_ROWS): the merged view reads at most this per coin. */
const MAX_ROWS = 10_000

const fmt = (value: string | number | null | undefined, cur: string) =>
  `${cur === 'INR' ? inrSign() : ''}${(Number(value) || 0).toLocaleString(localeFor(cur), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur === 'INR' ? '' : ` ${cur}`}`

const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const CATEGORY_TONE: Record<string, Tone> = { Deposit: 'success', Withdrawal: 'danger', 'Withdrawal Taken': 'danger', Agent: 'info', Sports: 'warning', Casino: 'primary', 'Original Games': 'primary' }

/**
 * Balance Sheet — reference admin ka BalanceSheetDialog: user ka har paisa-move, running balance ke saath.
 * Upar: Current Balance, In Play (unsettled), Total Credit, Total Debit, Net. "Live" on ho to har 10s refresh.
 * Direct user: deposits / withdrawals / bets se. Client user (Agent System, parent hai, `client`):
 * `mssports.point_ledger` se, INR only (Balance = all_point_after).
 */
export const BalanceSheetView = ({
  userId,
  name,
  client = false,
  active = true,
  inDialog = false
}: {
  userId: string | null
  name?: string | null

  /** Client user (parent wala) — sheet point ledger se. */
  client?: boolean

  /** Fetch only while shown (dialog open / tab selected). */
  active?: boolean

  /** Dialog ke andar: title DialogTitle, body scroll karta hai. Page pe: card. */
  inDialog?: boolean
}) => {
  const currencies = useCurrencyCodes()
  const money = useReportMoney()

  const [limit, setLimit] = useState(50)
  const [page, setPage] = useState(0)
  const [live, setLive] = useState(true)

  const path = active && userId ? `admin/reports/${client ? 'client-balance-sheet' : 'balance-sheet'}/${userId}` : null
  const refetchInterval = live ? 10_000 : false

  // A client user's INR point ledger: the page as the server cuts it.
  const one = useApi<Sheet>(
    path && client ? path : null,
    { limit, offset: page * limit },
    { retry: false, refetchInterval, placeholderData: prev => prev }
  )

  // Every currency: the route is per currency, so each is read from the top far enough to cut this
  // page out of the merged, time-sorted list (at most MAX_ROWS per currency).
  const span = Math.min(MAX_ROWS, (page + 1) * limit)

  const many = useQueries({
    queries: (path && !client ? currencies : []).map(c => ({
      queryKey: ['api', path, { currency: c, limit: span, offset: 0 }],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Sheet>(path as string, { currency: c, limit: span, offset: 0 }, signal),
      retry: false,
      refetchInterval,
      placeholderData: (prev: Sheet | undefined) => prev
    }))
  })

  const sheets: Sheet[] = client ? (one.data ? [one.data] : []) : many.map(m => m.data).filter((x): x is Sheet => !!x)
  const loading = client ? !one.data : many.some(m => !m.data && !m.error)
  const error = client ? one.error : (many.find(m => m.error)?.error ?? null)
  const fetching = client ? one.isFetching : many.some(m => m.isFetching)
  const refetch = () => (client ? void one.refetch() : many.forEach(m => void m.refetch()))

  /** Every coin converted into the default coin; a client user's sheet is the agent system's INR points, never converted. */
  const converted = !client
  const curOf = (sh: Sheet) => (sh.currency || 'INR').toUpperCase()

  const total = (pick: (sh: Sheet) => string | number | undefined, abs = false) =>
    converted
      ? money.sum(sheets.map(sh => [abs ? Math.abs(Number(pick(sh) ?? 0)) : pick(sh), curOf(sh)] as const)).value
      : abs
        ? Math.abs(Number(sheets[0] ? pick(sheets[0]) : 0))
        : Number(sheets[0] ? pick(sheets[0]) : 0)

  const cur = converted ? money.code : sheets[0] ? curOf(sheets[0]) : 'INR'
  const show = (v: number) => (converted ? formatIn(v, money.code) : fmt(v, cur))
  const credited = total(sh => sh.balance.credited)
  const debited = total(sh => sh.balance.debited, true)
  const net = credited - debited
  const exposure = total(sh => sh.balance.openExposure)
  const liveBalance = total(sh => sh.balance.live)
  const ledgerBalance = total(sh => sh.balance.ledger)
  const unexplained = sheets.reduce((n, sh) => n + Math.abs(Number(sh.balance.unexplained ?? 0)), 0)
  const reconciled = unexplained === 0

  const rows = (
    converted
      ? sheets
          .flatMap(sh => sh.rows.map(r => ({ ...r, cur: curOf(sh) })))
          .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
          .slice(page * limit, (page + 1) * limit)
      : (sheets[0]?.rows ?? []).map(r => ({ ...r, cur: sheets[0] ? curOf(sheets[0]) : cur }))
  ) as (Sheet['rows'][number] & { cur: string })[]

  const rowTotal = sheets.reduce((n, sh) => n + (sh.total ?? 0), 0)
  const pages = Math.max(1, Math.ceil(rowTotal / limit))

  /** A ledger figure: converted with the native amount under it, or native. */
  const cell = (v: number, rowCur: string) =>
    converted ? (
      <span className='flex flex-col'>
        <span>{money.format(v, rowCur)}</span>
        {rowCur !== money.code && <span className='text-muted-foreground text-[11px] font-normal'>{fmt(v, rowCur)}</span>}
      </span>
    ) : (
      fmt(v, rowCur)
    )

  const Title = inDialog ? DialogTitle : 'h2'
  const Description = inDialog ? DialogDescription : 'p'

  return (
    <div className={cn('flex flex-col', inDialog ? 'min-h-0 flex-1' : 'bg-card overflow-hidden rounded-xl border')}>
        <div className={cn('border-b px-6 py-4', inDialog && 'pr-14')}>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <Title className='flex items-center gap-2 font-semibold'>
                <ReceiptTextIcon className='text-primary size-4' /> Balance Sheet
              </Title>
              <Description className='text-muted-foreground text-sm'>
                {sheets[0]?.subject.name || name || 'Player'} · <span className='font-mono'>UID {userId}</span>
                {sheets[0]?.subject.agent ? ` · under ${sheets[0].subject.agent}` : ''}
                {sheets[0]?.source === 'point_ledger' ? ' · from point ledger' : ''}
              </Description>
            </div>
            <div className='flex items-center gap-3'>
              <label className='text-muted-foreground flex items-center gap-2 text-xs'>
                <Switch checked={live} onCheckedChange={setLive} /> Live
              </label>
              <Button variant='ghost' size='icon-sm' title='Refresh' aria-label='Refresh' disabled={fetching} onClick={refetch}>
                <RefreshCwIcon className={cn(fetching && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </div>

        <div className={cn('flex flex-col gap-4 px-6 py-4', inDialog && 'min-h-0 flex-1 overflow-y-auto')}>
          {error && <p className='text-danger text-sm'>{errorMessage(error)}</p>}
          {converted && (
            <p className='text-muted-foreground text-xs'>
              Every currency figure converted into {money.code} at today’s rate.
            </p>
          )}

          {/* Agent system (user, 2026-10-17): points by game, no credit / debit. */}
          {client ? (
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-6'>
              <StatCard label='Balance' value={show(liveBalance)} icon={<WalletIcon />} tone='primary' loading={loading} />
              <StatCard label='Credit' value={show(Number(sheets[0]?.points?.credit ?? 0))} icon={<TrendingDownIcon />} tone='danger' loading={loading} />
              <StatCard label='Total Points' value={show(Number(sheets[0]?.points?.total ?? 0))} icon={<ReceiptTextIcon />} tone='success' loading={loading} />
              <StatCard label='Sports Points' value={show(Number(sheets[0]?.points?.sports ?? 0))} icon={<TrendingUpIcon />} tone='warning' loading={loading} />
              <StatCard label='Casino Points' value={show(Number(sheets[0]?.points?.casino ?? 0))} icon={<ReceiptTextIcon />} tone='info' loading={loading} />
              <StatCard label='Original Points' value={show(Number(sheets[0]?.points?.original ?? 0))} icon={<ReceiptTextIcon />} tone='info' loading={loading} />
            </div>
          ) : (
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
            <StatCard label='Current Balance' value={show(liveBalance)} icon={<WalletIcon />} tone='primary' loading={loading} />
            {exposure > 0 && <StatCard label='In Play (Unsettled)' value={show(exposure)} icon={<HourglassIcon />} tone='warning' />}
            <StatCard label='Total Credit' value={show(credited)} icon={<TrendingUpIcon />} tone='success' loading={loading} />
            <StatCard label='Total Debit' value={show(debited)} icon={<TrendingDownIcon />} tone='danger' loading={loading} />
            <StatCard label='Net' value={show(net)} icon={<ReceiptTextIcon />} tone={net >= 0 ? 'success' : 'danger'} loading={loading} />
          </div>
          )}

          {!loading && sheets.length > 0 && (
            <p className='bg-muted/40 rounded-md border px-3 py-2 text-sm'>
              Current Balance <b>{show(liveBalance)}</b>
              {exposure > 0 && (
                <>
                  {' + '}In Play <b className='text-warning'>{show(exposure)}</b>
                </>
              )}
              {' · '}Ledger <b>{show(ledgerBalance)}</b>{' '}
              <span className={cn('font-semibold', reconciled ? 'text-success' : 'text-danger')}>
                {reconciled
                  ? '✓ reconciled'
                  : `⚠ mismatch ${sheets
                      .filter(sh => Number(sh.balance.unexplained ?? 0) !== 0)
                      .map(sh => fmt(sh.balance.unexplained, curOf(sh)))
                      .join(', ')} — needs review`}
              </span>
            </p>
          )}

          {/* shrink-0: a clipped flex item would otherwise shrink to the dialog and hide rows instead of scrolling. */}
          <div className='shrink-0 overflow-hidden rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  {(client ? ['Date', 'Type', 'Description', 'Points', 'Balance'] : ['Date', 'Type', 'Description', 'Credit', 'Debit', 'Balance']).map(h => (
                    <TableHead key={h} className='text-xs uppercase'>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <Skeleton className='h-5 w-full' />
                        </TableCell>
                      </TableRow>
                    ))
                  : rows.map((r, i) => {
                      const amount = Number(r.amount)

                      return (
                        <TableRow key={`${r.cur}-${r.ts}-${i}`}>
                          <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>{fmtDate(r.ts)}</TableCell>
                          <TableCell>
                            <Chip tone={CATEGORY_TONE[r.category] ?? 'info'}>{r.category}</Chip>
                          </TableCell>
                          <TableCell className='max-w-96 text-sm break-words whitespace-normal'>{r.description}</TableCell>
                          {client ? (
                            <TableCell className={cn('font-semibold whitespace-nowrap', amount < 0 ? 'text-danger' : 'text-success')}>{cell(amount, r.cur)}</TableCell>
                          ) : (
                            <>
                              <TableCell className='text-success font-semibold whitespace-nowrap'>{amount > 0 ? cell(amount, r.cur) : ''}</TableCell>
                              <TableCell className='text-danger font-semibold whitespace-nowrap'>{amount < 0 ? cell(Math.abs(amount), r.cur) : ''}</TableCell>
                            </>
                          )}
                          <TableCell className={cn('font-semibold whitespace-nowrap', Number(r.balance) < 0 && 'text-danger')}>{r.balance !== undefined ? cell(Number(r.balance), r.cur) : ''}</TableCell>
                        </TableRow>
                      )
                    })}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className='text-muted-foreground py-8 text-center'>
                      {converted ? 'No transactions for this user.' : `No transactions in ${cur} for this user.`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-6 py-2 text-sm'>
          <label className='flex items-center gap-2'>
            Rows
            <select className='bg-background rounded border px-1 py-0.5' value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(0) }}>
              {LIMITS.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span>
            {rowTotal ? `${page * limit + 1}–${Math.min((page + 1) * limit, rowTotal)} of ${rowTotal}` : '0 rows'}
          </span>
          <div className='flex gap-1'>
            <Button variant='outline' size='sm' disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              Prev
            </Button>
            <Button variant='outline' size='sm' disabled={page + 1 >= pages || (converted && !client && (page + 1) * limit >= MAX_ROWS)} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
    </div>
  )
}

const BalanceSheetDialog = ({
  userId,
  name,
  client = false,
  open,
  onOpenChange
}: {
  userId: string | null
  name?: string | null
  client?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className='flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl'>
      <BalanceSheetView userId={userId} name={name} client={client} active={open} inDialog />
    </DialogContent>
  </Dialog>
)

export default BalanceSheetDialog
