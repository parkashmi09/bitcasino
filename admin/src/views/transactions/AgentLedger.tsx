'use client'

import { useState } from 'react'

import { ArrowDownCircleIcon, ArrowUpCircleIcon, RefreshCwIcon, SearchIcon, XIcon } from 'lucide-react'

import { useApi, useInvalidate } from '@/hooks/use-api'

type Side = { type: 'staff' | 'user'; id: string; name: string | null }
type Row = { id: string; from: Side; to: Side; type: string; amount: string; pointsAfter: string | null; remark: string | null; createdAt: string }

const API = 'admin/agent-ledger'
const PAGE_SIZE = 25

/* admin-structure.zip `Deposit.tsx` / `Withdraw.tsx` ke colours. */
const card = 'rounded-lg border border-border bg-card'
const input = 'h-10 rounded-md border border-border bg-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:border-primary focus:border-primary dark:[color-scheme:dark]'
const outlineBtn = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-sm text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40'
const th = 'whitespace-nowrap border-b border-border bg-muted px-4 py-2.5 text-left text-[0.72rem] font-bold tracking-[0.06em] text-muted-foreground uppercase'
const td = 'border-b border-border px-4 py-3 text-[0.82rem] text-foreground/80'

const fmt = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const money = (v: string | number) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const party = (p: Side) => (
  <span>
    <span className='text-muted-foreground'>
      {p.type === 'staff' ? 'Staff' : 'User'} #{p.id}
    </span>
    {p.name && <span className='ml-1 font-medium text-foreground'>{p.name}</span>}
  </span>
)

const TYPE_TONE: Record<string, string> = {
  Credit: 'bg-[rgba(14,204,104,0.12)] text-[#0ECC68]',
  Debit: 'bg-[rgba(224,27,79,0.12)] text-[#E01B4F]',
  Settlement: 'bg-[rgba(255,194,63,0.12)] text-[#FFC23F]',
  'User creation': 'bg-primary/10 text-primary'
}

/** Date input (YYYY-MM-DD) → poore din ka range. */
const dayStart = (d: string) => (d ? `${d}T00:00:00` : undefined)
const dayEnd = (d: string) => (d ? `${d}T23:59:59` : undefined)

/**
 * Transactions → Deposit / Withdraw → "Agent System" — zip `Deposit.tsx` / `Withdraw.tsx` jaisa
 * (header, filter: ID / From / To / Min / Max / Clear, table, pagination), apne setup ka data:
 * Sports Exchange ka point ledger (`GET admin/agent-ledger`) — agent ↔ player / sub-agent ka har len-den.
 */
