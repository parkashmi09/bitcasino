'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import { SwitchField, TextField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

/**
 * hash.game's /bonus formulas (migration 137) — the info button on each card:
 *   Instant  wagered × house edge × 10%           Daily    × 4%
 *   Weekly   × 4% + net loss × 1%                 Monthly  × 3.5% + net loss × 1.5%
 * Off (`fixed`) = the old per-card amounts and rates.
 */
type Formula = { mode: 'hash' | 'fixed'; instant: string; daily: string; weeklyWager: string; weeklyLoss: string; monthlyWager: string; monthlyLoss: string }

const PATH = 'admin/site-config/reward-formula'

const FIELDS: { key: Exclude<keyof Formula, 'mode'>; label: string; hint: string }[] = [
  { key: 'instant', label: 'Instant rakeback %', hint: 'Wagered × house edge × this, every bet' },
  { key: 'daily', label: 'Daily bonus %', hint: '00:00–23:59 UTC, paid the next day' },
  { key: 'weeklyWager', label: 'Weekly — wager %', hint: 'Friday–Thursday UTC, paid Friday' },
  { key: 'weeklyLoss', label: 'Weekly — net loss %', hint: '+ this share of the week’s net loss' },
  { key: 'monthlyWager', label: 'Monthly — wager %', hint: '15th–14th UTC, paid the 15th' },
  { key: 'monthlyLoss', label: 'Monthly — net loss %', hint: '+ this share of the month’s net loss' }
]

const Editor = ({ initial }: { initial: Formula }) => {
  const { can } = useSession()
  const [form, setForm] = useState<Formula>(initial)

  const save = useApiMutation({
    fn: () => api.put(PATH, form),
    invalidate: [['api', PATH]],
    success: 'Reward formula saved'
  })

  return (
    <div className='grid max-w-2xl gap-4'>
      <SwitchField
        id='rfMode'
        label='Use hash.game’s formula'
        hint='Off: the fixed per-VIP-card amounts and rakeback rates.'
        checked={form.mode === 'hash'}
        onChange={on => setForm({ ...form, mode: on ? 'hash' : 'fixed' })}
        disabled={!can('config:write')}
      />
      <div className='grid gap-3 sm:grid-cols-2'>
        {FIELDS.map(f => (
          <TextField key={f.key} id={`rf-${f.key}`} label={f.label} hint={f.hint} inputMode='decimal' value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
        ))}
      </div>
      <Button type='button' className='justify-self-start' disabled={!can('config:write') || save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2Icon className='animate-spin' />}
        Save
      </Button>
    </div>
  )
}

const RewardFormula = () => {
  const q = useApi<Formula>(PATH)

  return (
    <Card className='max-w-3xl shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Rakeback &amp; daily / weekly / monthly bonus</CardTitle>
        <CardDescription>
          hash.game: “Only real money, non-PvP wagers count. Reward varies by game type and house edge.” House edge is the game’s
          1 − RTP (max 4%); originals 1%, slots 4%, live and sports 2% when the RTP is unknown. Bronze I and up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.error && <ErrorState error={q.error} />}
        {q.data && <Editor key={JSON.stringify(q.data)} initial={q.data} />}
      </CardContent>
    </Card>
  )
}

export default RewardFormula
