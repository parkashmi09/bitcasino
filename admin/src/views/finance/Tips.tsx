'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import { HandCoinsIcon, Loader2Icon, RotateCcwIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import { TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, useListState } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import type { Pagination } from '@/lib/api/types'
import { formatNumber } from '@/lib/format'
import RewardStats from '@/views/promotions/RewardStats'
import { useStatsFilters } from '@/components/shared/charts'

import type { TipList, TipParty, TipRow } from './types'

/**
 * `GET admin/user/tip/list` — validator is strict: `limit` (≤ 200), `offset`, `search`
 * (sender OR receiver username), `currency`, `from` / `to` (YYYY-MM-DD, inclusive). It answers
 * `{ rows, total, summary }` rather than `meta.pagination`, so the page is worked out here.
 */
const LIST = 'admin/user/tip/list'
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 350

/**
 * `GET / PUT admin/site-config/tips` — the operator's tip limits, decimal strings in the site's
 * default coin (`currency`, e.g. INR; the `*Usd` names are history) (`config:read` / `config:write`, house staff only). "0" on a max = no cap; "0" on the
 * wager requirement = off. The PUT is a patch validated as decimals ≥ 0 with ≤ 8 dp.
 */
const LIMITS = 'admin/site-config/tips'

type TipLimits = { maxPerTipUsd: string; maxPerDayUsd: string; minWageredUsd: string; currency: string; configured: boolean }

/** "500.00000000" → "500" for editing; the backend stores exact decimals either way. */
const trimDecimal = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v)

const USD_DECIMAL = /^\d{1,12}(\.\d{1,8})?$/

const LimitsCard = () => {
  const q = useApi<TipLimits>(LIMITS, undefined, { retry: false })

  return (
    <Card className='mb-6 max-w-3xl shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Limits</CardTitle>
        <CardDescription>
          Caps on what one player can tip, in the site&apos;s default currency{q.data ? ` (${q.data.currency})` : ''}. A tip in
          any other coin is converted with Exchange rates when it is sent; a currency without a rate cannot be tipped while
          a cap is on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* The form is keyed on the saved values, so a save or refetch resets it to what is stored. */}
        {q.error ? (
          <ErrorState error={q.error} title='Could not load tip limits' />
        ) : (
          <LimitsForm key={q.data ? JSON.stringify(q.data) : 'loading'} saved={q.data} />
        )}
      </CardContent>
    </Card>
  )
}

const LimitsForm = ({ saved }: { saved?: TipLimits }) => {
  const { can } = useSession()
  const writable = can('config:write')

  const [perTip, setPerTip] = useState(saved ? trimDecimal(saved.maxPerTipUsd) : '')
  const [perDay, setPerDay] = useState(saved ? trimDecimal(saved.maxPerDayUsd) : '')
  const [minWagered, setMinWagered] = useState(saved ? trimDecimal(saved.minWageredUsd) : '')

  const unit = saved?.currency ?? ''
  const values = [perTip, perDay, minWagered].map(v => v.trim())
  const fieldError = (v: string) => (v !== '' && !USD_DECIMAL.test(v) ? 'Use a plain number (≥ 0) with at most 8 decimal places' : undefined)
  const errors = values.map(fieldError)
  const invalid = errors.some(Boolean)

  const save = useApiMutation({
    fn: () =>
      api.put<TipLimits>(LIMITS, {
        maxPerTipUsd: values[0] || '0',
        maxPerDayUsd: values[1] || '0',
        minWageredUsd: values[2] || '0'
      }),
    invalidate: [['api', LIMITS]],
    success: 'Tip limits saved'
  })

  const decimal = (v: string) => v.replace(/[^\d.]/g, '')

  return (
    <form
      className='grid gap-4'
      onSubmit={e => {
        e.preventDefault()

        if (invalid) {
          toast.error('Fix the highlighted limits before saving')

          return
        }

        save.mutate()
      }}
    >
      <div className='grid gap-4 sm:grid-cols-3'>
        <TextField
          id='tipMaxPerTip'
          label={`Max per tip (${unit})`}
          hint='0 = no cap'
          inputMode='decimal'
          value={perTip}
          error={errors[0]}
          onChange={e => setPerTip(decimal(e.target.value))}
          disabled={!writable}
        />
        <TextField
          id='tipMaxPerDay'
          label={`Max per day (${unit})`}
          hint='A player’s tips in the last 24 hours, all currencies. 0 = no cap'
          inputMode='decimal'
          value={perDay}
          error={errors[1]}
          onChange={e => setPerDay(decimal(e.target.value))}
          disabled={!writable}
        />
        <TextField
          id='tipMinWagered'
          label={`Wagered before tipping (${unit})`}
          hint='Lifetime wager a player needs before they can send a tip. 0 = off'
          inputMode='decimal'
          value={minWagered}
          error={errors[2]}
          onChange={e => setMinWagered(decimal(e.target.value))}
          disabled={!writable}
        />
      </div>
      {writable ? (
        <Button type='submit' disabled={save.isPending || !saved || invalid} className='justify-self-start'>
          {save.isPending && <Loader2Icon className='animate-spin' />}
          Save
        </Button>
      ) : (
        <p className='text-muted-foreground text-xs'>Read-only: changing these needs the config:write permission.</p>
      )}
    </form>
  )
}