const AgentLedger = ({ direction }: { direction: 'deposit' | 'withdraw' }) => {
  const deposit = direction === 'deposit'
  const [f, setF] = useState({ q: '', from: '', to: '', min: '', max: '' })
  const [page, setPage] = useState(1)
  const invalidate = useInvalidate()

  const list = useApi<{ total: number; sum: string; rows: Row[] }>(API, {
    direction,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: f.q || undefined,
    from: dayStart(f.from),
    to: dayEnd(f.to),
    min: f.min || undefined,
    max: f.max || undefined
  })

  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const pageSum = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0)
  const hasFilters = Object.values(f).some(Boolean)

  const change = (key: keyof typeof f, value: string) => {
    setPage(1)
    setF(s => ({ ...s, [key]: key === 'from' || key === 'to' ? value : value.replace(/[^0-9.]/g, '') }))
  }

  return (
    <div className='mx-auto max-w-[1400px] p-4 sm:p-6'>
      {/* Header */}
      <div className='mb-6 flex items-center justify-between gap-3'>
        <div className='flex items-center gap-3'>
          <span className={`flex rounded-lg p-2 ${deposit ? 'bg-[rgba(14,204,104,0.15)]' : 'bg-[rgba(224,27,79,0.15)]'}`}>
            {deposit ? <ArrowUpCircleIcon className='size-[22px] text-[#0ECC68]' /> : <ArrowDownCircleIcon className='size-[22px] text-[#E01B4F]' />}
          </span>
          <div>
            <h2 className='text-2xl font-bold text-foreground'>{deposit ? 'Deposit History' : 'Withdraw History'}</h2>
            <p className='text-xs text-muted-foreground'>{deposit ? 'Agent → User / sub-agent deposits (point ledger)' : 'User / sub-agent → Agent withdrawals (point ledger)'}</p>
          </div>
        </div>
        <button
          type='button'
          className={outlineBtn}
          disabled={list.isFetching}
          onClick={() => {
            setPage(1)
            invalidate(['api', API])
          }}
        >
          <RefreshCwIcon className='size-[15px]' /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className='mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4'>
        {[
          ['Transactions', String(total)],
          ['Total Amount', `${money(list.data?.sum ?? 0)}`],
          ['This Page', `${money(pageSum)}`],
          ['Page', `${page} / ${totalPages}`]
        ].map(([label, value]) => (
          <div key={label} className={`${card} p-4`}>
            <div className='text-xs text-muted-foreground'>{label}</div>
            <div className={`mt-1 text-lg font-bold tabular-nums ${label === 'Total Amount' ? (deposit ? 'text-[#0ECC68]' : 'text-[#E01B4F]') : 'text-foreground'}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={`${card} mb-4 flex flex-col gap-4 p-4 md:flex-row md:items-center`}>
        <div className='relative'>
          <SearchIcon className='absolute top-1/2 left-3 size-[15px] -translate-y-1/2 text-muted-foreground' />
          <input autoComplete='off' className={`${input} min-w-40 pl-9`} placeholder='Search by ID…' value={f.q} onChange={e => change('q', e.target.value)} />
        </div>
        <label className='grid gap-0.5 text-[0.7rem] text-muted-foreground'>
          From
          <input type='date' className={`${input} min-w-[150px]`} value={f.from} onChange={e => change('from', e.target.value)} />
        </label>
        <label className='grid gap-0.5 text-[0.7rem] text-muted-foreground'>
          To
          <input type='date' className={`${input} min-w-[150px]`} value={f.to} onChange={e => change('to', e.target.value)} />
        </label>
        <input autoComplete='off' className={`${input} w-[110px]`} placeholder='Min' value={f.min} onChange={e => change('min', e.target.value)} />
        <input autoComplete='off' className={`${input} w-[110px]`} placeholder='Max' value={f.max} onChange={e => change('max', e.target.value)} />
        {hasFilters && (
          <button
            type='button'
            className='inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:border-[#E01B4F] hover:text-[#E01B4F]'
            onClick={() => {
              setPage(1)
              setF({ q: '', from: '', to: '', min: '', max: '' })
            }}
          >
            <XIcon className='size-3.5' /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className={`${card} overflow-hidden`}>
        <div className='overflow-x-auto'>
          <table className='w-full border-collapse'>
            <thead>
              <tr>
                {['ID', 'From', 'To', 'Type', 'Amount', 'Date & Time'].map(h => (
                  <th key={h} className={`${th} ${h.startsWith('Amount') ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(6)].map((__, j) => (
                      <td key={j} className={td}>
                        <div className='h-4 animate-pulse rounded bg-accent' />
                      </td>
                    ))}
                  </tr>
                ))
              ) : list.error ? (
                <tr>
                  <td colSpan={6} className='py-10 text-center text-[#E01B4F]'>
                    {list.error.message || 'Server error'}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className='py-12 text-center'>
                    {deposit ? <ArrowUpCircleIcon className='mx-auto size-10 text-border' /> : <ArrowDownCircleIcon className='mx-auto size-10 text-border' />}
                    <p className='mt-2 text-muted-foreground'>No {deposit ? 'deposits' : 'withdrawals'} found.</p>
                  </td>
                </tr>
              ) : (
                rows.map(r => (
                  <tr key={r.id} className='transition-colors hover:bg-accent/50'>
                    <td className={`${td} font-semibold text-info`}>#{r.id}</td>
                    <td className={td}>{party(r.from)}</td>
                    <td className={td}>{party(r.to)}</td>
                    <td className={td}>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_TONE[r.type] ?? 'bg-accent text-muted-foreground'}`}>{r.type}</span>
                      {r.remark && <span className='ml-2 text-xs text-muted-foreground'>{r.remark}</span>}
                    </td>
                    <td className={`${td} text-right font-semibold tabular-nums ${deposit ? 'text-[#0ECC68]' : 'text-[#E01B4F]'}`}>
                      {deposit ? '+' : '−'}{money(r.amount)}
                    </td>
                    <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmt(r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!list.isLoading && rows.length > 0 && (
          <div className='flex items-center justify-between border-t border-border px-4 py-3'>
            <span className='text-xs text-muted-foreground'>
              Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + rows.length} of {total}
            </span>
            <div className='flex items-center gap-2'>
              <button type='button' className={`${outlineBtn} text-xs`} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                Previous
              </button>
              <span className='px-1 text-xs text-muted-foreground'>
                {page} / {totalPages}
              </span>
              <button type='button' className={`${outlineBtn} text-xs`} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentLedger
