'use client'

import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi } from '@/hooks/use-api'
import { formatIn } from '@/components/shared/ReportMoney'

/** `GET admin/user/responsible-gambling/:userId` — read-only (users:read, tree-scoped). */
type Exclusion = {
  id: string
  selfExclusionType: 'CASINO' | 'SPORTS' | 'PLATFORM'
  createdAt: string
  selfExclusionUntilAt: string
  selfExclusionCooldownUntilAt: string | null
  active: boolean
}
type Limit = {
  id: string
  type: 'LOSS_LIMIT' | 'WAGER_LIMIT'
  usdAmount: string
  periodUnit: 'DAYS' | 'WEEKS' | 'MONTHS'
  progressAmount: string
  createdAt: string
  expiredAt: string | null
  resetsAt: string
  active: boolean
}

const TYPE = { CASINO: 'Casino', SPORTS: 'Sports', PLATFORM: 'Whole account' } as const
const LIMIT = { LOSS_LIMIT: 'Loss limit', WAGER_LIMIT: 'Wager limit' } as const
const PERIOD = { DAYS: 'Daily', WEEKS: 'Weekly', MONTHS: 'Monthly' } as const

/** Over a century reads as permanent, as on the player site. */
const permanent = (r: Exclusion) => new Date(r.selfExclusionUntilAt).getTime() - new Date(r.createdAt).getTime() > 100 * 365.25 * 864e5

/**
 * The player's own breaks and limits (player site → Responsible Gambling). Staff can see them but
 * not lift them: a self-exclusion only ever ends on its own date.
 */
const ResponsibleGamblingTab = ({ userId }: { userId: string }) => {
  const q = useApi<{ selfExclusions: Exclusion[]; limits: Limit[] }>(`admin/user/responsible-gambling/${userId}`)

  if (q.error) return <ErrorState error={q.error} />
  if (!q.data) return <p className='text-muted-foreground text-sm'>Loading…</p>
  const { selfExclusions, limits } = q.data

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card className='shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Self-exclusions</CardTitle>
        </CardHeader>
        <CardContent>
          {selfExclusions.length ? (
            <ul className='divide-y'>
              {selfExclusions.map(r => (
                <li key={r.id} className='flex flex-wrap items-center justify-between gap-2 py-2'>
                  <span className='flex items-center gap-2'>
                    <span className='font-medium'>{TYPE[r.selfExclusionType]}</span>
                    {r.selfExclusionCooldownUntilAt && <Badge variant='outline'>24h cooldown</Badge>}
                    <Badge variant={r.active ? 'destructive' : 'secondary'}>{r.active ? 'In force' : 'Ended'}</Badge>
                  </span>
                  <span className='text-muted-foreground text-sm'>
                    <DateTime value={r.createdAt} /> → {permanent(r) ? 'permanent' : <DateTime value={r.selfExclusionUntilAt} />}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-muted-foreground text-sm'>No self-exclusion.</p>
          )}
        </CardContent>
      </Card>

      <Card className='shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Gambling limits</CardTitle>
        </CardHeader>
        <CardContent>
          {limits.length ? (
            <ul className='divide-y'>
              {limits.map(r => (
                <li key={r.id} className='flex flex-wrap items-center justify-between gap-2 py-2'>
                  <span className='flex items-center gap-2'>
                    <span className='font-medium'>
                      {LIMIT[r.type]} · {PERIOD[r.periodUnit]}
                    </span>
                    <Badge variant={r.active ? 'default' : 'secondary'}>
                      {!r.active ? 'Removed' : r.expiredAt ? 'Removal pending' : 'Active'}
                    </Badge>
                  </span>
                  <span className='font-mono text-sm tabular-nums'>
                    {formatIn(Number(r.progressAmount), 'USD')} / {formatIn(Number(r.usdAmount), 'USD')}
                  </span>
                  {r.active && (
                    <span className='text-muted-foreground w-full text-xs'>
                      Window resets <DateTime value={r.resetsAt} />
                      {r.expiredAt && (
                        <>
                          {' '}
                          · lifts <DateTime value={r.expiredAt} />
                        </>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-muted-foreground text-sm'>No gambling limit.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default ResponsibleGamblingTab