const Player = ({ p }: { p: TipParty | null | undefined }) => {
  if (!p?.id) return <span className='text-muted-foreground'>—</span>

  return (
    <Link href={`/users/${p.id}`} className='text-sm hover:underline' onClick={e => e.stopPropagation()}>
      {p.name ?? `#${p.id}`}
      <span className='text-muted-foreground ml-1 font-mono text-xs'>#{p.id}</span>
    </Link>
  )
}

const columns: Column<TipRow>[] = [
  { key: 'at', header: 'Date / time', cell: r => <DateTime value={r.createdAt} /> },
  { key: 'from', header: 'From', cell: r => <Player p={r.from} /> },
  { key: 'to', header: 'To', cell: r => <Player p={r.to} /> },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
  {
    key: 'note',
    header: 'Note',
    className: 'max-w-72',
    cell: r =>
      r.note ? (
        <span className='block truncate text-sm' title={r.note}>
          {r.note}
        </span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      )
  },
  { key: 'id', header: 'Tip ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> }
]

/** Ek tab ki tips list — channel tip PAANE wale (receiver) ke hisaab se: agent ke users tip bhej nahi sakte, sirf paa sakte hain. */
const TipsList = ({ channel }: { channel: Channel }) => {
  const { state, set, query } = useListState()

  // The charts' filter bar drives the table too: its period (inclusive UTC days). Every currency.
  const f = useStatsFilters({ defaultPreset: '30d' })

  // A new period starts the table again at page 1 (not on first load: keep a deep link).
  const filterKey = `${f.from}|${f.to}`
  const lastFilterKey = useRef(filterKey)

  useEffect(() => {
    if (lastFilterKey.current === filterKey) return
    lastFilterKey.current = filterKey
    set({ page: 1 })
  }, [filterKey, set])

  // The box updates at once; the URL (and so the request) only once typing pauses.
  const [term, setTerm] = useState(String(state.search ?? ''))

  useEffect(() => {
    const next = term.trim()

    if (next === String(state.search ?? '')) return
    const t = setTimeout(() => set({ search: next }), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(t)
  }, [term, state.search, set])

  const page = Math.max(Number(query.page ?? 1), 1)

  const list = useApi<TipList>(
    LIST,
    {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      channel,
      search: query.search,
      from: f.from,
      to: f.to
    },
    { placeholderData: prev => prev, retry: false }
  )

  const total = Number(list.data?.total ?? 0)
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  const pagination: Pagination | undefined = list.data
    ? { page, limit: PAGE_SIZE, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
    : undefined

  const filtered = Boolean(query.search || f.preset !== '30d')
  const summary = list.data?.summary

  const reset = () => {
    setTerm('')
    set({ search: '' })
    f.set({ preset: '30d' })
  }

  return (
    <div>
      {!list.error && (
        <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
          <StatCard
            label='Total tips'
            value={formatNumber(summary?.totalTips ?? 0)}
            icon={<HandCoinsIcon />}
            loading={list.isLoading}
          />
          {summary?.byCurrency.map(c => (
            <StatCard
              key={c.currency}
              label={c.currency}
              value={<Money value={c.amount} currency={c.currency} />}
              hint={`${formatNumber(c.count)} ${c.count === 1 ? 'tip' : 'tips'}`}
            />
          ))}
        </div>
      )}

      <div className='mb-4 flex flex-wrap items-center gap-3'>
        <div className='relative w-full sm:w-72'>
          <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            placeholder='Sender or receiver username'
            aria-label='Username'
            value={term}
            onChange={e => setTerm(e.target.value)}
            className='pl-8'
          />
        </div>
        <Button variant='outline' onClick={reset} disabled={!filtered && !term}>
          <RotateCcwIcon /> Reset
        </Button>
      </div>

      {list.error ? (
        <div className='space-y-3'>
          <ErrorState error={list.error} title='Could not load tips' />
          <Button variant='outline' onClick={() => void list.refetch()} disabled={list.isFetching}>
            <RotateCcwIcon /> Retry
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={r => String(r.id)}
          loading={list.isLoading}
          fetching={list.isFetching}
          pagination={pagination}
          onPageChange={p => set({ page: p })}
          emptyMessage={filtered ? 'No tips match these filters.' : 'No tips yet'}
        />
      )}
    </div>
  )
}

const Tips = () => {
  const { actor, can } = useSession()
  const f = useStatsFilters({ defaultPreset: '30d' })

  // Same gate as the welcome-bonus settings: config:read to see, house staff only (not the agent tree).
  const showLimits = Boolean(actor?.promotions) && can('config:read')

  return (
    <div>
      <PageHeader title='Tips' description='Player-to-player tips, newest first. The charts, totals and table all follow the period below; totals are in the site’s default coin.' />

      {showLimits && <LimitsCard />}

      <RewardStats section='tips' filters={f} />

      <ChannelTabs>{channel => <TipsList channel={channel} />}</ChannelTabs>
    </div>
  )
}

export default Tips
