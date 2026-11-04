'use client'

import { useMemo, useState } from 'react'

import Link from 'next/link'

import { PencilIcon, PinIcon, PinOffIcon, RefreshCwIcon } from 'lucide-react'

import useReportMoney from '@/components/shared/ReportMoney'
import DataTable, { type Column } from '@/components/shared/DataTable'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, useInvalidate, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

type Row = {
  id: string
  name: string | null
  email: string | null
  wager: string
  totalDeposit: string
  multiplier: number
  target: string
  targetPercentage: number
  locked: boolean
}

const API = 'admin/turnover-report'
const INVALIDATE = [['paged', API], ['api', `${API}/multiplier`]]

const validX = (v: string) => {
  const n = Number(v)

  return v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 && Math.round(n * 100) === n * 100
}

const X_ERROR = 'Between 0 and 100, at most 2 decimals (0 = no rollover)'

type Sort = { key: string; order: 'asc' | 'desc' }

/**
 * Main → Turnover Report: direct players ka wager vs target (total deposit × TargetX), % achieved.
 * Sirf report — withdrawal ya kuch aur nahi rokta. TargetX: player ka apna (`turnover_targets`)
 * warna default (`turnover_settings`). "Pinned" (`locked`) TargetX ko "Apply to all" nahi badalta.
 *
 *   GET admin/turnover-report            list (page / search)
 *   GET admin/turnover-report/multiplier default TargetX
 *   PUT admin/turnover-report/multiplier default + every unpinned player
 *   PUT admin/turnover-report/:id        one player's TargetX / pin
 */
