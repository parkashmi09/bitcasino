'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

/**
 * hash.game's "Wager Contribution for Bonus Balance Details" (migration 135): how much of a bet
 * unlocks a locked bonus. One rule names a game, a provider OR a category; the most specific wins.
 * Sports also need odds of 1.5 or more (fixed, as hash.game).
 */
type Rule = { category: string | null; provider: string | null; gameRef: string | null; percent: string }
type Row = { kind: 'category' | 'provider' | 'game'; name: string; percent: string }

const PATH = 'admin/site-config/wager-contribution'

const toRow = (r: Rule): Row =>
  r.gameRef ? { kind: 'game', name: r.gameRef, percent: r.percent } : r.provider ? { kind: 'provider', name: r.provider, percent: r.percent } : { kind: 'category', name: r.category ?? '', percent: r.percent }

const toRule = (r: Row): Rule => ({
  category: r.kind === 'category' ? r.name.trim() : null,
  provider: r.kind === 'provider' ? r.name.trim() : null,
  gameRef: r.kind === 'game' ? r.name.trim() : null,
  percent: r.percent.trim()
})

const Editor = ({ initial }: { initial: Rule[] }) => {
  const { can } = useSession()
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow))
  const [filter, setFilter] = useState('')
  const writable = can('config:write')

  const save = useApiMutation({
    fn: () => api.put(PATH, { rules: rows.filter(r => r.name.trim() && r.percent.trim()).map(toRule) }),
    invalidate: [['api', PATH]],
    success: 'Wager contribution saved'
  })

  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className='grid gap-4'>
      <Input className='max-w-xs' placeholder='Filter by name' value={filter} onChange={e => setFilter(e.target.value)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applies to</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Contribution %</TableHead>
            <TableHead className='w-0' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(({ r, i }) => (
            <TableRow key={i}>
              <TableCell>
                <select
                  aria-label='Applies to'
                  className='bg-background rounded-md border px-2 py-1 text-sm'
                  value={r.kind}
                  onChange={e => set(i, { kind: e.target.value as Row['kind'] })}
                  disabled={!writable}
                >
                  <option value='category'>Category</option>
                  <option value='provider'>Provider</option>
                  <option value='game'>Game code</option>
                </select>
              </TableCell>
              <TableCell>
                <Input aria-label='Name' value={r.name} onChange={e => set(i, { name: e.target.value })} disabled={!writable} />
              </TableCell>
              <TableCell>
                <Input aria-label='Contribution %' inputMode='decimal' value={r.percent} onChange={e => set(i, { percent: e.target.value })} disabled={!writable} />
              </TableCell>
              <TableCell>
                <Button type='button' variant='ghost' size='sm' disabled={!writable} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className='text-muted-foreground text-xs'>
        Categories: originals, slots, live, sports. Provider names as in the game catalogue (e.g. pragmatic, hacksaw). Game code: the
        catalogue id or an original&apos;s code (crash, mines). A sports bet under odds 1.5 never counts.
      </p>
      <div className='flex gap-2'>
        <Button type='button' variant='outline' disabled={!writable} onClick={() => setRows(rs => [...rs, { kind: 'provider', name: '', percent: '100' }])}>
          Add rule
        </Button>
        <Button type='button' disabled={!writable || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2Icon className='animate-spin' />}
          Save
        </Button>
      </div>
    </div>
  )
}

const WagerContribution = () => {
  const q = useApi<{ rules: Rule[]; stored: boolean }>(PATH)

  return (
    <Card className='max-w-4xl shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Wager contribution</CardTitle>
        <CardDescription>
          Players see: “Wager amount = Bet Amount × Contribution Rate”. How much of a bet unlocks a locked deposit bonus. VIP,
          commission and rakeback always count the full bet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.error && <ErrorState error={q.error} />}
        {q.data && <Editor key={JSON.stringify(q.data.rules)} initial={q.data.rules} />}
      </CardContent>
    </Card>
  )
}

export default WagerContribution
