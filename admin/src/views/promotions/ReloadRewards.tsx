'use client'

import { useState } from 'react'

import Link from 'next/link'
import { Settings2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { SwitchField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { formatIn } from '@/components/shared/ReportMoney'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

/** `admin/user/reload-rewards/*` — the user-service reload-rewards module (rainbet). */
const BASE = 'admin/user/reload-rewards'

type Program = { program: 'DAILY_RELOAD' | 'PRE_MONTHLY'; enabled: boolean; percent: string; minVipLevel: number; updatedAt: string }
type Claim = { id: string; program: Program['program']; userId: string; player: string | null; periodKey: string; wageredUsd: string; amountUsd: string; currency: string; amount: string; createdAt: string }

const INFO: Record<Program['program'], { title: string; rule: string }> = {
  DAILY_RELOAD: { title: 'Daily Reload', rule: 'A share of what the player wagered yesterday (UTC), claimable once each day.' },
  PRE_MONTHLY: { title: 'Pre-Monthly Bonus', rule: 'A share of what the player wagered from the 1st to the 14th, claimable from the 15th to the month’s end.' }
}

const EditProgram = ({ p }: { p: Program }) => {
  const [form, setForm] = useState({ enabled: p.enabled, percent: String(Number(p.percent)), minVipLevel: String(p.minVipLevel) })

  const save = useApiMutation({
    fn: () => api.put(`${BASE}/programs/${p.program}`, { enabled: form.enabled, percent: Number(form.percent), minVipLevel: Number(form.minVipLevel) }),
    invalidate: [['api', `${BASE}/programs`]],
    success: `${INFO[p.program].title} saved`
  })

  return (
    <FormDialog
      trigger={
        <Button variant='outline' size='sm'>
          <Settings2Icon /> Edit
        </Button>
      }
      title={INFO[p.program].title}
      description={INFO[p.program].rule}
      submitLabel='Save'
      onSubmit={() => save.mutateAsync()}
      validate={() => ({
        [`rl-pct-${p.program}`]: check.amount(form.percent),
        [`rl-vip-${p.program}`]: /^\d+$/.test(form.minVipLevel) ? undefined : 'Enter a whole number'
      })}
    >
      <SwitchField id={`rl-on-${p.program}`} label='On' hint='Off: the row shows locked in the Rewards popup.' checked={form.enabled} onChange={enabled => setForm({ ...form, enabled })} />
      <TextField id={`rl-pct-${p.program}`} label='Rate (% of wagered)' required inputMode='decimal' hint='0.1 pays $1 on $1,000 wagered.' value={form.percent} onChange={e => setForm({ ...form, percent: e.target.value })} />
      <TextField id={`rl-vip-${p.program}`} label='Minimum VIP level' required inputMode='numeric' hint='0 = every player.' value={form.minVipLevel} onChange={e => setForm({ ...form, minVipLevel: e.target.value.replace(/\D/g, '') })} />
    </FormDialog>
  )
}

const columns: Column<Claim>[] = [
  { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
  { key: 'program', header: 'Reward', cell: r => INFO[r.program].title },
  {
    key: 'player',
    header: 'Player',
    cell: r => (
      <Link href={`/users/${r.userId}`} className='hover:underline'>
        {r.player ?? `#${r.userId}`}
      </Link>
    )
  },
  { key: 'period', header: 'Period', cell: r => <span className='font-mono text-sm'>{r.periodKey}</span> },
  { key: 'wagered', header: 'Wagered', align: 'right', cell: r => <span className='font-mono tabular-nums'>{formatIn(Number(r.wageredUsd), 'USD')}</span> },
  { key: 'paid', header: 'Paid', align: 'right', cell: r => <span className='font-mono tabular-nums'>{`${Number(r.amount)} ${r.currency}`}</span> }
]

/** Admin → Promotions → Reload bonuses: the Rewards popup's Daily Reload and Pre-Monthly Bonus. */
const ReloadRewards = () => {
  const programs = useApi<Program[]>(`${BASE}/programs`)
  const claims = useApi<Claim[]>(`${BASE}/claims`, { limit: 50 })

  if (programs.error) return <ErrorState error={programs.error} />

  return (
    <div className='space-y-6'>
      <PageHeader title='Reload bonuses' description='Rewards paid as a share of what a player wagered, in the reward currency. Players claim them from the Rewards popup.' />

      <div className='grid gap-4 lg:grid-cols-2'>
        {(programs.data ?? []).map(p => (
          <Card key={p.program} className='shadow-none'>
            <CardHeader className='flex flex-row items-center justify-between gap-2'>
              <CardTitle className='flex items-center gap-2 text-base'>
                {INFO[p.program].title}
                <Badge variant={p.enabled ? 'default' : 'secondary'}>{p.enabled ? 'On' : 'Off'}</Badge>
              </CardTitle>
              <Can permission='config:write'>
                <EditProgram key={p.updatedAt} p={p} />
              </Can>
            </CardHeader>
            <CardContent className='text-muted-foreground space-y-1 text-sm'>
              <p>{INFO[p.program].rule}</p>
              <p>
                Rate <span className='text-foreground font-mono'>{Number(p.percent)}%</span> · minimum VIP level <span className='text-foreground font-mono'>{p.minVipLevel}</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className='shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Recent claims</CardTitle>
        </CardHeader>
        <CardContent>
          {claims.error ? <ErrorState error={claims.error} /> : <DataTable columns={columns} rows={claims.data} loading={!claims.data} rowKey={r => r.id} emptyMessage='No reload bonus claimed yet.' />}
        </CardContent>
      </Card>
    </div>
  )
}

export default ReloadRewards
