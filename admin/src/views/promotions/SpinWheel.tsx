'use client'

import { useMemo, useState } from 'react'

import Link from 'next/link'

import { toast } from 'sonner'

import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import { SwitchField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import { useRewardCurrency } from '@/components/shared/RewardCurrency'
import StatCard from '@/components/shared/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { check, cleanErrors, firstError } from '@/lib/validate'
import type { SpinClaim, SpinConfig, SpinSlice } from './types'
import { useLocalList } from './useLocalList'

const PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6', '#64748b']

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180

  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/** The wheel as the user sees it, sliced by weight so a heavy slice looks heavy. */
const Wheel = ({ slices }: { slices: SpinSlice[] }) => {
  const total = slices.reduce((s, x) => s + Math.max(0, x.weight), 0)
  const shareOf = (x: SpinSlice) => (total ? Math.max(0, x.weight) / total : 1 / slices.length)
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, x) => sum + shareOf(x) * 360, 0))

  return (
    <svg viewBox='0 0 200 200' className='mx-auto size-56'>
      {slices.map((s, i) => {
        const share = shareOf(s)
        const start = starts[i]
        const end = start + share * 360
        const a = polar(100, 100, 96, start)
        const b = polar(100, 100, 96, end)
        const mid = polar(100, 100, 64, (start + end) / 2)
        const large = end - start > 180 ? 1 : 0
        const d = share >= 0.9999 ? 'M100,4 A96,96 0 1,1 99.99,4 Z' : `M100,100 L${a.x},${a.y} A96,96 0 ${large},1 ${b.x},${b.y} Z`

        return (
          <g key={s.id ?? i}>
            <path d={d} fill={s.color || PALETTE[i % PALETTE.length]} stroke='white' strokeWidth='1.5' opacity={s.isBadLuck ? 0.55 : 1} />
            {share > 0.04 && (
              <text x={mid.x} y={mid.y} fontSize='8' fill='white' textAnchor='middle' dominantBaseline='middle' fontWeight='600'>
                {s.label.slice(0, 10)}
              </text>
            )}
          </g>
        )
      })}
      <circle cx='100' cy='100' r='10' fill='white' stroke='#e5e7eb' />
      <polygon points='100,0 94,14 106,14' fill='#111827' />
    </svg>
  )
}

