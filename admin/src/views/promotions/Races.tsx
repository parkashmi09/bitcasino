'use client'

import { useEffect, useRef, useState } from 'react'

import { toast } from 'sonner'

import { BanIcon, FlaskConicalIcon, FlagIcon, ListOrderedIcon, Loader2Icon, PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon, TrophyIcon, XIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { SwitchField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { check, cleanErrors, firstError } from '@/lib/validate'

/**
 * Wagering races (stake fork). A config per type decides the points a bet earns
 * per product, the pool and how it splits across ranks; a race is one window of
 * that config. Settling a race pays its rewards, so it is a confirm.
 */
type RaceType = 'daily' | 'weekly' | 'monthly'

/** A booked rank (any free entry) or a rank pinned to one entry (Booked seats tab). */
type Seat = number | { rank: number; boatId: number }

type RaceConfig = {
  type: RaceType
  enabled: boolean
  sportsPoints: number | string
  casinoPoints: number | string
  slotPoints: number | string
  crashPoints: number | string
  otherPoints: number | string
  prizePool: string
  currency?: string
  platformFeePercent: number | string
  winnerCount: number
  top3Percentage: number | string
  minPoints: string
  bookedSeatsEnabled: boolean
  bookedSeats?: Seat[]

  /** The ladder that pays (USD, stored); `ladder` says whether it is the operator's own or the computed curve. */
  rankPrizes?: { rank: number; percentage: number; amount?: string }[]
  ladder?: 'custom' | 'curve'

  /** How the backend answers the points per product (the form edits them as `<bucket>Points`). */
  multipliers?: Partial<Record<'sports' | 'casino' | 'slot' | 'crash' | 'other', string>>
}

/** GET user/race (public): the same configs with the pool and ladder in the reward currency. */
type PublicRace = { type: RaceType; payout?: { currency: string; prizePool: string; netPrizePool: string; ranks: { rank: number; amount: string }[] } }

type BoardRow = { rank: number; userId: string | null; name: string | null; points: string; usdWagered: string; bets: number; isBoat: boolean; reward: string; payout?: string }
type Board = { raceId: number; startsAt: string; endsAt: string; winnerCount: number; payoutCurrency?: string; currency: string; leaderboard: BoardRow[] }

type Race = { id: number; type: RaceType; status?: string; startsAt?: string; endsAt?: string; starts_at?: string; ends_at?: string; participants?: number; prizePool?: string; settledAt?: string | null; totalAwarded?: string; winnerCount?: number; cancelReason?: string | null; test?: boolean }
type Reward = { id: number; raceId?: number; type?: RaceType; raceStartsAt?: string | null; userId?: number | string; username?: string; rank?: number; points?: string; amount?: string; currency?: string; claimed?: boolean; claimedAt?: string | null; createdAt?: string }

/** `meta.summary` of GET admin/user/race/rewards: every page of the same filters. */
type RewardSummary = { winners: number; claimed: { count: number; amount: string }; unclaimed: { count: number; amount: string }; total: { count: number; amount: string }; currency: string }
type Boat = { id: number; name: string; isActive?: boolean }

/** Bounds from race.validators.js `updateConfig` (MAX_WINNERS = 500). */
const FIELD_RULE: Partial<Record<keyof RaceConfig, (v: unknown, label: string) => string | undefined>> = {
  sportsPoints: (v, l) => check.number(v as string, l, { min: 0, max: 1000 }),
  casinoPoints: (v, l) => check.number(v as string, l, { min: 0, max: 1000 }),
  slotPoints: (v, l) => check.number(v as string, l, { min: 0, max: 1000 }),
  crashPoints: (v, l) => check.number(v as string, l, { min: 0, max: 1000 }),
  otherPoints: (v, l) => check.number(v as string, l, { min: 0, max: 1000 }),
  prizePool: (v, l) => check.number(v as string, l, { min: 0, decimals: 8 }),
  platformFeePercent: (v, l) => check.number(v as string, l, { min: 0, max: 100 }),
  winnerCount: (v, l) => check.number(v as string, l, { integer: true, min: 1, max: 500 }),
  top3Percentage: (v, l) => check.number(v as string, l, { min: 0, max: 100 }),
  minPoints: (v, l) => check.number(v as string, l, { min: 0, decimals: 8 })
}

const NUMERIC_FIELDS: { key: keyof RaceConfig; label: string; hint?: string }[] = [
  { key: 'sportsPoints', label: 'Sports points / USD' },
  { key: 'casinoPoints', label: 'Casino points / USD' },
  { key: 'slotPoints', label: 'Slot points / USD' },
  { key: 'crashPoints', label: 'Crash points / USD' },
  { key: 'otherPoints', label: 'Other points / USD', hint: 'Roulette, table games and anything unclassified. Zero here means a third of turnover scores nothing.' },
  { key: 'prizePool', label: 'Prize pool (USD)', hint: 'Gross, in USD. The platform fee comes off before ranks are paid; prizes are paid in the reward currency at the rate of the day.' },
  { key: 'platformFeePercent', label: 'Platform fee %' },
  { key: 'winnerCount', label: 'Ranks paid' },
  { key: 'top3Percentage', label: 'Top-3 share %' },
  { key: 'minPoints', label: 'Minimum points to place' }
]

/** The operator's own ladder: one % of the net pool per rank, rank 1 first (blank lines ignored). */
const parseShares = (text: string) =>
  text
    .split(/[\n,]+/)
    .map(v => v.trim().replace(/%$/, ''))
    .filter(Boolean)
    .map(Number)

type Payout = NonNullable<PublicRace['payout']>

/**
 * The operator's own ladder as a table: rank, share of the net pool, and what that pays now.
 * Same rules as the backend (race.prizes.js buildCustomLadder): shares > 0, at most 100, never
 * rising down the ladder, total exactly 100; the number of rows becomes the ranks paid.
 */
const LadderDialog = ({ type, current, payout }: { type: RaceType; current: RaceConfig; payout?: Payout }) => {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<string[]>([])
  const shares = rows.map(v => Number(v.trim().replace(/%$/, '')))
  const total = shares.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const totalOk = Math.abs(total - 100) <= 0.01

  // A preview: the reward-currency net pool when the public read has it, else the USD net from the config.
  const net = payout ? Number(payout.netPrizePool) : Number(current.prizePool) * (1 - Number(current.platformFeePercent) / 100)
  const currency = payout?.currency ?? 'USD'
  const amountOf = (share: number) => (Number.isFinite(share) ? (net * share) / 100 : 0)

  const errors = shares.map((v, i) =>
    !Number.isFinite(v) || v <= 0 || v > 100 ? 'Above 0 and at most 100' : i > 0 && v > shares[i - 1] ? `More than rank ${i}` : undefined
  )

  const problem = !rows.length
    ? 'Add at least one rank'
    : rows.length > 500
      ? 'At most 500 ranks can be paid'
      : errors.some(Boolean)
        ? 'Fix the marked ranks'
        : !totalOk
          ? `Shares add up to ${total.toFixed(2)}% — they must total 100%`
          : null

  const invalidate = [['api', `admin/user/race/config/${type}`], ['api', 'user/race']]

  const save = useApiMutation({
    fn: () => api.put(`admin/user/race/config/${type}`, { rankShares: shares }),
    invalidate,
    success: 'Payout ladder saved',
    onSuccess: () => setOpen(false)
  })

  const reset = useApiMutation({
    fn: () => api.put(`admin/user/race/config/${type}`, { resetLadder: true }),
    invalidate,
    success: 'Back to the computed curve',
    onSuccess: () => setOpen(false)
  })

  const setRow = (i: number, v: string) => setRows(r => r.map((x, j) => (j === i ? v : x)))

  return (
    <>
      <Button
        variant='outline'
        size='sm'
        onClick={() => {
          setRows((current.rankPrizes ?? []).map(r => String(r.percentage)))
          setOpen(true)
        }}
      >
        <ListOrderedIcon /> Edit ladder
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='gap-0 p-0 sm:max-w-2xl'>
          <DialogHeader className='p-6 pb-4'>
            <DialogTitle>{type[0].toUpperCase() + type.slice(1)} race — payout ladder</DialogTitle>
            <DialogDescription>
              Each rank&apos;s share of the net pool. Shares must total 100% and never rise down the ladder; the number of rows is the ranks paid.
            </DialogDescription>
          </DialogHeader>
          <div className='bg-muted/40 flex flex-wrap items-center gap-2 border-y px-6 py-3 text-sm'>
            <Badge variant={totalOk ? 'secondary' : 'destructive'} className='tabular-nums'>
              Σ {total.toFixed(2)}% / 100%
            </Badge>
            <span className='text-muted-foreground tabular-nums'>
              {rows.length} ranks · Σ <Money value={shares.reduce((a, v) => a + amountOf(v), 0).toFixed(8)} currency={currency} /> of{' '}
              <Money value={net.toFixed(8)} currency={currency} /> net pool
            </span>
            <div className='bg-muted ml-auto h-1.5 w-32 overflow-hidden rounded-full'>
              <div className={cn('h-full transition-all', totalOk ? 'bg-primary' : 'bg-destructive')} style={{ width: `${Math.min(100, Math.max(0, total))}%` }} />
            </div>
          </div>
          <div className='max-h-[50vh] overflow-y-auto px-6'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-16'>Rank</TableHead>
                  <TableHead>Share %</TableHead>
                  <TableHead className='text-right'>Amount</TableHead>
                  <TableHead className='w-10' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v, i) => (
                  <TableRow key={i}>
                    <TableCell className='tabular-nums'>#{i + 1}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Rank ${i + 1} share`}
                        inputMode='decimal'
                        className='h-8 w-28'
                        aria-invalid={!!errors[i]}
                        value={v}
                        onChange={e => setRow(i, e.target.value)}
                      />
                      {errors[i] ? <p className='text-destructive mt-1 text-xs'>{errors[i]}</p> : null}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Money value={amountOf(shares[i]).toFixed(8)} currency={currency} />
                    </TableCell>
                    <TableCell>
                      <Button variant='ghost' size='icon-sm' aria-label={`Remove rank ${i + 1}`} onClick={() => setRows(r => r.filter((_, j) => j !== i))}>
                        <XIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button
              variant='ghost'
              size='sm'
              className='my-3'
              disabled={rows.length >= 500}
              onClick={() => setRows(r => [...r, r.length ? r[r.length - 1] : '100'])}
            >
              <PlusIcon /> Add rank
            </Button>
          </div>
          <DialogFooter className='bg-popover sticky bottom-0 items-center border-t p-4'>
            {problem ? <p className='text-destructive mr-auto text-sm'>{problem}</p> : null}
            <ConfirmDialog
              trigger={
                <Button variant='ghost' disabled={reset.isPending}>
                  <RotateCcwIcon /> Reset to curve
                </Button>
              }
              title='Go back to the computed curve?'
              description='Your own shares are replaced by the curve from the ranks paid and the top-3 share.'
              confirmLabel='Use the curve'
              onConfirm={() => reset.mutateAsync()}
            />
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!!problem || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save ladder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Daily and weekly side by side: each switch saves `enabled` at once, so both can run together. */
const RaceSwitch = ({ type }: { type: RaceType }) => {
  const q = useApi<RaceConfig>(`admin/user/race/config/${type}`, undefined, { retry: false })
  const on = !!q.data?.enabled

  const save = useApiMutation({
    fn: (enabled: boolean) => api.put(`admin/user/race/config/${type}`, { enabled }),
    invalidate: [['api', `admin/user/race/config/${type}`], ['api', 'user/race']],
    success: `${type === 'daily' ? 'Daily' : type === 'monthly' ? 'Monthly' : 'Weekly'} race ${on ? 'stopped' : 'started'}`
  })

  return (
    <Card className='py-4'>
      <CardContent className='flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <span className='font-medium'>{type === 'daily' ? 'Daily race' : type === 'monthly' ? 'Monthly race' : 'Weekly race'}</span>
          <Badge variant={on ? 'default' : 'outline'}>{on ? 'Running' : 'Off'}</Badge>
        </div>
        <Can permission='config:write'>
          <Switch
            checked={on}
            disabled={!q.data || save.isPending}
            onCheckedChange={v => save.mutate(v)}
            aria-label={`${type} race running`}
          />
        </Can>
      </CardContent>
    </Card>
  )
}

const ConfigEditor = ({ type }: { type: RaceType }) => {
  const q = useApi<RaceConfig>(`admin/user/race/config/${type}`, undefined, { retry: false })
  const pub = useApi<PublicRace[]>('user/race', undefined, { retry: false })
  const payout = pub.data?.find(r => r.type === type)?.payout
  const [draft, setDraft] = useState<Partial<RaceConfig>>({})

  // The booked ranks as typed ("3, 7"); null = show the saved list.
  const [seatsText, setSeatsText] = useState<string | null>(null)

  // The text field edits the plain ranks; seats pinned to an entry (Booked seats tab) ride along.
  const pinned = (q.data?.bookedSeats ?? []).filter(s => typeof s === 'object')

  const save = useApiMutation({
    fn: () => api.put(`admin/user/race/config/${type}`, draft.bookedSeats ? { ...draft, bookedSeats: [...draft.bookedSeats, ...pinned] } : draft),
    invalidate: [['api', `admin/user/race/config/${type}`], ['api', 'user/race']],
    success: `${type} race configuration saved`,
    onSuccess: () => {
      setDraft({})
      setSeatsText(null)
    }
  })

  if (q.error) return <ErrorState error={q.error} />
  if (q.isLoading || !q.data) return <Skeleton className='h-96' />

  // The read carries the points as `multipliers`; the save takes `<bucket>Points`.
  const m = q.data.multipliers ?? {}

  const c = {
    ...q.data,
    sportsPoints: q.data.sportsPoints ?? m.sports,
    casinoPoints: q.data.casinoPoints ?? m.casino,
    slotPoints: q.data.slotPoints ?? m.slot,
    crashPoints: q.data.crashPoints ?? m.crash,
    otherPoints: q.data.otherPoints ?? m.other,
    ...draft
  }

  const dirty = Object.keys(draft).length

  const errors = cleanErrors(
    Object.fromEntries(NUMERIC_FIELDS.filter(f => f.key in draft).map(f => [`r-${String(f.key)}`, FIELD_RULE[f.key]?.(draft[f.key], f.label)]))
  )

  if (draft.bookedSeats?.some(r => typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > Number(c.winnerCount))) {
    errors['r-seats-ranks'] = `Booked ranks must be whole ranks from 1 to ${c.winnerCount}`
  }

  const submit = () => {
    const problem = firstError(errors)

    if (problem) return void toast.error(problem)
    save.mutate()
  }

  return (
    <div className='grid gap-4 lg:grid-cols-3'>
      <Card className='shadow-none lg:col-span-2'>
        <CardHeader>
          <CardTitle className='flex items-center gap-3 text-base'>
            {type[0].toUpperCase() + type.slice(1)} race
            <StatusBadge value={c.enabled ? 'enabled' : 'disabled'} />
          </CardTitle>
          <CardDescription>A race that pays real money starts switched off. Turn it on deliberately.</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3'>
          <SwitchField id='r-enabled' label='Race is running' checked={!!c.enabled} onChange={enabled => setDraft(d => ({ ...d, enabled }))} />
          <div className='grid gap-3 sm:grid-cols-2'>
            {NUMERIC_FIELDS.map(f => (
              <TextField
                key={String(f.key)}
                id={`r-${String(f.key)}`}
                label={f.label}
                hint={f.hint}
                error={errors[`r-${String(f.key)}`]}
                value={String(c[f.key] ?? '')}
                onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              />
            ))}
          </div>
          <SwitchField
            id='r-seats'
            label='Booked seats'
            hint='Decorative entries that hold the top ranks of the board (#1, #2 … with no gap), above every real player. Their prizes stay with the house; real players are paid the rank they see, always less than a booked seat.'
            checked={!!c.bookedSeatsEnabled}
            onChange={bookedSeatsEnabled => setDraft(d => ({ ...d, bookedSeatsEnabled }))}
          />
          {c.bookedSeatsEnabled ? (
            <TextField
              id='r-seats-ranks'
              label='Booked ranks'
              hint={`The ranks any free decorative entry takes, always the top ranks with no gap, e.g. 1, 2, 3 (each sits just above the player at that rank, re-placed every minute). Only ranks up to "Ranks paid" are kept. To put a particular entry on a rank, use the Booked seats tab${pinned.length ? ` (pinned now: ${pinned.map(p => `#${p.rank}`).join(', ')})` : ''}.`}
              error={errors['r-seats-ranks']}
              value={seatsText ?? (c.bookedSeats ?? []).filter(s => typeof s === 'number').join(', ')}
              onChange={e => {
                setSeatsText(e.target.value)
                setDraft(d => ({ ...d, bookedSeats: parseShares(e.target.value) }))
              }}
            />
          ) : null}
          <Can permission='config:write'>
            <Button onClick={submit} disabled={!dirty || save.isPending} className='justify-self-start'>
              {save.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save {dirty ? `(${dirty})` : ''}
            </Button>
          </Can>
        </CardContent>
      </Card>
      <Card className='shadow-none'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            Payout ladder <Badge variant='secondary'>{q.data.ladder === 'custom' ? 'Custom' : 'Curve'}</Badge>
          </CardTitle>
          <CardDescription>
            This is the table that pays. {q.data.ladder === 'custom' ? 'Your own shares, re-priced when the pool changes.' : 'Computed from the pool, ranks paid and top-3 share when saved.'}
            {payout ? ` Paid in ${payout.currency}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-1 text-sm'>
          {payout ? (
            <div className='mb-2 flex justify-between font-medium'>
              <span>Net pool</span>
              <Money value={payout.netPrizePool} currency={payout.currency} />
            </div>
          ) : null}
          {(q.data.rankPrizes ?? []).length ? (
            q.data.rankPrizes!.map(r => {
              const paid = payout?.ranks.find(x => x.rank === r.rank)

              return (
                <div key={r.rank} className='flex justify-between'>
                  <span className='text-muted-foreground'>Rank {r.rank}</span>
                  <span className='tabular-nums'>
                    {r.percentage}% {paid ? <Money value={paid.amount} currency={payout!.currency} className='ml-2' /> : r.amount ? <Money value={r.amount} currency='USD' className='ml-2' /> : null}
                  </span>
                </div>
              )
            })
          ) : (
            <p className='text-muted-foreground'>No ladder yet. Save a pool and a rank count, or set your own ladder.</p>
          )}
          <Can permission='config:write'>
            <div className='mt-3 flex flex-wrap gap-2'>
              <LadderDialog type={type} current={q.data} payout={payout} />
            </div>
          </Can>
        </CardContent>
      </Card>
    </div>
  )
}

/** A Date as a `datetime-local` value, in the browser's own zone. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

/**
 * A staff test race with its own window (POST admin/user/race/races/test), so daily / weekly
 * payouts and booked seats can be tried in minutes instead of waiting for midnight or Monday.
 */
const TestRaceCard = () => {
  const [type, setType] = useState<RaceType>('daily')
  const [start, setStart] = useState(() => localInput(new Date()))
  const [end, setEnd] = useState(() => localInput(new Date(Date.now() + 10 * 60_000)))

  const run = useApiMutation({
    fn: () => api.post('admin/user/race/races/test', { type, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() }),
    invalidate: [['paged', 'admin/user/race/races'], ['api', `admin/user/race/leaderboard/${type}`]],
    success: 'Test race started'
  })

  return (
    <Card className='mb-4 shadow-none'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <FlaskConicalIcon className='size-4' /> Test race
        </CardTitle>
        <CardDescription>Open a race over a window you choose (at most a day for daily, a week for weekly). Settle or cancel the open race of that type first.</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap items-end gap-3'>
        <Select value={type} onValueChange={v => v && setType(v as RaceType)}>
          <SelectTrigger className='w-32' aria-label='Race type'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='daily'>Daily</SelectItem>
            <SelectItem value='weekly'>Weekly</SelectItem>
            <SelectItem value='monthly'>Monthly</SelectItem>
          </SelectContent>
        </Select>
        <label className='grid gap-1 text-sm'>
          Start
          <Input type='datetime-local' className='w-56' value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className='grid gap-1 text-sm'>
          End
          <Input type='datetime-local' className='w-56' value={end} onChange={e => setEnd(e.target.value)} />
        </label>
        <Can permission='config:write'>
          <ConfirmDialog
            trigger={
              <Button disabled={!start || !end || run.isPending}>
                <FlaskConicalIcon /> Start
              </Button>
            }
            title={`Start a ${type} test race?`}
            description='It counts only the wagers placed between Start and End. It pays from the current configuration (pool, ranks, booked seats) when you End & pay it, or automatically within 5 minutes after the end time. Use it for testing: the prizes are real rewards.'
            confirmLabel='Start test race'
            onConfirm={() => run.mutateAsync()}
          />
        </Can>
      </CardContent>
    </Card>
  )
}

const RacesTab = () => {
  const { state, set, query } = useListState(['type'])
  const list = usePagedApi<Race>('admin/user/race/races', { limit: query.limit, page: query.page, type: query.type || undefined })

  const settle = useApiMutation({
    fn: (id: number) => api.post(`admin/user/race/races/${id}/settle`),
    invalidate: [['paged', 'admin/user/race/races'], ['paged', 'admin/user/race/rewards']],
    success: 'Race settled — rewards written'
  })

  const [reason, setReason] = useState('')

  const cancel = useApiMutation({
    fn: (id: number) => api.post(`admin/user/race/races/${id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}),
    invalidate: [['paged', 'admin/user/race/races']],
    success: 'Race cancelled — no prizes written',
    onSuccess: () => setReason('')
  })

  const [winnersOf, setWinnersOf] = useState<number | null>(null)

  const columns: Column<Race>[] = [
    { key: 'id', header: 'Race', cell: r => <span className='font-mono text-xs'>#{r.id}</span> },
    {
      key: 'type',
      header: 'Type',
      cell: r => (
        <span className='flex gap-1'>
          <Badge variant='secondary'>{r.type}</Badge>
          {r.test ? <Badge variant='outline'>TEST</Badge> : null}
        </span>
      )
    },
    { key: 'window', header: 'Window', cell: r => <span className='text-xs'><DateTime value={r.startsAt ?? r.starts_at} /> → <DateTime value={r.endsAt ?? r.ends_at} /></span> },

    // An open race takes its pool from the config at settlement; only a closed one has its own.
    { key: 'pool', header: 'Pool (USD)', align: 'right', cell: r => (r.status === 'open' ? <span className='text-muted-foreground text-xs'>From config</span> : <Money value={r.prizePool} />) },
    { key: 'awarded', header: 'Awarded (USD)', align: 'right', cell: r => (r.status === 'settled' ? <Money value={r.totalAwarded} /> : '—') },
    {
      key: 'status',
      header: 'Status',
      cell: r => (
        <span title={r.cancelReason ?? undefined}>
          <StatusBadge value={r.status ?? (r.settledAt ? 'settled' : 'open')} />
        </span>
      )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r =>
        r.status === 'settled' ? (
          <Button variant='ghost' size='sm' onClick={() => setWinnersOf(r.id)}>
            <TrophyIcon /> Winners
          </Button>
        ) : r.status === 'cancelled' ? null : (
          <Can permission='config:write'>
            <div className='flex justify-end gap-1'>
              <ConfirmDialog
                trigger={
                  <Button variant='outline' size='sm'>
                    <FlagIcon /> End & pay
                  </Button>
                }
                title={`End race #${r.id} now and pay it?`}
                description='Ranks are frozen now and rewards are written to the winners. The next race opens with the next window. This cannot be undone.'
                confirmLabel='End & pay'
                onConfirm={() => settle.mutateAsync(r.id)}
              />
              <FormDialog
                trigger={
                  <Button variant='ghost' size='sm'>
                    <BanIcon /> Cancel
                  </Button>
                }
                title={`Cancel race #${r.id}?`}
                description='The race closes with NO prizes. The next race opens with the next window; switch the race off first to stop races altogether.'
                submitLabel='Cancel race'
                destructive
                onSubmit={() => cancel.mutateAsync(r.id)}
                validate={() => ({ 'cancel-reason': check.length(reason, 'Reason', { max: 200 }) })}
              >
                <TextField id='cancel-reason' label='Reason (kept in the activity log)' maxLength={200} value={reason} onChange={e => setReason(e.target.value)} />
              </FormDialog>
            </div>
          </Can>
        )
    }
  ]

  return (
    <>
    {winnersOf !== null ? <WinnersDialog raceId={winnersOf} onClose={() => setWinnersOf(null)} /> : null}
    <TestRaceCard />
    <DataTable
      columns={columns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      emptyMessage='No race has opened yet. The user-service worker opens them on schedule once a config is enabled.'
      toolbar={
        <Select value={String(state.type || 'all')} onValueChange={v => v && set({ type: v === 'all' ? '' : v })}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Any type</SelectItem>
            <SelectItem value='daily'>Daily</SelectItem>
            <SelectItem value='weekly'>Weekly</SelectItem>
            <SelectItem value='monthly'>Monthly</SelectItem>
          </SelectContent>
        </Select>
      }
    />
    </>
  )
}

/** A settled race's prize rows (rank, player, points, prize, claimed). */
const WinnersDialog = ({ raceId, onClose }: { raceId: number; onClose: () => void }) => {
  const list = usePagedApi<Reward>('admin/user/race/rewards', { raceId, limit: 100, page: 1 })
  const rows = list.data?.rows

  return (
    <Dialog open onOpenChange={o => (!o ? onClose() : undefined)}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Race #{raceId} — winners</DialogTitle>
          <DialogDescription>The prizes this race wrote. Players claim them into their wallet.</DialogDescription>
        </DialogHeader>
        <RewardStats summary={list.data?.meta?.summary as RewardSummary | undefined} loading={list.isLoading} compact />
        <DataTable
          columns={[
            { key: 'rank', header: 'Rank', cell: r => <span className='tabular-nums'>{r.rank}</span> },
            { key: 'user', header: 'User', cell: r => r.username ?? `#${r.userId}` },
            { key: 'points', header: 'Points', align: 'right', cell: r => <span className='font-mono tabular-nums'>{r.points}</span> },
            { key: 'amount', header: 'Prize', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
            { key: 'claimed', header: 'Claimed', cell: r => <StatusBadge value={r.claimed ? 'completed' : 'pending'} /> },
            { key: 'claimedAt', header: 'Claimed at', cell: r => (r.claimedAt ? <DateTime value={r.claimedAt} /> : '—') }
          ]}
          rows={rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          error={list.error}
          dense
          emptyMessage='Nobody placed in this race.'
        />
      </DialogContent>
    </Dialog>
  )
}

/** The open window's standings, as players see them (real ids for staff). */
const BoardTab = () => {
  const [type, setType] = useState<RaceType>('daily')

  /* A plain 5s timer, not useLivePoll: nothing pushes the race board over the realtime socket, so
     useLivePoll would stop refreshing exactly while the socket is up. */
  const q = useApi<Board>(`admin/user/race/leaderboard/${type}`, undefined, { retry: false, refetchInterval: 5_000 })
  const currency = q.data?.payoutCurrency ?? q.data?.currency

  // Rows whose rank or points moved since the previous fetch, highlighted for a moment.
  const keyOf = (r: BoardRow) => (r.isBoat ? `boat:${r.name}` : `user:${r.userId}`)
  const prev = useRef<Map<string, string> | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())

  useEffect(() => {
    const rows = q.data?.leaderboard

    if (!rows) return
    const next = new Map(rows.map(r => [keyOf(r), `${r.rank}|${r.points}`]))
    const moved = prev.current ? new Set([...next].filter(([k, v]) => prev.current!.get(k) !== v).map(([k]) => k)) : new Set<string>()

    prev.current = next
    setChanged(moved)
    if (!moved.size) return
    const t = setTimeout(() => setChanged(new Set()), 2_500)

    return () => clearTimeout(t)
  }, [q.data])

  useEffect(() => {
    prev.current = null // a different race type is not a change of standings
  }, [type])

  // "updated Ns ago" ticks every second.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)

    return () => clearInterval(t)
  }, [])
  const ago = q.dataUpdatedAt ? Math.max(0, Math.round((now - q.dataUpdatedAt) / 1000)) : null
  const flash = (r: BoardRow) => (changed.has(keyOf(r)) ? 'rounded bg-amber-400/25 px-1 transition-colors' : 'px-1 transition-colors')

  const columns: Column<BoardRow>[] = [
    { key: 'rank', header: 'Rank', cell: r => <span className={cn('tabular-nums', flash(r))}>{r.rank}</span> },
    { key: 'user', header: 'Player', cell: r => (r.isBoat ? <Badge variant='outline'>Booked seat · {r.name}</Badge> : <span>{r.name ?? '—'} <span className='text-muted-foreground font-mono text-xs'>#{r.userId}</span></span>) },
    { key: 'wagered', header: 'Wagered (USD)', align: 'right', cell: r => <Money value={r.usdWagered} /> },
    { key: 'bets', header: 'Bets', align: 'right', cell: r => <span className='tabular-nums'>{r.bets}</span> },
    { key: 'points', header: 'Points', align: 'right', cell: r => <span className={cn('font-mono tabular-nums', flash(r))}>{r.points}</span> },
    { key: 'prize', header: 'Prize now', align: 'right', cell: r => (r.isBoat /* not paid: the house keeps a booked seat's prize */ ? <span className='text-muted-foreground'><Money value={r.payout ?? r.reward} currency={currency} /> (house)</span> : <Money value={r.payout ?? r.reward} currency={currency} />) }
  ]

  return (
    <div className='grid gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Tabs value={type} onValueChange={v => setType(v as RaceType)}>
          <TabsList>
            <TabsTrigger value='daily'>Daily</TabsTrigger>
            <TabsTrigger value='weekly'>Weekly</TabsTrigger>
            <TabsTrigger value='monthly'>Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
        {q.data ? (
          <span className='text-muted-foreground text-sm'>
            Race #{q.data.raceId} · <DateTime value={q.data.startsAt} /> → <DateTime value={q.data.endsAt} /> · top {q.data.winnerCount} paid
          </span>
        ) : null}
        {ago !== null ? (
          <span className={cn('text-xs', q.isError ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')}>
            ● Live · updated {ago}s ago{q.isFetching ? ' · refreshing' : ''}
          </span>
        ) : null}
      </div>
      {q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <DataTable columns={columns} rows={q.data?.leaderboard} rowKey={r => `${r.rank}`} loading={q.isLoading} dense emptyMessage='Nobody has scored in this window yet.' />
      )}
    </div>
  )
}

/** Winners, claimed, not claimed and the total, from the list's `meta.summary`. */
const RewardStats = ({ summary, loading, compact }: { summary?: RewardSummary; loading?: boolean; compact?: boolean }) => {
  const money = (v?: string) => <Money value={v ?? '0'} currency={summary?.currency} />
  const count = (n?: number) => `${formatNumber(n ?? 0)} ${n === 1 ? 'prize' : 'prizes'}`

  return (
    <div className={compact ? 'grid grid-cols-2 gap-2 sm:grid-cols-4' : 'mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4'}>
      <StatCard label='Winners' value={formatNumber(summary?.winners ?? 0)} hint={count(summary?.total.count)} loading={loading} />
      <StatCard label='Claimed' value={money(summary?.claimed.amount)} hint={count(summary?.claimed.count)} loading={loading} />
      <StatCard label='Not claimed' value={money(summary?.unclaimed.amount)} hint={count(summary?.unclaimed.count)} loading={loading} />
      <StatCard label='Total' value={money(summary?.total.amount)} hint={count(summary?.total.count)} loading={loading} />
    </div>
  )
}

const RewardsTab = () => {
  const { state, set, query } = useListState(['type', 'claimed', 'raceId'])

  const list = usePagedApi<Reward>('admin/user/race/rewards', {
    limit: query.limit,
    page: query.page,
    type: query.type || undefined,
    claimed: query.claimed || undefined,
    raceId: /^\d+$/.test(String(query.raceId ?? '')) ? query.raceId : undefined
  })

  const columns: Column<Reward>[] = [
    {
      key: 'race',
      header: 'Race',
      cell: r => (
        <span className='whitespace-nowrap'>
          #{r.raceId} · {r.type === 'monthly' ? 'Monthly' : r.type === 'weekly' ? 'Weekly' : 'Daily'} · {formatDate(r.raceStartsAt, false)}
        </span>
      )
    },
    { key: 'rank', header: 'Rank', cell: r => <span className='tabular-nums'>{r.rank ?? '—'}</span> },
    { key: 'user', header: 'User', cell: r => <span>{r.username ?? `#${r.userId}`}</span> },
    { key: 'points', header: 'Points', align: 'right', cell: r => <span className='font-mono tabular-nums'>{r.points ?? '—'}</span> },
    { key: 'amount', header: 'Reward', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
    { key: 'claimed', header: 'Claimed', cell: r => <StatusBadge value={r.claimed ? 'completed' : 'pending'} /> },
    { key: 'claimedAt', header: 'Claimed at', cell: r => (r.claimedAt ? <DateTime value={r.claimedAt} /> : '—') },
    { key: 'at', header: 'Won', cell: r => <DateTime value={r.createdAt} relative /> }
  ]

  return (
    <>
    {list.error ? null : <RewardStats summary={list.data?.meta?.summary as RewardSummary | undefined} loading={list.isLoading} />}
    <DataTable
      columns={columns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      dense
      toolbar={
        <>
          <Select value={String(state.type || 'all')} onValueChange={v => v && set({ type: v === 'all' ? '' : v })}>
            <SelectTrigger className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Any type</SelectItem>
              <SelectItem value='daily'>Daily</SelectItem>
              <SelectItem value='weekly'>Weekly</SelectItem>
            <SelectItem value='monthly'>Monthly</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(state.claimed || 'all')} onValueChange={v => v && set({ claimed: v === 'all' ? '' : v })}>
            <SelectTrigger className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Claimed or not</SelectItem>
              <SelectItem value='true'>Claimed</SelectItem>
              <SelectItem value='false'>Unclaimed</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className='w-28'
            inputMode='numeric'
            placeholder='Race #'
            aria-label='Race id'
            value={String(state.raceId ?? '')}
            onChange={e => set({ raceId: e.target.value.replace(/\D/g, '') })}
          />
        </>
      }
    />
    </>
  )
}

/**
 * Which rank an entry holds in one race type. Saving writes that type's `bookedSeats`: this
 * entry's pin moves to the chosen rank (any plain seat on that rank is replaced); a rank pinned
 * to another entry is disabled, so a rank is used once and an entry sits on one rank.
 */
const SeatSelect = ({ type, boat }: { type: RaceType; boat: Boat }) => {
  const cfg = useApi<RaceConfig>(`admin/user/race/config/${type}`, undefined, { retry: false })
  const boats = useApi<Boat[]>('admin/user/race/boats', undefined, { retry: false })
  const seats = cfg.data?.bookedSeats ?? []
  const pinOf = (s: Seat) => (typeof s === 'object' ? s : null)
  const mine = seats.map(pinOf).find(p => p?.boatId === boat.id)?.rank
  const holder = (rank: number) => seats.map(pinOf).find(p => p?.rank === rank && p.boatId !== boat.id)

  const save = useApiMutation({
    fn: (rank: number | null) =>
      api.put(`admin/user/race/config/${type}`, {
        bookedSeats: [
          ...seats.filter(s => (typeof s === 'number' ? s !== rank : s.boatId !== boat.id && s.rank !== rank)),
          ...(rank ? [{ rank, boatId: boat.id }] : [])
        ]
      }),
    invalidate: [['api', `admin/user/race/config/${type}`], ['api', 'user/race']],
    success: 'Seat saved'
  })

  if (!cfg.data) return <Skeleton className='h-8 w-28' />

  return (
    <Can permission='config:write' fallback={<span className='tabular-nums'>{mine ? `#${mine}` : '—'}</span>}>
      <div className='flex items-center gap-2'>
        <Select value={mine ? String(mine) : 'none'} onValueChange={v => v && save.mutate(v === 'none' ? null : Number(v))} disabled={save.isPending}>
          <SelectTrigger className='w-36' aria-label={`${type} seat for ${boat.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='none'>None</SelectItem>
            {Array.from({ length: cfg.data.winnerCount }, (_, i) => i + 1).map(rank => {
              const other = holder(rank)

              return (
                <SelectItem key={rank} value={String(rank)} disabled={!!other}>
                  #{rank}
                  {other ? ` · ${boats.data?.find(b => b.id === other.boatId)?.name ?? 'taken'}` : ''}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {!cfg.data.bookedSeatsEnabled ? <span className='text-muted-foreground text-xs'>seats off</span> : null}
      </div>
    </Can>
  )
}

const BoatsTab = () => {
  const list = useApi<Boat[]>('admin/user/race/boats', undefined, { retry: false })
  const [name, setName] = useState('')

  const add = useApiMutation({
    fn: () => api.post('admin/user/race/boats', { name, isActive: true }),
    invalidate: [['api', 'admin/user/race/boats']],
    success: 'Entry added',
    onSuccess: () => setName('')
  })

  const toggle = useApiMutation({
    fn: (v: { id: number; isActive: boolean }) => api.put(`admin/user/race/boats/${v.id}`, { isActive: v.isActive }),
    invalidate: [['api', 'admin/user/race/boats']],
    success: 'Entry updated'
  })

  const remove = useApiMutation({
    fn: (id: number) => api.delete(`admin/user/race/boats/${id}`),
    invalidate: [['api', 'admin/user/race/boats']],
    success: 'Entry removed'
  })

  const columns: Column<Boat>[] = [
    { key: 'name', header: 'Name', cell: b => b.name },
    { key: 'daily', header: 'Daily seat', cell: b => <SeatSelect type='daily' boat={b} /> },
    { key: 'weekly', header: 'Weekly seat', cell: b => <SeatSelect type='weekly' boat={b} /> },
    { key: 'active', header: 'Shown', cell: b => <Can permission='config:write' fallback={<StatusBadge value={b.isActive} />}><Button variant='ghost' size='sm' disabled={toggle.isPending} onClick={() => toggle.mutate({ id: b.id, isActive: !b.isActive })}><StatusBadge value={b.isActive ? 'active' : 'inactive'} /></Button></Can> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: b => (
        <Can permission='config:write'>
          <ConfirmDialog
            trigger={
              <Button variant='ghost' size='icon-sm' aria-label='Remove'>
                <Trash2Icon />
              </Button>
            }
            title={`Remove “${b.name}”?`}
            confirmLabel='Remove'
            destructive
            onConfirm={() => remove.mutateAsync(b.id)}
          />
        </Can>
      )
    }
  ]

  return (
    <div className='grid gap-4'>
      <p className='text-muted-foreground text-sm'>
        Decorative entries shown on the leaderboard beside real users, when booked seats are switched on for a race type (Configuration). Pick the rank an entry holds in each race; an entry that is not shown gives its seat to any free entry. Plain booked ranks from the Configuration tab take whichever entry is left.
      </p>
      <Can permission='config:write'>
        <FormDialog
          trigger={
            <Button className='justify-self-start'>
              <PlusIcon /> Add entry
            </Button>
          }
          title='Add a booked seat'
          submitLabel='Add'
          onSubmit={() => add.mutateAsync()}
          validate={() => ({ 'boat-name': check.required(name, 'Display name') || check.length(name, 'Display name', { max: 60 }) })}
        >
          <TextField id='boat-name' label='Display name' required maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        </FormDialog>
      </Can>
      <DataTable columns={columns} rows={list.data} rowKey={b => b.id} loading={list.isLoading} error={list.error} dense emptyMessage='No booked seats configured.' />
    </div>
  )
}

const Races = () => {
  const [type, setType] = useState<RaceType>('daily')

  return (
    <div>
      <PageHeader title='Wagering races' />
      <Tabs defaultValue='config'>
        <TabsList className='mb-4'>
          <TabsTrigger value='config'>Configuration</TabsTrigger>
          <TabsTrigger value='board'>Live board</TabsTrigger>
          <TabsTrigger value='races'>Races & history</TabsTrigger>
          <TabsTrigger value='rewards'>Rewards</TabsTrigger>
          <TabsTrigger value='boats'>Booked seats</TabsTrigger>
        </TabsList>
        <TabsContent value='config'>
          <div className='mb-4 grid gap-3 sm:grid-cols-3'>
            <RaceSwitch type='daily' />
            <RaceSwitch type='weekly' />
            <RaceSwitch type='monthly' />
          </div>
          <Tabs value={type} onValueChange={v => setType(v as RaceType)} className='mb-4'>
            <TabsList>
              <TabsTrigger value='daily'>Daily</TabsTrigger>
              <TabsTrigger value='weekly'>Weekly</TabsTrigger>
            <TabsTrigger value='monthly'>Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
          <ConfigEditor key={type} type={type} />
        </TabsContent>
        <TabsContent value='board'>
          <BoardTab />
        </TabsContent>
        <TabsContent value='races'>
          <RacesTab />
        </TabsContent>
        <TabsContent value='rewards'>
          <RewardsTab />
        </TabsContent>
        <TabsContent value='boats'>
          <BoatsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default Races