const TurnoverReport = () => {
  const money = useReportMoney()
  const { can } = useSession()
  const canEdit = can('config:write')
  const invalidate = useInvalidate()
  const { state, set, query } = useListState([])

  const list = usePagedApi<Row>(API, { limit: query.limit, page: query.page, search: query.search || undefined })
  const settings = useApi<{ defaultMultiplier: number }>(`${API}/multiplier`)
  const defaultX = settings.data?.defaultMultiplier ?? 3

  const [sort, setSort] = useState<Sort | null>({ key: 'targetPercentage', order: 'desc' })
  const [globalX, setGlobalX] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [editX, setEditX] = useState('')

  const updateAll = useApiMutation({
    fn: () => api.put(`${API}/multiplier`, { multiplier: Number(globalX) }),
    invalidate: INVALIDATE,
    success: `TargetX set to ${globalX}× for every player without a pinned TargetX`,
    onSuccess: () => {
      setGlobalX('')
      setConfirmAll(false)
    }
  })

  const saveOne = useApiMutation({
    fn: () => api.put(`${API}/${editing!.id}`, { multiplier: Number(editX) }),
    invalidate: INVALIDATE,
    success: () => `TargetX for #${editing?.id} set to ${editX}×`,
    onSuccess: () => setEditing(null)
  })

  const togglePin = useApiMutation({
    fn: (r: Row) => api.put(`${API}/${r.id}`, { locked: !r.locked }),
    invalidate: INVALIDATE,
    success: (_res, r) => (r.locked ? `#${r.id} unpinned: "Apply to all" changes it again` : `#${r.id} pinned: "Apply to all" leaves it alone`)
  })

  // Is page ki rows pe sort (header click).
  const rows = useMemo(() => {
    const all = list.data?.rows

    if (!all || !sort) return all
    const k = sort.key as keyof Row
    const value = (r: Row) => (k === 'name' ? String(r.name ?? '').toLowerCase() : Number(r[k]))

    return [...all].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      const cmp = va < vb ? -1 : va > vb ? 1 : 0

      return sort.order === 'desc' ? -cmp : cmp
    })
  }, [list.data?.rows, sort])

  const columns: Column<Row>[] = [
    {
      key: 'player',
      header: 'Player',
      sortKey: 'name',
      cell: r => (
        <Link href={`/users/${r.id}`} className='group block min-w-0'>
          <p className='truncate font-semibold group-hover:underline'>{r.name || '—'}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {r.email || '—'} · <span className='font-mono'>{r.id}</span>
          </p>
        </Link>
      )
    },
    { key: 'dep', header: 'Deposited', align: 'right', sortKey: 'totalDeposit', cell: r => <span className='tabular-nums'>{money.format(r.totalDeposit)}</span> },
    { key: 'wager', header: 'Wagered', align: 'right', sortKey: 'wager', cell: r => <span className='tabular-nums'>{money.format(r.wager)}</span> },
    {
      key: 'target',
      header: 'Target',
      align: 'right',
      sortKey: 'target',
      cell: r => (
        <div className='tabular-nums'>
          <p>{money.format(r.target)}</p>
          <p className='text-muted-foreground text-xs'>
            deposits × {Number(r.multiplier)}
            {r.locked && ' · pinned'}
          </p>
        </div>
      )
    },
    {
      key: 'progress',
      header: 'Achieved',
      sortKey: 'targetPercentage',
      className: 'min-w-48',
      cell: r => {
        const done = r.targetPercentage >= 100

        return (
          <div className='flex items-center gap-3'>
            <div className='bg-muted h-1.5 flex-1 overflow-hidden rounded-full'>
              <div className={cn('h-full rounded-full', done ? 'bg-success' : 'bg-foreground/70')} style={{ width: `${Math.max(0, Math.min(100, r.targetPercentage))}%` }} />
            </div>
            <span className={cn('w-16 text-right text-sm font-semibold tabular-nums', done && 'text-success')}>{r.targetPercentage.toFixed(1)}%</span>
          </div>
        )
      }
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            cell: (r: Row) => (
              <div className='flex justify-end gap-1'>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  title='Edit TargetX'
                  aria-label={`Edit TargetX for ${r.name ?? r.id}`}
                  onClick={() => {
                    setEditX(String(r.multiplier))
                    setEditing(r)
                  }}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  title={r.locked ? 'Pinned: "Apply to all" leaves this TargetX alone. Click to unpin.' : 'Pin this TargetX so "Apply to all" leaves it alone'}
                  aria-label={r.locked ? `Unpin TargetX for ${r.name ?? r.id}` : `Pin TargetX for ${r.name ?? r.id}`}
                  aria-pressed={r.locked}
                  disabled={togglePin.isPending}
                  className={cn(r.locked ? 'text-foreground' : 'text-muted-foreground')}
                  onClick={() => togglePin.mutate(r)}
                >
                  {r.locked ? <PinIcon /> : <PinOffIcon />}
                </Button>
              </div>
            )
          }
        ]
      : [])
  ]

  return (
    <div>
      <PageHeader
        title='Turnover Report'
        description='How much each direct player has wagered against a target of their deposits × TargetX. It is the withdrawal rollover: a player cannot withdraw until the wager reaches the target. TargetX 0 = no requirement.'
        actions={
          <Button variant='outline' disabled={list.isFetching} onClick={() => invalidate(...INVALIDATE)}>
            <RefreshCwIcon className={cn(list.isFetching && 'animate-spin')} /> Refresh
          </Button>
        }
      />

      {canEdit && (
        <Card className='mb-4 flex flex-row flex-wrap items-center justify-between gap-4 p-5'>
          <div className='min-w-0'>
            <p className='font-semibold'>Default TargetX: {Number(defaultX)}×</p>
            <p className='text-muted-foreground mt-1 text-sm'>Applies to every player, except those whose TargetX is pinned in the table below.</p>
          </div>
          <div className='flex items-center gap-2'>
            <div className='relative'>
              <Input
                aria-label='New default TargetX'
                inputMode='decimal'
                placeholder={String(defaultX)}
                className='w-24 pr-7'
                value={globalX}
                onChange={e => setGlobalX(e.target.value.replace(/[^0-9.]/g, ''))}
              />
              <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm'>×</span>
            </div>
            <Button disabled={!validX(globalX) || Number(globalX) === Number(defaultX)} onClick={() => setConfirmAll(true)}>
              Apply to all
            </Button>
          </div>
        </Card>
      )}

      <Card className='gap-0 p-4'>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={p => set({ page: p })}
          onLimitChange={limit => set({ limit })}
          sort={sort}
          onSortChange={setSort}
          search={String(state.search ?? '')}
          onSearchChange={search => set({ search })}
          searchPlaceholder='Search name, email or ID'
          emptyMessage='No direct players yet.'
        />
      </Card>

      <FormDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        trigger={null}
        title={`Set TargetX to ${globalX}× for everyone?`}
        description='The default and every player without a pinned TargetX change. Pinned players keep theirs.'
        submitLabel='Apply to all'
        onSubmit={() => updateAll.mutateAsync()}
      >
        <p className='text-muted-foreground text-sm'>Targets are recalculated as deposits × {globalX || '—'}.</p>
      </FormDialog>

      <FormDialog
        open={editing !== null}
        onOpenChange={o => !o && setEditing(null)}
        trigger={null}
        title={`TargetX for ${editing?.name ?? `#${editing?.id}`}`}
        description={editing ? `Deposited ${money.format(editing.totalDeposit)} · wagered ${money.format(editing.wager)}` : undefined}
        submitLabel='Save'
        validate={() => (validX(editX) ? null : X_ERROR)}
        onSubmit={() => saveOne.mutateAsync()}
      >
        <TextField
          id='tr-x'
          label='TargetX (× deposits)'
          inputMode='decimal'
          value={editX}
          onChange={e => setEditX(e.target.value.replace(/[^0-9.]/g, ''))}
          hint={validX(editX) && editing ? `New target: ${money.format(Number(editing.totalDeposit) * Number(editX))}` : X_ERROR}
        />
      </FormDialog>
    </div>
  )
}

export default TurnoverReport