const Config = ({ canWrite }: { canWrite: boolean }) => {
  const q = useApi<SpinConfig>('admin/user/spin-wheel/config')
  const [edited, setDraft] = useState<SpinConfig | null>(null)
  const draft = edited ?? q.data ?? null
  const { code: cur } = useRewardCurrency()

  // Mirrors the platform's `updateConfig` validator (spin-wheel.validators.js).
  const errors = draft
    ? cleanErrors({
        'sw-min': check.amount(draft.minDeposit, 'Minimum deposit'),
        'sw-cd': check.number(draft.claimCooldownDays, 'Cooldown', { integer: true, min: 0, max: 3650 }),
        'sw-max': check.amount(draft.maxBonus, 'Max bonus', { optional: true }),
        'sw-wager': draft.wagerMultiplier == null ? undefined : check.number(draft.wagerMultiplier, 'Wagering multiplier', { min: 0, max: 100 }),
        'sw-expiry': check.number(draft.bonusExpiryDays ?? 30, 'Days to wager', { integer: true, min: 0, max: 3650 })
      })
    : {}

  const dirty = !!draft && !!q.data && (Object.keys(draft) as (keyof SpinConfig)[]).some(k => draft[k] !== q.data?.[k])

  const save = useApiMutation({
    fn: () => {
      const body: Record<string, string | number | boolean | null> = {}

      if (draft && q.data) {
        if (draft.minDeposit !== q.data.minDeposit) body.minDeposit = draft.minDeposit
        if (draft.claimCooldownDays !== q.data.claimCooldownDays) body.claimCooldownDays = draft.claimCooldownDays
        if (draft.isActive !== q.data.isActive) body.isActive = draft.isActive
        if (draft.unlimitedSpin !== q.data.unlimitedSpin) body.unlimitedSpin = draft.unlimitedSpin
        if (draft.maxBonus !== q.data.maxBonus) body.maxBonus = draft.maxBonus
        if (draft.wagerMultiplier !== q.data.wagerMultiplier) body.wagerMultiplier = draft.wagerMultiplier ?? null
        if (draft.bonusExpiryDays !== q.data.bonusExpiryDays && draft.bonusExpiryDays !== undefined) body.bonusExpiryDays = draft.bonusExpiryDays
      }

      return api.put<SpinConfig>('admin/user/spin-wheel/config', body)
    },
    invalidate: [['api', 'admin/user/spin-wheel/config']],
    success: 'Wheel settings saved',
    onSuccess: () => setDraft(null)
  })

  const submit = () => {
    const problem = firstError(errors)

    if (problem) return void toast.error(problem)
    save.mutate()
  }

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Eligibility</CardTitle>
        <CardDescription>
          Who may spin, and how often. The first spin is free; after the cooldown a user needs a deposit at or above the minimum. A won code is
          added automatically to the user&apos;s next deposit as a bonus, up to the maximum.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {q.error && <ErrorState error={q.error} />}
        {!draft ? (
          <Skeleton className='h-40' />
        ) : (
          <>
            <div className='grid grid-cols-2 gap-4'>
              <TextField id='sw-min' label='Minimum deposit' error={errors['sw-min']} hint={`${cur}, decimal string`} value={draft.minDeposit} disabled={!canWrite} onChange={e => setDraft({ ...draft, minDeposit: e.target.value })} />
              <TextField id='sw-cd' label='Cooldown (days)' error={errors['sw-cd']} type='number' min={0} max={3650} value={Number.isNaN(draft.claimCooldownDays) ? '' : String(draft.claimCooldownDays)} disabled={!canWrite} onChange={e => setDraft({ ...draft, claimCooldownDays: e.target.value === '' ? NaN : Number(e.target.value) })} />
              <TextField id='sw-max' label='Max bonus per deposit' error={errors['sw-max']} hint={`${cur}, decimal string. A won code adds its % of the deposit, up to this.`} value={draft.maxBonus ?? ''} disabled={!canWrite} onChange={e => setDraft({ ...draft, maxBonus: e.target.value })} />
              <TextField
                id='sw-wager'
                label='Bonus wagering multiplier'
                error={errors['sw-wager']}
                hint='The spin bonus stays in the locked bonus balance until the player wagers this × the bonus. Empty = same as the first deposit bonus; 0 = paid straight to cash.'
                inputMode='decimal'
                value={draft.wagerMultiplier == null ? '' : String(draft.wagerMultiplier)}
                disabled={!canWrite}
                onChange={e => {
                  const v = e.target.value.trim()

                  setDraft({ ...draft, wagerMultiplier: v === '' ? null : Number(v) })
                }}
              />
              <TextField id='sw-expiry' label='Days to wager the bonus' error={errors['sw-expiry']} hint='An unwagered spin bonus is forfeited after this. 0 = never.' type='number' min={0} max={3650} value={Number.isNaN(draft.bonusExpiryDays) ? '' : String(draft.bonusExpiryDays ?? 30)} disabled={!canWrite} onChange={e => setDraft({ ...draft, bonusExpiryDays: e.target.value === '' ? NaN : Number(e.target.value) })} />
            </div>
            <SwitchField id='sw-active' label='Wheel is live' hint='Off hides the wheel for every user.' checked={draft.isActive} disabled={!canWrite} onChange={isActive => setDraft({ ...draft, isActive })} />
            <SwitchField id='sw-unl' label='Unlimited spins' hint='Ignore the cooldown entirely.' checked={draft.unlimitedSpin} disabled={!canWrite} onChange={unlimitedSpin => setDraft({ ...draft, unlimitedSpin })} />
            <div className='flex justify-end gap-2'>
              <Button variant='outline' disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
                <RotateCcwIcon /> Reset
              </Button>
              <Button disabled={!dirty || save.isPending || !canWrite} onClick={submit}>
                {save.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

const Slices = ({ canWrite }: { canWrite: boolean }) => {
  const q = useApi<SpinSlice[]>('admin/user/spin-wheel/slices')
  const [edited, setEdited] = useState<SpinSlice[] | null>(null)
  const draft = edited ?? q.data ?? null

  const setDraft = (fn: (d: SpinSlice[] | null) => SpinSlice[] | null) => setEdited(prev => fn(prev ?? q.data?.map(s => ({ ...s })) ?? null))

  const dirty = useMemo(() => edited !== null && JSON.stringify(edited) !== JSON.stringify(q.data), [edited, q.data])
  const total = draft?.reduce((s, x) => s + Math.max(0, x.weight), 0) ?? 0

  // Mirrors `bulkSlices` (spin-wheel.validators.js): 1–60 segments, label 1–50 chars, reward % like "12.5", integer weight 0–1,000,000.
  const rowErrors = (draft ?? []).map((s, i) => {
    const n = `Segment ${i + 1}`

    return (
      check.required(s.label, `${n} label`) ||
      check.length(s.label, `${n} label`, { max: 50 }) ||
      (s.rewardPct && !/^\d{1,3}(\.\d{1,2})?$/.test(s.rewardPct.trim()) ? `${n}: reward % must be a percentage like 12.5` : undefined) ||
      check.number(Number.isNaN(s.weight) ? '' : s.weight, `${n} weight`, { integer: true, min: 0, max: 1_000_000 })
    )
  })

  const sliceProblem = rowErrors.find(Boolean) || (draft && total === 0 ? 'At least one segment must have a weight above 0' : undefined)

  const save = useApiMutation({
    fn: () =>
      api.put('admin/user/spin-wheel/slices-bulk', {
        slices: (draft ?? []).map((s, i) => ({
          label: s.label,
          rewardPct: s.rewardPct || '0',
          ...(s.color ? { color: s.color } : {}),
          sortOrder: i,
          isBadLuck: s.isBadLuck,
          weight: s.weight
        }))
      }),
    invalidate: [['api', 'admin/user/spin-wheel/slices']],
    success: 'Wheel segments replaced',
    onSuccess: () => setEdited(null)
  })

  const submit = () => {
    if (sliceProblem) return void toast.error(sliceProblem)
    save.mutate()
  }

  const update = (i: number, patch: Partial<SpinSlice>) => setDraft(d => (d ? d.map((s, j) => (j === i ? { ...s, ...patch } : s)) : d))

  const move = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      if (!d) return d
      const j = i + dir

      if (j < 0 || j >= d.length) return d

      const next = [...d]

      ;[next[i], next[j]] = [next[j], next[i]]

      return next
    })

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          Segments
          {draft && <Badge variant='secondary' className='font-normal'>{draft.length} · total weight {formatNumber(total)}</Badge>}
        </CardTitle>
        <CardDescription>The weights ARE the odds — a segment lands with probability weight ÷ total. Saving replaces the whole wheel; every write is audited.</CardDescription>
      </CardHeader>
      <CardContent className='grid gap-6 lg:grid-cols-[14rem_1fr]'>
        {q.error && <ErrorState error={q.error} />}
        {!draft ? (
          <Skeleton className='h-56 lg:col-span-2' />
        ) : (
          <>
            <div>
              <Wheel slices={draft} />
              <div className='mt-3 grid gap-1'>
                {draft.map((s, i) => {
                  const pct = total ? (Math.max(0, s.weight) / total) * 100 : 0

                  return (
                    <div key={i} className='flex items-center gap-2 text-xs'>
                      <span className='size-2.5 shrink-0 rounded-sm' style={{ background: s.color || PALETTE[i % PALETTE.length] }} />
                      <span className='w-20 truncate'>{s.label}</span>
                      <div className='bg-muted h-1.5 grow overflow-hidden rounded'>
                        <div className='bg-primary h-full' style={{ width: `${pct}%` }} />
                      </div>
                      <span className='w-12 text-right tabular-nums'>{pct.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className='grid gap-2'>
              <div className='text-muted-foreground hidden grid-cols-[1fr_5.5rem_5rem_5rem_4.5rem_6rem] gap-2 px-1 text-xs sm:grid'>
                <span>Label</span><span>Reward %</span><span>Weight</span><span>Colour</span><span>Bad luck</span><span />
              </div>
              {draft.map((s, i) => (
                <div key={i} className='grid grid-cols-2 items-center gap-2 rounded-md border p-2 sm:grid-cols-[1fr_5.5rem_5rem_5rem_4.5rem_6rem] sm:border-0 sm:p-0'>
                  <Input value={s.label} maxLength={50} disabled={!canWrite} aria-invalid={rowErrors[i]?.includes('label') || undefined} onChange={e => update(i, { label: e.target.value })} />
                  <Input value={s.rewardPct} placeholder='0' disabled={!canWrite} aria-invalid={rowErrors[i]?.includes('reward') || undefined} onChange={e => update(i, { rewardPct: e.target.value })} />
                  <Input type='number' min={0} max={1000000} value={Number.isNaN(s.weight) ? '' : String(s.weight)} disabled={!canWrite} aria-invalid={rowErrors[i]?.includes('weight') || undefined} onChange={e => update(i, { weight: e.target.value === '' ? NaN : Number(e.target.value) })} />
                  <div className='flex items-center gap-1'>
                    <input type='color' value={s.color || PALETTE[i % PALETTE.length]} disabled={!canWrite} onChange={e => update(i, { color: e.target.value })} className='size-8 cursor-pointer rounded border bg-transparent p-0.5' aria-label='Colour' />
                  </div>
                  <div className='flex items-center'>
                    <Switch checked={s.isBadLuck} disabled={!canWrite} onCheckedChange={isBadLuck => update(i, { isBadLuck, ...(isBadLuck ? { rewardPct: '0' } : {}) })} />
                  </div>
                  <div className='flex justify-end gap-0.5'>
                    <Button variant='ghost' size='icon-xs' disabled={!canWrite || i === 0} onClick={() => move(i, -1)} aria-label='Move up'><ArrowUpIcon /></Button>
                    <Button variant='ghost' size='icon-xs' disabled={!canWrite || i === draft.length - 1} onClick={() => move(i, 1)} aria-label='Move down'><ArrowDownIcon /></Button>
                    <Button variant='ghost' size='icon-xs' disabled={!canWrite || draft.length <= 1} onClick={() => setDraft(d => d && d.filter((_, j) => j !== i))} aria-label='Remove'><Trash2Icon /></Button>
                  </div>
                </div>
              ))}
              {dirty && sliceProblem && <p role='alert' className='text-destructive text-sm'>{sliceProblem}</p>}
              <div className='mt-2 flex flex-wrap justify-between gap-2'>
                <Button variant='outline' size='sm' disabled={!canWrite || draft.length >= 60} onClick={() => setDraft(d => [...(d ?? []), { label: 'New', rewardPct: '5', color: PALETTE[(d?.length ?? 0) % PALETTE.length], sortOrder: d?.length ?? 0, isBadLuck: false, weight: 10 }])}>
                  <PlusIcon /> Add segment
                </Button>
                <div className='flex gap-2'>
                  <Button variant='outline' size='sm' disabled={!dirty || save.isPending} onClick={() => setEdited(null)}>
                    <RotateCcwIcon /> Reset
                  </Button>
                  <Button size='sm' disabled={!dirty || save.isPending || !canWrite} onClick={submit}>
                    {save.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save segments
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

const claimColumns: Column<SpinClaim>[] = [
  { key: 'id', header: '#', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  {
    key: 'user',
    header: 'User',
    cell: r => (
      <div className='flex flex-col'>
        <Link href={`/users/${r.userId}`} className='font-medium hover:underline'>{r.username ?? `#${r.userId}`}</Link>
        <span className='text-muted-foreground font-mono text-xs'>#{String(r.userId)}</span>
      </div>
    )
  },
  { key: 'slice', header: 'Slice', cell: r => <Badge variant='outline'>{r.sliceLabel ?? '—'}</Badge> },
  { key: 'dep', header: 'Deposit', align: 'right', cell: r => <Money value={r.depositAmount} /> },
  { key: 'reward', header: 'Reward', align: 'right', cell: r => <Money value={r.rewardAmount} /> },
  { key: 'code', header: 'Redeem code', cell: r => <span className='font-mono text-xs'>{r.redeemCode ?? '—'}</span> },
  { key: 'at', header: 'Claimed', cell: r => <DateTime value={r.claimedAt} /> }
]

const Claims = () => {
  const { page, limit, set } = useLocalList()
  const [userId, setUserId] = useState('')
  const list = usePagedApi<SpinClaim>('admin/user/spin-wheel/claims', { channel: 'direct', limit, page, userId: userId || undefined })

  return (
    <DataTable
      columns={claimColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={p => set({ page: p })}
      onLimitChange={l => set({ limit: l })}
      dense
      emptyMessage='Nobody has spun yet.'
      toolbar={<Input className='w-40' placeholder='User id' inputMode='numeric' value={userId} onChange={e => { setUserId(e.target.value.replace(/\D/g, '')); set({ page: 1 }) }} />}
    />
  )
}

const SpinWheel = () => {
  const { can } = useSession()
  const canWrite = can('config:write')
  const claims = usePagedApi<SpinClaim>('admin/user/spin-wheel/claims', { channel: 'direct', limit: 1, page: 1 })

  return (
    <div>
      <PageHeader title='Spin wheel' description='The first-deposit wheel: eligibility, the segments and their odds, and every spin that paid out.' />
      {!canWrite && <p className='text-muted-foreground mb-4 text-sm'>Your role can view the wheel but not change it (needs <code>config:write</code>).</p>}
      <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Spins claimed' value={formatNumber(claims.data?.pagination.total)} loading={claims.isLoading} />
      </div>
      <div className='grid gap-6'>
        <div className='grid gap-6 xl:grid-cols-[22rem_1fr]'>
          <Config canWrite={canWrite} />
          <Slices canWrite={canWrite} />
        </div>
        <div>
          <h2 className='mb-3 text-lg font-semibold'>Claims</h2>
          <Claims />
        </div>
      </div>
    </div>
  )
}

export default SpinWheel
