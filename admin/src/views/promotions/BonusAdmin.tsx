'use client'

import { useState } from 'react'

import Link from 'next/link'

import { ChartColumnIcon, CoinsIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'

import { useStatsFilters } from '@/components/shared/charts'
import Can from '@/components/shared/Can'
import { useReportMoney } from '@/components/shared/ReportMoney'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import { RewardCurrencyNotice, useRewardCurrency } from '@/components/shared/RewardCurrency'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { check, type FieldErrors } from '@/lib/validate'
import WelcomeBonuses from '@/views/site-config/WelcomeBonuses'
import WagerContribution from '@/views/site-config/WagerContribution'
import RewardFormula from '@/views/site-config/RewardFormula'
import RewardStats from './RewardStats'
import { BONUS_TYPES, GAME_COUNTERS, type BonusAward, type BonusDashboard, type BonusEvent, type BonusGameRow, type BonusRecord, type BonusType, type BonusUserInspect, type GameCounter } from './types'
import { useLocalList } from './useLocalList'

const COUNTER_LABEL: Record<GameCounter, string> = {
  luckyspin: 'Lucky spin',
  dailybonus: 'Daily',
  weeklybonus: 'Weekly',
  monthlybonus: 'Monthly',
  depositbonus: 'Deposit',
  rollcompetitionbonus: 'Roll competition',
  rakebackbonus: 'Rakeback'
}

const INVALIDATE = [
  ['paged', 'admin/user/bonus/records'],
  ['paged', 'admin/user/bonus/games'],
  ['paged', 'admin/user/bonus/events'],
  ['paged', 'admin/user/bonus/awards'],
  ['api', 'admin/user/bonus/dashboard']
]

/** The records API sends `vip` as a number or as `{ level, … }`. */
const vipLevel = (v: unknown) => (typeof v === 'object' && v ? ((v as { level?: number }).level ?? '?') : String(v))

const UserLink = ({ id }: { id: number | string }) => (
  <Link href={`/users/${id}`} className='font-mono text-xs hover:underline'>
    #{String(id)}
  </Link>
)

/** A userId filter shared by every tab; the platform's list routes all take `userId`. */
const UserFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className='relative w-44'>
    <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
    <Input className='pl-8' placeholder='Filter by user id' inputMode='numeric' value={value} onChange={e => onChange(e.target.value.replace(/\D/g, ''))} />
  </div>
)

// ── Dashboard ─────────────────────────────────────────────────────────

const Dashboard = ({ userId }: { userId: string }) => {
  const q = useApi<BonusDashboard>('admin/user/bonus/dashboard', { limit: 50, userId: userId || undefined })
  const d = q.data

  // Bonus awards are paid in the site's reward currency (owner panel); USDT until the API names it.
  const cur = d?.currency ?? 'USDT'

  const historyColumns: Column<BonusDashboard['history'][number]>[] = [
    { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
    { key: 'user', header: 'User', cell: r => <UserLink id={r.userId} /> },
    { key: 'type', header: 'Type', cell: r => <StatusBadge value={r.type} /> },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={cur} digits={2} /> },
    { key: 'vip', header: 'VIP', cell: r => `L${vipLevel(r.vip)}` },
    { key: 'claimed', header: 'Claimed', cell: r => (r.claimed ? <DateTime value={r.claimedAt} /> : <StatusBadge value='pending' />) }
  ]

  return (
    <div className='grid gap-4'>
      {q.error && <ErrorState error={q.error} />}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Awards' value={formatNumber(d?.total)} hint='bonus claims on record' loading={q.isLoading} />
        <StatCard label='Users with a record' value={formatNumber(d?.users.length)} hint='on this page' loading={q.isLoading} />
        <StatCard label='Unclaimed awards' value={formatNumber(d?.history.filter(h => !h.claimed).length)} hint='of the latest 50' loading={q.isLoading} />
        <StatCard label='Claimed awards' value={formatNumber(d?.history.filter(h => h.claimed).length)} hint='of the latest 50' loading={q.isLoading} />
      </div>
      <DataTable columns={historyColumns} rows={d?.history} rowKey={r => r.id} loading={q.isLoading} error={q.error} dense emptyMessage='No bonus awards yet.' />
    </div>
  )
}

// ── Per-user records ──────────────────────────────────────────────────

