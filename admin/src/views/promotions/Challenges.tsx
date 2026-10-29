'use client'

import { useState } from 'react'

import Link from 'next/link'
import { PlusIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { formatIn } from '@/components/shared/ReportMoney'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import type { GisGame } from '@/views/casino/types'

/** `admin/casino/challenges` — the casino-service challenges module (rainbet). */
const BASE = 'admin/casino/challenges'

type Winner = { userId: string; player: string | null; multiplier: string; currency: string | null; amount: string | null; paid: boolean; at: string }
type Challenge = {
  id: string
  game: string
  gameName: string
  minMultiplier: string
  minBetUsd: string
  prizeUsd: string
  winners: number
  startsAt: string
  endsAt: string
  status: 'ACTIVE' | 'CANCELLED'
  winnersList: Winner[]
}

const usd = (v: string) => formatIn(Number(v), 'USD')
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

const CreateChallenge = () => {
  const [q, setQ] = useState('')
  const found = useApi<GisGame[]>(q.trim().length >= 2 ? 'admin/casino/games/catalogue/search' : null, { q: q.trim(), limit: 20 })
  const [picked, setPicked] = useState<GisGame | null>(null)
  const [form, setForm] = useState({ minMultiplier: '', minBetUsd: '0.10', prizeUsd: '', winners: '1', endsAt: inDays(30) })

  const create = useApiMutation({
    fn: () =>
      api.post(BASE, {
        game: picked?.uuid,
        gameName: picked?.name,
        ...(picked?.image ? { imageUrl: picked.image } : {}),
        minMultiplier: Number(form.minMultiplier),
        minBetUsd: Number(form.minBetUsd),
        prizeUsd: Number(form.prizeUsd),
        winners: Number(form.winners),
        endsAt: new Date(`${form.endsAt}T23:59:59Z`).toISOString()
      }),
    invalidate: [['api', BASE]],
    success: 'Challenge created',
    onSuccess: () => setForm({ ...form, minMultiplier: '', prizeUsd: '' })
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> New challenge
        </Button>
      }
      title='New challenge'
      description='The first players to land the multiplier on the game, with at least the minimum bet, win the prize — paid automatically in the coin they bet in.'
      submitLabel='Create'
      onSubmit={() => create.mutateAsync()}
      validate={() => ({
        'ch-game': picked ? undefined : 'Pick a game',
        'ch-mult': Number(form.minMultiplier) > 1 ? undefined : 'Above 1x',
        'ch-bet': check.amount(form.minBetUsd),
        'ch-prize': check.amount(form.prizeUsd),
        'ch-win': check.id(form.winners, 'Winners'),
        'ch-end': form.endsAt ? undefined : 'Pick an end date'
      })}
    >
      <TextField
        id='ch-game'
        label='Game'
        required
        placeholder='Search the catalogue…'
        hint={picked ? `Picked: ${picked.name}${picked.provider ? ` · ${picked.provider}` : ''}` : 'Type at least two letters, then pick a game below.'}
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      {(found.data ?? []).length > 0 && (
        <div className='max-h-40 overflow-y-auto rounded-md border'>
          {(found.data ?? []).map(g => (
            <button
              key={g.uuid}
              type='button'
              className={`hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${picked?.uuid === g.uuid ? 'bg-muted font-medium' : ''}`}
              onClick={() => setPicked(g)}
            >
              <span>{g.name}</span>
              <span className='text-muted-foreground text-xs'>{g.provider}</span>
            </button>
          ))}
        </div>
      )}
      <TextField id='ch-mult' label='Multiplier to hit' required inputMode='decimal' placeholder='1000' value={form.minMultiplier} onChange={e => setForm({ ...form, minMultiplier: e.target.value })} />
      <TextField id='ch-bet' label='Minimum bet (USD)' required inputMode='decimal' value={form.minBetUsd} onChange={e => setForm({ ...form, minBetUsd: e.target.value })} />
      <TextField id='ch-prize' label='Prize (USD)' required inputMode='decimal' value={form.prizeUsd} onChange={e => setForm({ ...form, prizeUsd: e.target.value })} />
      <TextField id='ch-win' label='Number of winners' required inputMode='numeric' value={form.winners} onChange={e => setForm({ ...form, winners: e.target.value.replace(/\D/g, '') })} />
      <TextField id='ch-end' label='Ends on (UTC)' required type='date' value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} />
    </FormDialog>
  )
}

