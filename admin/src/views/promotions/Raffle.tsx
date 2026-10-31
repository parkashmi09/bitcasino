'use client'

import { useState } from 'react'

import Link from 'next/link'
import { DicesIcon, Settings2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { SwitchField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import { formatIn } from '@/components/shared/ReportMoney'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

/** `admin/user/raffle/*` — the user-service raffle module (rainbet). */
const BASE = 'admin/user/raffle'

type Config = { enabled: boolean; prizePoolUsd: string; winners: number; wagerPerTicketUsd: string; updatedAt: string }
type Draw = {
  number: number
  startsAt: string
  drawAt: string
  status: 'OPEN' | 'DRAWN'
  prizePoolUsd: string
  winners: number
  prizeUsd: string
  wagerPerTicketUsd: string
  tickets: number
  paidWinners: number
}
type Winner = { userId: string; player: string | null; ticket: string | null; prizeUsd: string; currency: string | null; amount: string | null; paid: boolean }

const usd = (v: string | number) => formatIn(Number(v), 'USD')

/** The settings — they apply to the next draw that opens; a running draw keeps its own. */
const SettingsDialog = ({ config }: { config: Config }) => {
  const [form, setForm] = useState({
    enabled: config.enabled,
    prizePoolUsd: String(Number(config.prizePoolUsd)),
    winners: String(config.winners),
    wagerPerTicketUsd: String(Number(config.wagerPerTicketUsd))
  })

  const save = useApiMutation({
    fn: () =>
      api.put(`${BASE}/config`, {
        enabled: form.enabled,
        prizePoolUsd: Number(form.prizePoolUsd),
        winners: Number(form.winners),
        wagerPerTicketUsd: Number(form.wagerPerTicketUsd)
      }),
    invalidate: [['api', `${BASE}/config`]],
    success: 'Raffle settings saved'
  })

  return (
    <FormDialog
      trigger={
        <Button variant='outline'>
          <Settings2Icon /> Settings
        </Button>
      }
      title='Raffle settings'
      description='Used by the next draw that opens (each Sunday 00:00 UTC). The draw running now keeps the settings it opened with.'
      submitLabel='Save'
      onSubmit={() => save.mutateAsync()}
      validate={() => ({
        'rf-pool': check.amount(form.prizePoolUsd),
        'rf-win': check.id(form.winners, 'Winners'),
        'rf-per': check.amount(form.wagerPerTicketUsd)
      })}
    >
      <SwitchField id='rf-on' label='Raffle on' hint='Off: players cannot claim free tickets. The page itself follows the owner’s Raffles feature.' checked={form.enabled} onChange={enabled => setForm({ ...form, enabled })} />
      <TextField id='rf-pool' label='Prize pool (USD)' required inputMode='decimal' value={form.prizePoolUsd} onChange={e => setForm({ ...form, prizePoolUsd: e.target.value })} />
      <TextField id='rf-win' label='Winning tickets per draw' required inputMode='numeric' hint='Each pays prize pool ÷ winners, in the reward currency.' value={form.winners} onChange={e => setForm({ ...form, winners: e.target.value.replace(/\D/g, '') })} />
      <TextField id='rf-per' label='Wager per extra ticket (USD)' required inputMode='decimal' hint='One ticket for every this much staked in the draw’s week, on top of the free ticket.' value={form.wagerPerTicketUsd} onChange={e => setForm({ ...form, wagerPerTicketUsd: e.target.value })} />
    </FormDialog>
  )
}

const winnerColumns: Column<Winner>[] = [
  { key: 'ticket', header: 'Ticket', cell: r => <span className='font-mono'>{r.ticket ?? '—'}</span> },
  {
    key: 'player',
    header: 'Player',
    cell: r => (
      <Link href={`/users/${r.userId}`} className='hover:underline'>
        {r.player ?? `#${r.userId}`}
      </Link>
    )
  },
  { key: 'prize', header: 'Prize', align: 'right', cell: r => <span className='font-mono tabular-nums'>{usd(r.prizeUsd)}</span> },
  {
    key: 'paid',
    header: 'Credited',
    cell: r => (r.paid ? <span className='font-mono text-sm'>{`${Number(r.amount)} ${r.currency}`}</span> : <Badge variant='outline'>Pending</Badge>)
  }
]

const DrawWinners = ({ number }: { number: number }) => {
  const q = useApi<{ winners: Winner[] }>(`${BASE}/draws/${number}`)

  if (q.error) return <ErrorState error={q.error} />

  return <DataTable columns={winnerColumns} rows={q.data?.winners} loading={!q.data} rowKey={r => `${r.ticket}`} emptyMessage='No winners in this draw.' />
}

/**
 * Admin → Promotions → Raffle: the weekly raffle's settings, its draws and their winners, and
 * making the running draw now (it closes early and pays its winners).
 */
const Raffle = () => {
  const config = useApi<Config>(`${BASE}/config`)
  const draws = useApi<Draw[]>(`${BASE}/draws`, { limit: 20 })
  const [shown, setShown] = useState<number | null>(null)

  const drawNow = useApiMutation({
    fn: (n: number) => api.post(`${BASE}/draws/${n}/draw`),
    invalidate: [['api', `${BASE}/draws`]],
    success: 'Draw made and winners credited'
  })

  if (config.error) return <ErrorState error={config.error} />
  const running = draws.data?.find(d => d.status === 'OPEN')

  const columns: Column<Draw>[] = [
    { key: 'number', header: 'Draw', cell: r => <span className='font-medium'>#{r.number}</span> },
    { key: 'at', header: 'Draw time', cell: r => <DateTime value={r.drawAt} /> },
    { key: 'status', header: 'Status', cell: r => <Badge variant={r.status === 'OPEN' ? 'default' : 'secondary'}>{r.status === 'OPEN' ? 'Running' : 'Drawn'}</Badge> },
    { key: 'pool', header: 'Pool', align: 'right', cell: r => <span className='font-mono tabular-nums'>{usd(r.prizePoolUsd)}</span> },
    { key: 'tickets', header: 'Tickets', align: 'right', cell: r => <span className='tabular-nums'>{r.tickets}</span> },
    { key: 'paid', header: 'Paid winners', align: 'right', cell: r => <span className='tabular-nums'>{r.status === 'DRAWN' ? `${r.paidWinners}` : '—'}</span> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: r =>
        r.status === 'DRAWN' ? (
          <Button variant='ghost' size='sm' onClick={() => setShown(shown === r.number ? null : r.number)}>
            {shown === r.number ? 'Hide winners' : 'Winners'}
          </Button>
        ) : null
    }
  ]

  return (
    <div className='space-y-6'>
      <PageHeader
        title='Weekly raffle'
        description='A free ticket per player per draw, plus one per wager step. Every Sunday 00:00 UTC the winning tickets are drawn at random and paid automatically in the reward currency.'
        actions={
          <Can permission='config:write'>
            <div className='flex gap-2'>
              {config.data && <SettingsDialog key={config.data.updatedAt} config={config.data} />}
              {running && (
                <ConfirmDialog
                  trigger={
                    <Button>
                      <DicesIcon /> Draw now
                    </Button>
                  }
                  title={`Make draw #${running.number} now?`}
                  description='The running draw closes early: its winning tickets are picked and paid now, and no more tickets join it. Players can claim again when the next draw opens on Sunday.'
                  confirmLabel='Draw now'
                  destructive
                  onConfirm={() => drawNow.mutateAsync(running.number)}
                />
              )}
            </div>
          </Can>
        }
      />

      {config.data && (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <StatCard label='Status' value={config.data.enabled ? 'On' : 'Off'} />
          <StatCard label='Prize pool' value={usd(config.data.prizePoolUsd)} />
          <StatCard label='Winners per draw' value={String(config.data.winners)} />
          <StatCard label='Wager per ticket' value={usd(config.data.wagerPerTicketUsd)} />
        </div>
      )}

      <Card className='shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Draws</CardTitle>
        </CardHeader>
        <CardContent>
          {draws.error ? <ErrorState error={draws.error} /> : <DataTable columns={columns} rows={draws.data} loading={!draws.data} rowKey={r => String(r.number)} emptyMessage='No draws yet.' />}
        </CardContent>
      </Card>

      {shown !== null && (
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='text-base'>Winners — draw #{shown}</CardTitle>
          </CardHeader>
          <CardContent>
            <DrawWinners number={shown} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default Raffle