const recordColumns: Column<BonusRecord>[] = [
  { key: 'user', header: 'User', cell: r => <div className='flex flex-col'><span className='font-medium'>{r.name ?? '—'}</span><UserLink id={r.userId} /></div> },
  { key: 'total', header: 'Total', align: 'right', cell: r => <Money value={r.total} currency={r.currency ?? 'USDT'} digits={2} /> },
  { key: 'vip', header: 'VIP', align: 'right', cell: r => <Money value={r.vip} currency={r.currency ?? 'USDT'} digits={2} /> },
  { key: 'special', header: 'Special', align: 'right', cell: r => <Money value={r.special} currency={r.currency ?? 'USDT'} digits={2} /> },
  { key: 'general', header: 'General', align: 'right', cell: r => <Money value={r.general} currency={r.currency ?? 'USDT'} digits={2} /> },
  { key: 'joining', header: 'Joining', align: 'right', cell: r => <Money value={r.joining} currency={r.currency ?? 'USDT'} digits={2} /> },
  { key: 'rake', header: 'Rake', align: 'right', cell: r => <Money value={r.rake} currency={r.currency ?? 'USDT'} digits={2} /> },
  ...BONUS_TYPES.map<Column<BonusRecord>>(t => ({
    key: t,
    header: <span className='capitalize'>{t}</span>,
    align: 'right',
    cell: r => (
      <span className='flex flex-col items-end'>
        <Money value={r.amounts?.[t]?.pending} currency={r.currency ?? 'USDT'} digits={2} />
        <span className='text-muted-foreground text-xs'>paid <Money value={r.amounts?.[t]?.paid} currency={r.currency ?? 'USDT'} digits={2} /></span>
      </span>
    )
  }))
]

const Records = ({ userId }: { userId: string }) => {
  const { page, limit, set } = useLocalList()
  const list = usePagedApi<BonusRecord>('admin/user/bonus/records', { channel: 'direct', limit, page, userId: userId || undefined })
  const [create, setCreate] = useState({ userId: '', name: '' })
  const [edit, setEdit] = useState<{ userId: string } & Record<BonusType, string>>({ userId: '', daily: '', weekly: '', monthly: '' })
  const [inspectId, setInspectId] = useState<string | null>(null)

  const createM = useApiMutation({
    fn: () => api.post('admin/user/bonus/records', { userId: Number(create.userId), ...(create.name ? { name: create.name } : {}) }),
    invalidate: INVALIDATE,
    success: 'Bonus record created',
    onSuccess: () => setCreate({ userId: '', name: '' })
  })

  const updateM = useApiMutation({
    fn: () => {
      const body: Record<string, string | number> = { userId: Number(edit.userId) }

      for (const t of BONUS_TYPES) if (edit[t]) body[t] = edit[t]

      return api.put('admin/user/bonus/records', body)
    },
    invalidate: INVALIDATE,
    success: 'Pending bonus amounts updated'
  })

  const deleteM = useApiMutation<string | number>({
    fn: userId => api.delete('admin/user/bonus/records', { userId: Number(userId) }),
    invalidate: INVALIDATE,
    success: 'Bonus record removed'
  })

  const columns: Column<BonusRecord>[] = [
    ...recordColumns,
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <div className='flex justify-end gap-1' onClick={e => e.stopPropagation()}>
          <Button variant='ghost' size='sm' onClick={() => setInspectId(String(r.userId))}>Inspect</Button>
          <Can permission='config:write'>
            <FormDialog
              trigger={<Button variant='ghost' size='icon-sm' aria-label='Edit'><PencilIcon /></Button>}
              title={`Pending bonus for #${r.userId}`}
              description='Sets the pending daily / weekly / monthly figure the user can claim once they reach the VIP threshold (20 / 25 / 30). Leave a field blank to keep it.'
              onSubmit={() => updateM.mutateAsync()}
              validate={() => {
                const errs: FieldErrors = {}

                for (const t of BONUS_TYPES) errs[`rec-${t}`] = check.amount(edit[t], t[0].toUpperCase() + t.slice(1), { optional: true })
                if (!BONUS_TYPES.some(t => edit[t].trim())) errs[`rec-${BONUS_TYPES[0]}`] = 'Enter at least one amount'

                return errs
              }}
              onOpenChange={o => o && setEdit({ userId: String(r.userId), daily: '', weekly: '', monthly: '' })}
            >
              {BONUS_TYPES.map(t => (
                <TextField key={t} id={`rec-${t}`} label={<span className='capitalize'>{t}</span>} placeholder={r.amounts?.[t]?.pending} value={edit[t]} onChange={e => setEdit({ ...edit, [t]: e.target.value })} />
              ))}
            </FormDialog>
            <ConfirmDialog
              trigger={<Button variant='ghost' size='icon-sm' aria-label='Delete'><Trash2Icon /></Button>}
              title={`Remove the bonus record for #${r.userId}?`}
              description='The user loses every pending figure. Paid history stays.'
              confirmLabel='Remove'
              destructive
              onConfirm={() => deleteM.mutateAsync(r.userId)}
            />
          </Can>
        </div>
      )
    }
  ]

  return (
    <div className='grid gap-4'>
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={r => r.userId}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={p => set({ page: p })}
        onLimitChange={l => set({ limit: l })}
        emptyMessage='No user has a bonus record yet.'
        toolbar={
          <Can permission='config:write'>
            <FormDialog
              trigger={<Button size='sm'><PlusIcon /> New record</Button>}
              title='Create a bonus record'
              description='One row per user. Everything starts at zero; set amounts afterwards with Edit.'
              submitLabel='Create'
              onSubmit={() => createM.mutateAsync()}
              validate={() => ({ 'rec-uid': check.id(create.userId, 'User id'), 'rec-name': check.length(create.name, 'Display name', { max: 120 }) })}
            >
              <TextField id='rec-uid' label='User id' required inputMode='numeric' value={create.userId} onChange={e => setCreate({ ...create, userId: e.target.value.replace(/\D/g, '') })} />
              <TextField id='rec-name' label='Display name' maxLength={120} value={create.name} onChange={e => setCreate({ ...create, name: e.target.value })} />
            </FormDialog>
          </Can>
        }
      />
      {inspectId && <Inspect userId={inspectId} onClose={() => setInspectId(null)} />}
    </div>
  )
}