/** Admin → Promotions → Challenges: per-game multiplier challenges and their winners. */
const Challenges = () => {
  const list = useApi<Challenge[]>(BASE)
  const [shown, setShown] = useState<string | null>(null)
  const cancel = useApiMutation({ fn: (id: string) => api.post(`${BASE}/${id}/cancel`), invalidate: [['api', BASE]], success: 'Challenge cancelled' })

  const columns: Column<Challenge>[] = [
    { key: 'game', header: 'Game', cell: r => <span className='font-medium'>{r.gameName}</span> },
    { key: 'goal', header: 'Goal', cell: r => `${Number(r.minMultiplier)}x · min ${usd(r.minBetUsd)}` },
    { key: 'prize', header: 'Prize', align: 'right', cell: r => <span className='font-mono tabular-nums'>{usd(r.prizeUsd)}</span> },
    { key: 'won', header: 'Winners', align: 'right', cell: r => `${r.winnersList.length} / ${r.winners}` },
    { key: 'ends', header: 'Ends', cell: r => <DateTime value={r.endsAt} /> },
    {
      key: 'status',
      header: 'Status',
      cell: r => {
        const done = r.winnersList.length >= r.winners || new Date(r.endsAt) <= new Date()

        return <Badge variant={r.status === 'CANCELLED' ? 'secondary' : done ? 'outline' : 'default'}>{r.status === 'CANCELLED' ? 'Cancelled' : done ? 'Completed' : 'Running'}</Badge>
      }
    },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: r => (
        <div className='flex justify-end gap-2'>
          {r.winnersList.length > 0 && (
            <Button variant='ghost' size='sm' onClick={() => setShown(shown === r.id ? null : r.id)}>
              {shown === r.id ? 'Hide winners' : 'Winners'}
            </Button>
          )}
          {r.status === 'ACTIVE' && (
            <Can permission='config:write'>
              <ConfirmDialog
                trigger={
                  <Button variant='ghost' size='sm'>
                    Cancel
                  </Button>
                }
                title='Cancel this challenge?'
                description='It disappears from the player site and nobody else can win it. Prizes already paid stay paid.'
                confirmLabel='Cancel challenge'
                destructive
                onConfirm={() => cancel.mutateAsync(r.id)}
              />
            </Can>
          )}
        </div>
      )
    }
  ]

  const selected = list.data?.find(c => c.id === shown)

  const winnerColumns: Column<Winner>[] = [
    { key: 'at', header: 'When', cell: r => <DateTime value={r.at} /> },
    {
      key: 'player',
      header: 'Player',
      cell: r => (
        <Link href={`/users/${r.userId}`} className='hover:underline'>
          {r.player ?? `#${r.userId}`}
        </Link>
      )
    },
    { key: 'mult', header: 'Multiplier', align: 'right', cell: r => `${Number(r.multiplier)}x` },
    { key: 'paid', header: 'Paid', align: 'right', cell: r => (r.paid ? `${Number(r.amount)} ${r.currency}` : <Badge variant='outline'>Pending</Badge>) }
  ]

  return (
    <div className='space-y-6'>
      <PageHeader
        title='Challenges'
        description='Per-game multiplier challenges shown on the player site’s Challenges page. Rounds are checked as they settle.'
        actions={
          <Can permission='config:write'>
            <CreateChallenge />
          </Can>
        }
      />
      {list.error ? <ErrorState error={list.error} /> : <DataTable columns={columns} rows={list.data} loading={!list.data} rowKey={r => r.id} emptyMessage='No challenge yet.' />}
      {selected && (
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='text-base'>Winners — {selected.gameName}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={winnerColumns} rows={selected.winnersList} rowKey={r => r.userId} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default Challenges
