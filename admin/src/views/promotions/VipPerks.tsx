'use client'

import { useState } from 'react'

import { PlusIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

type Perk = { id: number; key: string | null; label: string; enabled: boolean; cards: string[]; pays: boolean }

const PERKS = 'admin/vip-branding/perks'
const INVALIDATE = [['api', `${PERKS}/manage`]]

const PerkRow = ({ perk, cards }: { perk: Perk; cards: string[] }) => {
  const save = useApiMutation({
    fn: (body: { enabled?: boolean; cards?: string[] }) => api.put(`${PERKS}/${perk.id}`, body),
    invalidate: INVALIDATE
  })

  const remove = useApiMutation({
    fn: () => api.delete(`${PERKS}/${perk.id}`),
    invalidate: INVALIDATE,
    success: () => `${perk.label} removed`
  })

  const toggle = (card: string, on: boolean) => save.mutate({ cards: on ? [...perk.cards, card] : perk.cards.filter(c => c !== card) })

  return (
    <tr className='border-t'>
      <td className='py-2 pr-3'>
        <span className='font-medium'>{perk.label}</span>
        {perk.pays && <Badge variant='outline' className='ml-2 text-[11px]'>Controls payouts</Badge>}
      </td>
      {cards.map(card => (
        <td key={card} className='px-2 py-2'>
          <div className='flex justify-center'>
          <Can permission='config:write' fallback={perk.cards.includes(card) ? '✓' : ''}>
            <Checkbox
              aria-label={`${perk.label} for ${card}`}
              checked={perk.cards.includes(card)}
              disabled={save.isPending}
              onCheckedChange={on => toggle(card, on === true)}
            />
          </Can>
          </div>
        </td>
      ))}
      <td className='px-2 py-2 text-center'>
        <Can permission='config:write' fallback={perk.enabled ? 'On' : 'Off'}>
          <Switch checked={perk.enabled} disabled={save.isPending} aria-label={`${perk.label} on the site`} onCheckedChange={on => save.mutate({ enabled: on })} />
        </Can>
      </td>
      <td className='py-2 text-right'>
        <Can permission='config:write'>
          <ConfirmDialog
            trigger={<Button size='icon' variant='ghost' className='size-7' aria-label={`Remove ${perk.label}`}><Trash2Icon /></Button>}
            title={`Remove ${perk.label}?`}
            description={perk.pays ? 'This perk controls real payouts: no rank gets it after this. It cannot be added back as a payout from this screen.' : 'It leaves the VIP page for every rank.'}
            confirmLabel='Remove perk'
            destructive
            onConfirm={() => remove.mutateAsync()}
          />
        </Can>
      </td>
    </tr>
  )
}

const AddPerk = () => {
  const [label, setLabel] = useState('')

  const add = useApiMutation({
    fn: () => api.post(PERKS, { label: label.trim() }),
    invalidate: INVALIDATE,
    success: () => `${label.trim()} added`,
    onSuccess: () => setLabel('')
  })

  return (
    <FormDialog
      trigger={<Button size='sm'><PlusIcon /> Add perk</Button>}
      title='Add perk'
      description='It starts with no rank ticked. A new perk is shown on the VIP page only: nothing is paid automatically.'
      submitLabel='Add perk'
      onSubmit={() => add.mutateAsync()}
      validate={() => ({ 'vip-perk-label': label.trim() ? undefined : 'Enter a name' })}
    >
      <TextField id='vip-perk-label' label='Perk name' required maxLength={60} value={label} onChange={e => setLabel(e.target.value)} />
    </FormDialog>
  )
}

/** Which perks each rank gets: the table on the player VIP page, and the payouts of the four marked perks. */
const VipPerks = ({ cards }: { cards: string[] }) => {
  const q = useApi<Perk[]>(`${PERKS}/manage`)
  const perks = Array.isArray(q.data) ? q.data : []

  return (
    <Card className='shadow-none'>
      <CardHeader className='flex flex-row items-start justify-between gap-3'>
        <div className='grid gap-1'>
          <CardTitle className='text-base'>Perks by rank</CardTitle>
          <CardDescription>Tick what each rank gets. Perks marked “Controls payouts” also stop or start the real payout for that rank; the others only change the VIP page.</CardDescription>
        </div>
        <Can permission='config:write'><AddPerk /></Can>
      </CardHeader>
      <CardContent className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='text-muted-foreground text-xs'>
              <th className='pb-2 pr-3 text-left font-medium'>Perk</th>
              {cards.map(card => <th key={card} className='px-2 pb-2 font-medium capitalize'>{card}</th>)}
              <th className='px-2 pb-2 font-medium'>On site</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perks.map(perk => <PerkRow key={perk.id} perk={perk} cards={cards} />)}
          </tbody>
        </table>
        {q.isLoading && <p className='text-muted-foreground py-3 text-sm'>Loading…</p>}
      </CardContent>
    </Card>
  )
}

export default VipPerks