const Inspect = ({ userId, onClose }: { userId: string; onClose: () => void }) => {
  const q = useApi<BonusUserInspect>(`admin/user/bonus/users/${userId}`)
  const d = q.data
  const money = useReportMoney()

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle className='flex items-center justify-between text-base'>
          <span>Standing of user #{userId}</span>
          <Button variant='ghost' size='sm' onClick={onClose}>Close</Button>
        </CardTitle>
        <CardDescription>
          {d ? (
            <>
              VIP level {d.vip.level} <Badge variant='secondary' className='capitalize'>{d.vip.card}</Badge> · wagered {money.format(d.vip.wager, 'USD', { digits: 2 })} · {d.vip.nextLevel == null ? 'top level' : `${d.vip.progressPct}% to level ${d.vip.nextLevel}`} · paid in {d.currency}
            </>
          ) : 'Loading…'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.error && <ErrorState error={q.error} />}
        {d && (
          <div className='grid gap-3 sm:grid-cols-3'>
            {BONUS_TYPES.map(t => {
              const s = d.types[t]

              return (
                <div key={t} className='rounded-md border p-3 text-sm'>
                  <div className='flex items-center justify-between'>
                    <span className='font-medium capitalize'>{t}</span>
                    <StatusBadge value={s.claimable ? 'active' : s.eligible ? 'pending' : 'locked'} />
                  </div>
                  <p className='mt-2'>Pending <Money value={s.amount} currency={d.currency} digits={2} /></p>
                  <p className='text-muted-foreground'>Paid so far <Money value={s.totalPaid} currency={d.currency} digits={2} /></p>
                  <p className='text-muted-foreground text-xs'>needs VIP {s.minVipLevel}</p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Per-game counters ─────────────────────────────────────────────────

const CounterFields = ({ value, onChange, prefix }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; prefix: string }) => (
  <div className='grid grid-cols-2 gap-3'>
    {GAME_COUNTERS.map(c => (
      <TextField key={c} id={`${prefix}-${c}`} label={COUNTER_LABEL[c]} placeholder='0.00' value={value[c] ?? ''} onChange={e => onChange({ ...value, [c]: e.target.value })} />
    ))}
  </div>
)

/** Every counter typed must be a positive amount; `need` = at least one must be given (grant). */
const counterErrors = (v: Record<string, string>, prefix: string, need: boolean): FieldErrors => {
  const errs: FieldErrors = {}

  for (const c of GAME_COUNTERS) errs[`${prefix}-${c}`] = check.amount(v[c], COUNTER_LABEL[c], { optional: true })
  if (need && !GAME_COUNTERS.some(c => v[c]?.trim())) errs[`${prefix}-${GAME_COUNTERS[0]}`] = 'Enter at least one counter amount'

  return errs
}

const pickCounters = (v: Record<string, string>) => {
  const out: Record<string, string> = {}

  for (const c of GAME_COUNTERS) if (v[c]) out[c] = v[c]

  return out
}

const Games = ({ userId }: { userId: string }) => {
  const { page, limit, set } = useLocalList()
  const list = usePagedApi<BonusGameRow>('admin/user/bonus/games', { channel: 'direct', limit, page, userId: userId || undefined })
  const [create, setCreate] = useState<Record<string, string>>({ userId: '' })
  const [grant, setGrant] = useState<Record<string, string>>({ userId: '', note: '' })

  const createM = useApiMutation({
    fn: () => api.post('admin/user/bonus/games', { userId: Number(create.userId), ...pickCounters(create) }),
    invalidate: INVALIDATE,
    success: 'Counter row created',
    onSuccess: () => setCreate({ userId: '' })
  })

  const grantM = useApiMutation({
    fn: () =>
      api.put('admin/user/bonus/games', {
        userId: Number(grant.userId),
        idempotencyKey: `bonusgrant:${grant.userId}:${Date.now()}`,
        ...(grant.note ? { note: grant.note } : {}),
        ...pickCounters(grant)
      }),
    invalidate: INVALIDATE,
    success: 'Bonus granted and credited to the user'
  })

  const deleteM = useApiMutation<string | number>({
    fn: uid => api.delete('admin/user/bonus/games', { userId: Number(uid) }),
    invalidate: INVALIDATE,
    success: 'Counter row removed'
  })

  const columns: Column<BonusGameRow>[] = [
    { key: 'user', header: 'User', cell: r => <UserLink id={r.userId} /> },
    ...GAME_COUNTERS.map<Column<BonusGameRow>>(c => ({ key: c, header: COUNTER_LABEL[c], align: 'right', cell: r => <Money value={r.counters?.[c]} /> })),
    { key: 'updated', header: 'Updated', cell: r => <DateTime value={r.updatedAt ?? r.createdAt} relative /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <div className='flex justify-end gap-1'>
          <Can permission='wallet:credit'>
            <FormDialog
              trigger={<Button variant='ghost' size='sm'><CoinsIcon /> Grant</Button>}
              title={`Grant bonus to #${r.userId}`}
              description='Adds to the counters AND credits the sum to the user balance. This moves money.'
              submitLabel='Grant & credit'
              onSubmit={() => grantM.mutateAsync()}
              validate={() => ({ ...counterErrors(grant, 'grant', true), 'grant-note': check.length(grant.note, 'Note', { max: 200 }) })}
              onOpenChange={o => o && setGrant({ userId: String(r.userId), note: '' })}
              wide
            >
              <CounterFields prefix='grant' value={grant} onChange={setGrant} />
              <TextField id='grant-note' label='Note' value={grant.note ?? ''} onChange={e => setGrant({ ...grant, note: e.target.value })} />
            </FormDialog>
          </Can>
          <Can permission='config:write'>
            <ConfirmDialog
              trigger={<Button variant='ghost' size='icon-sm' aria-label='Delete'><Trash2Icon /></Button>}
              title={`Remove the counters for #${r.userId}?`}
              description='Only the record goes; nothing is debited.'
              confirmLabel='Remove'
              destructive
              onConfirm={() => deleteM.mutateAsync(r.userId)}
            />
          </Can>
        </div>
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
      onPageChange={p => set({ page: p })}
      onLimitChange={l => set({ limit: l })}
      emptyMessage='No per-game counters yet.'
      toolbar={
        <Can permission='config:write'>
          <FormDialog
            trigger={<Button size='sm'><PlusIcon /> New counter row</Button>}
            title='Create a counter row'
            description='Records what has been granted from each source. Creating a row does not pay anything — use Grant for that.'
            submitLabel='Create'
            onSubmit={() => createM.mutateAsync()}
            validate={() => ({ 'game-uid': check.id(create.userId, 'User id'), ...counterErrors(create, 'create', false) })}
            wide
          >
            <TextField id='game-uid' label='User id' required inputMode='numeric' value={create.userId ?? ''} onChange={e => setCreate({ ...create, userId: e.target.value.replace(/\D/g, '') })} />
            <CounterFields prefix='create' value={create} onChange={setCreate} />
          </FormDialog>
        </Can>
      }
    />
  )
}

// ── Event log ─────────────────────────────────────────────────────────

const Events = ({ userId }: { userId: string }) => {
  const { page, limit, set } = useLocalList()
  const list = usePagedApi<BonusEvent>('admin/user/bonus/events', { channel: 'direct', limit, page, userId: userId || undefined })
  const [create, setCreate] = useState({ userId: '', event: '', amount: '' })
  const [edit, setEdit] = useState({ id: 0, event: '', amount: '' })

  const createM = useApiMutation({
    fn: () => api.post('admin/user/bonus/events', { userId: Number(create.userId), event: create.event, amount: create.amount }),
    invalidate: INVALIDATE,
    success: 'Event recorded',
    onSuccess: () => setCreate({ userId: '', event: '', amount: '' })
  })

  const updateM = useApiMutation({
    fn: () => api.put(`admin/user/bonus/events/${edit.id}`, { ...(edit.event ? { event: edit.event } : {}), ...(edit.amount ? { amount: edit.amount } : {}) }),
    invalidate: INVALIDATE,
    success: 'Event updated'
  })

  const deleteM = useApiMutation<number>({
    fn: id => api.delete(`admin/user/bonus/events/${id}`),
    invalidate: INVALIDATE,
    success: 'Event deleted'
  })

  const columns: Column<BonusEvent>[] = [
    { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
    { key: 'user', header: 'User', cell: r => <UserLink id={r.userId} /> },
    { key: 'event', header: 'Event', cell: r => <span className='text-sm'>{r.event}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <Can permission='config:write'>
          <div className='flex justify-end gap-1'>
            <FormDialog
              trigger={<Button variant='ghost' size='icon-sm' aria-label='Edit'><PencilIcon /></Button>}
              title={`Edit event #${r.id}`}
              onSubmit={() => updateM.mutateAsync()}
              validate={() => ({
                'ev-name': edit.event.trim() || edit.amount.trim() ? check.length(edit.event, 'Event', { max: 200 }) : 'Give an event name, an amount, or both',
                'ev-amount': check.amount(edit.amount, 'Amount', { optional: true })
              })}
              onOpenChange={o => o && setEdit({ id: r.id, event: r.event, amount: r.amount })}
            >
              <TextField id='ev-name' label='Event' value={edit.event} onChange={e => setEdit({ ...edit, event: e.target.value })} />
              <TextField id='ev-amount' label='Amount' value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} />
            </FormDialog>
            <ConfirmDialog
              trigger={<Button variant='ghost' size='icon-sm' aria-label='Delete'><Trash2Icon /></Button>}
              title='Delete this event?'
              confirmLabel='Delete'
              destructive
              onConfirm={() => deleteM.mutateAsync(r.id)}
            />
          </div>
        </Can>
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
      onPageChange={p => set({ page: p })}
      onLimitChange={l => set({ limit: l })}
      emptyMessage='No bonus events logged.'
      toolbar={
        <Can permission='config:write'>
          <FormDialog
            trigger={<Button size='sm'><PlusIcon /> Log event</Button>}
            title='Log a bonus event'
            description='A line in the user-visible bonus history. Does not move money.'
            submitLabel='Record'
            onSubmit={() => createM.mutateAsync()}
            validate={() => ({
              'ev-uid': check.id(create.userId, 'User id'),
              'ev-event': check.required(create.event, 'Event') || check.length(create.event, 'Event', { max: 200 }),
              'ev-amt': check.amount(create.amount)
            })}
          >
            <TextField id='ev-uid' label='User id' required inputMode='numeric' value={create.userId} onChange={e => setCreate({ ...create, userId: e.target.value.replace(/\D/g, '') })} />
            <TextField id='ev-event' label='Event' required maxLength={200} value={create.event} onChange={e => setCreate({ ...create, event: e.target.value })} />
            <TextField id='ev-amt' label='Amount' required placeholder='10.00' value={create.amount} onChange={e => setCreate({ ...create, amount: e.target.value })} />
          </FormDialog>
        </Can>
      }
    />
  )
}

// ── Awards ────────────────────────────────────────────────────────────

const Awards = ({ userId }: { userId: string }) => {
  const { page, limit, set } = useLocalList()
  const [type, setType] = useState('all')
  const [claimed, setClaimed] = useState('all')
  const reward = useRewardCurrency()

  const list = usePagedApi<BonusAward>('admin/user/bonus/awards', {
    // Agent ke users ye use nahi kar sakte — sirf direct users.
    channel: 'direct',
    limit,
    page,
    userId: userId || undefined,
    type: type === 'all' ? undefined : type,
    claimed: claimed === 'all' ? undefined : claimed === 'yes'
  })

  const columns: Column<BonusAward>[] = [
    { key: 'at', header: 'When', cell: r => <DateTime value={r.created_at} /> },
    { key: 'user', header: 'User', cell: r => (r.userid != null ? <UserLink id={r.userid} /> : '—') },
    { key: 'type', header: 'Type', cell: r => <StatusBadge value={r.bonus_type} /> },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.bonus_amount} currency={/^USD[TC]?$/.test(reward.code) ? reward.code : 'USD'} digits={2} /> }, // bonus_claims.bonus_amount is the USD figure from vipRewards; a USD-pegged reward coin (USDT) pays it 1:1
    { key: 'claimed', header: 'Claimed', cell: r => (r.is_claimed ? <DateTime value={r.claimed_at} /> : <StatusBadge value='pending' />) }
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
      onPageChange={p => set({ page: p })}
      onLimitChange={l => set({ limit: l })}
      dense
      emptyMessage='No awards issued.'
      toolbar={
        <div className='flex gap-2'>
          <div className='w-36'>
            <SelectField id='aw-type' label='' value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, ...BONUS_TYPES.map(t => ({ value: t, label: t }))]} />
          </div>
          <div className='w-36'>
            <SelectField id='aw-claimed' label='' value={claimed} onChange={setClaimed} options={[{ value: 'all', label: 'Claimed or not' }, { value: 'yes', label: 'Claimed' }, { value: 'no', label: 'Unclaimed' }]} />
          </div>
        </div>
      }
    />
  )
}

// ── Screen ────────────────────────────────────────────────────────────

const BonusAdmin = () => {
  const [userId, setUserId] = useState('')
  const f = useStatsFilters({ defaultPreset: '30d' })

  return (
    <div>
      <PageHeader
        title='Bonus'
        description='Pending daily / weekly / monthly bonus per user, per-game counters (incl. rakeback and lucky spin), the event log and the award history. Redeem codes have their own screen.'
        actions={
          <>
            <UserFilter value={userId} onChange={setUserId} />
            <Button variant='outline' nativeButton={false} render={<Link href='/redeem-codes' />}>Redeem codes</Button>
          </>
        }
      />
      <RewardCurrencyNotice className='mb-4' />
      <Tabs defaultValue='records'>
        <TabsList className='mb-4 h-auto max-w-full flex-wrap'>
          <TabsTrigger value='records'>User bonuses</TabsTrigger>
          <TabsTrigger value='games'>Bonus games</TabsTrigger>
          <TabsTrigger value='events'>Events</TabsTrigger>
          <TabsTrigger value='awards'>Awards</TabsTrigger>
          <TabsTrigger value='dashboard'>Dashboard</TabsTrigger>
          <Can permission='config:read'>
            <TabsTrigger value='welcome'>Welcome bonuses</TabsTrigger>
            <TabsTrigger value='contribution'>Wager contribution</TabsTrigger>
            <TabsTrigger value='formula'>Rakeback formula</TabsTrigger>
          </Can>
          <TabsTrigger value='stats'>
            <ChartColumnIcon /> Stats
          </TabsTrigger>
        </TabsList>
        <TabsContent value='records'><Records userId={userId} /></TabsContent>
        <TabsContent value='games'><Games userId={userId} /></TabsContent>
        <TabsContent value='events'><Events userId={userId} /></TabsContent>
        <TabsContent value='awards'><Awards userId={userId} /></TabsContent>
        <TabsContent value='dashboard'><Dashboard userId={userId} /></TabsContent>
        {/* Pehle alag page tha (Site Config → Welcome bonuses); ab yahin tab me. */}
        <Can permission='config:read'>
          <TabsContent value='welcome'><WelcomeBonuses embedded /></TabsContent>
          <TabsContent value='contribution'><WagerContribution /></TabsContent>
          <TabsContent value='formula'><RewardFormula /></TabsContent>
        </Can>
        {/* Charts alag tab me — lists pehle dikhen. */}
        <TabsContent value='stats'><RewardStats section='bonus' filters={f} rewardNote={false} /></TabsContent>
      </Tabs>
    </div>
  )
}

export default BonusAdmin
