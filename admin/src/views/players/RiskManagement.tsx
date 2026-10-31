'use client'

import { useState, type ReactNode } from 'react'

import Link from 'next/link'

import { BanknoteXIcon, DicesIcon, GamepadIcon, LockIcon, LockOpenIcon, RefreshCwIcon, ShieldAlertIcon, TrophyIcon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatAmount } from '@/lib/format'
import { cn } from '@/lib/utils'
import GeoAttribution from './GeoAttribution'
import { countryFlag } from './geo'
import type { PlayerRisk, RiskBet, RiskCasinoBet, RiskIp, RiskLogin } from './types'
import { casinoSourceLabel } from '@/lib/casinoSource'

/**
 * Risk Management — one player as a risk reviewer sees them, after the legacy Addaplay dialog:
 * flags, profile, where the account was opened, money in and out, every address it used, the last
 * logins and bets, and the locks. One read, `GET admin/reports/user-risk/:id` (reports:read,
 * scoped to the caller's tree — a player outside it is a 404). Geo comes from the lookup stored
 * with each login (ipinfo → ipwhois → local DB-IP); nothing is looked up from the browser.
 *
 * Used as the user page's Risk tab and as a dialog (user page header, IP tracker rows).
 */

const riskPath = (id: string) => `admin/reports/user-risk/${id}`

const where = (r?: { city?: string | null; region?: string | null; country?: string | null } | null) =>
  [r?.city, r?.region, r?.country].filter(Boolean).join(', ')

const pct = (n?: number | null) => (n === null || n === undefined ? null : `${Math.round(n * 100)}%`)

type FlagDef = { label: (d: PlayerRisk) => string; tone: 'destructive' | 'outline' }

/** The legacy dialog's four first, then the ones this platform adds. */
const FLAGS: [string, FlagDef][] = [
  ['multipleIps', { label: d => `Multiple IPs (${d.activity.publicIpCount})`, tone: 'destructive' }],
  ['twoFaDisabled', { label: () => '2FA disabled', tone: 'outline' }],
  [
    'highWithdrawalRatio',
    {
      label: d => {
        const r = d.withdrawalRatio
        const shown = pct(r?.reward ?? r?.inr)

        return `High withdrawal ratio${shown ? ` (${shown})` : ''}`
      },
      tone: 'destructive'
    }
  ],
  ['noActivity', { label: () => 'No activity (no bets or games)', tone: 'outline' }],
  ['sharedIp', { label: d => `Shares an IP (${d.sharedIps.total})`, tone: 'destructive' }],
  ['proxyOrHosting', { label: () => 'Proxy / VPN', tone: 'destructive' }],
  ['multipleCountries', { label: () => 'Several countries', tone: 'destructive' }]
]

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className='grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 py-1.5 text-sm'>
    <dt className='text-muted-foreground'>{label}</dt>
    <dd className='min-w-0 break-words'>{children}</dd>
  </div>
)

const Muted = ({ children }: { children: ReactNode }) => <span className='text-muted-foreground'>{children}</span>

const Section = ({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <Card className={cn('gap-3 py-4 shadow-none', className)}>
    <CardHeader className='flex flex-row items-center justify-between gap-2 px-4'>
      <CardTitle className='text-sm'>{title}</CardTitle>
      {action}
    </CardHeader>
    <CardContent className='px-4'>{children}</CardContent>
  </Card>
)

const Network = ({ isProxy, isHosting }: { isProxy?: boolean | null; isHosting?: boolean | null }) =>
  isProxy || isHosting ? (
    <Badge variant='destructive'>{isProxy ? 'Proxy / VPN' : 'Hosting'}</Badge>
  ) : isProxy === false ? (
    <Muted>Residential</Muted>
  ) : (
    <Muted>—</Muted>
  )

const Place = ({ r }: { r: { countryCode?: string | null; city?: string | null; region?: string | null; country?: string | null; isPrivate?: boolean } }) =>
  where(r) ? (
    <span className='text-sm'>
      {countryFlag(r.countryCode)} {where(r)}
    </span>
  ) : (
    <Muted>{r.isPrivate ? 'local address' : 'not resolved'}</Muted>
  )

const ipColumns: Column<RiskIp>[] = [
  {
    key: 'ip',
    header: 'IP',
    cell: r => (
      <span className='font-mono text-sm'>
        {r.ipAddress}
        {r.isPrivate && (
          <Badge variant='outline' className='ml-2 font-sans'>
            local
          </Badge>
        )}
      </span>
    )
  },
  { key: 'uses', header: 'Uses', align: 'right', cell: r => <span className='tabular-nums'>{r.uses}</span> },
  { key: 'first', header: 'First seen', cell: r => <DateTime value={r.firstSeen} /> },
  { key: 'last', header: 'Last seen', cell: r => <DateTime value={r.lastSeen} /> },
  { key: 'where', header: 'Location', cell: r => <Place r={r} /> },
  {
    key: 'isp',
    header: 'Provider',
    cell: r => (
      <span className='text-sm'>
        {r.isp ?? '—'}
        {r.asn && <span className='text-muted-foreground block text-xs'>{r.asn}</span>}
      </span>
    )
  },
  { key: 'net', header: 'Network', cell: r => <Network isProxy={r.isProxy} isHosting={r.isHosting} /> }
]

const loginColumns: Column<RiskLogin>[] = [
  { key: 'at', header: 'Time', cell: r => <DateTime value={r.createdAt} /> },
  {
    key: 'ip',
    header: 'IP',
    cell: r => (
      <span className='font-mono text-sm'>
        {r.ipAddress ?? '—'}
        {r.source === 'register' && (
          <Badge variant='outline' className='ml-2 font-sans'>
            sign-up
          </Badge>
        )}
      </span>
    )
  },
  { key: 'where', header: 'Location', cell: r => <Place r={r} /> },
  {
    key: 'ua',
    header: 'Device',
    cell: r => (
      <span className='block max-w-72 text-sm'>
        {r.device ?? '—'}
        <span className='text-muted-foreground line-clamp-1 block text-xs' title={r.userAgent ?? undefined}>
          {r.userAgent ?? ''}
        </span>
      </span>
    )
  }
]

/** Sports and casino in one list, newest first. */
type AnyBet = {
  key: string
  kind: 'Sports' | 'Casino'
  at: string
  what: ReactNode
  stake: string
  currency: string
  result: string
  tone: 'destructive' | 'outline' | 'secondary'
}

const resultTone = (s: string): AnyBet['tone'] => (/won|win/i.test(s) ? 'secondary' : /lost|loss/i.test(s) ? 'destructive' : 'outline')


const fromSports = (b: RiskBet): AnyBet => {
  const result = b.resultStatus && b.resultStatus !== 'pending' ? b.resultStatus : b.status || 'pending'

  return {
    key: `s:${b.id}`,
    kind: 'Sports',
    at: b.createdAt,
    what: (
      <span className='block text-sm'>
        {b.event ?? 'Sports bet'}
        <span className='text-muted-foreground block text-xs'>
          {[b.market, b.selection, b.betType, b.odds && `@ ${b.odds}`].filter(Boolean).join(' · ') || '—'}
          {b.ipAddress && <span className='ml-1 font-mono'>· {b.ipAddress}</span>}
        </span>
      </span>
    ),
    stake: b.stakeAmount,
    currency: b.currency,
    result,
    tone: resultTone(result)
  }
}

const fromCasino = (b: RiskCasinoBet): AnyBet => {
  const result = b.result ?? '—'

  return {
    key: `c:${b.id}`,
    kind: 'Casino',
    at: b.createdAt,
    what: (
      <span className='block text-sm'>
        {b.game ?? 'Casino round'}
        <span className='text-muted-foreground block text-xs'>{casinoSourceLabel(b.source)}</span>
      </span>
    ),
    stake: b.stakeAmount,
    currency: b.currency,
    result,
    tone: resultTone(result)
  }
}

const betColumns: Column<AnyBet>[] = [
  { key: 'at', header: 'Time', cell: r => <DateTime value={r.at} /> },
  { key: 'kind', header: 'Type', cell: r => <Badge variant='outline'>{r.kind}</Badge> },
  { key: 'what', header: 'Game / market', cell: r => r.what },
  { key: 'stake', header: 'Stake', align: 'right', cell: r => <Money value={r.stake} currency={r.currency} /> },
  { key: 'result', header: 'Result', cell: r => <Badge variant={r.tone}>{r.result}</Badge> }
]

const BET_ROWS = 10

/**
 * Lock Controls — reference admin (admin-structure.zip → RiskManagementDialog) jaisa: har lock ka
 * apna switch, turant lagta hai (`POST admin/locks`, users:write, audited `account.lock`), aur
 * neeche "Lock Account" / "Unlock Account". Betting status aur account status sirf dikhte hain.
 */
const LOCKS = [
  { key: 'system', field: 'isLocked', label: 'Account Locked', hint: 'Blocks all logins and activity', icon: <LockIcon /> },
  { key: 'sports', field: 'sportsBetlocked', label: 'Sports Bet Lock', hint: 'Prevents sports bets', icon: <TrophyIcon /> },
  { key: 'casino', field: 'casinoLocked', label: 'Casino Lock', hint: 'Prevents provider casino play', icon: <DicesIcon /> },
  { key: 'originals', field: 'originalsLocked', label: 'Original Games Lock', hint: 'Prevents Original Games play', icon: <GamepadIcon /> },
  { key: 'withdraw', field: 'withdrawLocked', label: 'Withdrawal Lock', hint: 'Rejects all withdrawals for this user', icon: <BanknoteXIcon /> }
] as const

const LockControls = ({ userId, data }: { userId: string; data: PlayerRisk }) => {
  const { can } = useSession()
  const l = data.locks
  const canEdit = can('users:write')
  const invalidate = [['api', riskPath(userId)], ['api', `admin/reports/players/${userId}`], ['api', `admin/reports/players/${userId}/status-stats`], ['paged', 'admin/reports/user-list']]

  const toggle = useApiMutation<{ key: (typeof LOCKS)[number]['key']; value: boolean }>({
    fn: ({ key, value }) => api.post('admin/locks', { userId: Number(userId), [key]: value }),
    invalidate,
    success: (_r, v) => `${LOCKS.find(x => x.key === v.key)?.label ?? 'Lock'} ${v.value ? 'enabled' : 'disabled'}`
  })

  return (
    <Section title='Lock Controls'>
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
        {LOCKS.map(lk => {
          const on = Boolean(l[lk.field])

          return (
            <label key={lk.key} className={cn('flex items-center gap-3 rounded-md border px-3 py-2', on && 'border-danger/40 bg-danger/5')}>
              <Switch
                checked={on}
                disabled={!canEdit || toggle.isPending || l[lk.field] === undefined}
                onCheckedChange={value => toggle.mutate({ key: lk.key, value })}
                aria-label={lk.label}
              />
              <span className='min-w-0'>
                <span className={cn('flex items-center gap-1 text-sm font-semibold [&_svg]:size-4', on && 'text-danger')}>
                  {lk.icon} {lk.label}
                </span>
                <span className='text-muted-foreground block text-xs'>{lk.hint}</span>
              </span>
            </label>
          )
        })}
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <Button variant='destructive' disabled={!canEdit || l.isLocked || toggle.isPending} onClick={() => toggle.mutate({ key: 'system', value: true })}>
          <LockIcon /> Lock Account
        </Button>
        <Button variant='outline' disabled={!canEdit || !l.isLocked || toggle.isPending} onClick={() => toggle.mutate({ key: 'system', value: false })}>
          <LockOpenIcon /> Unlock Account
        </Button>
        <span className='text-muted-foreground ml-auto flex flex-wrap gap-2 text-xs'>
          <span>
            Betting: <Badge variant={l.betStatus === 'suspended' ? 'destructive' : 'outline'}>{l.betStatus ?? 'active'}</Badge>
          </span>
          <span>
            Status: <Badge variant={l.status && l.status !== 'active' ? 'destructive' : 'outline'}>{l.status ?? '—'}</Badge>
          </span>
        </span>
      </div>
      {!canEdit && <p className='text-muted-foreground mt-2 text-xs'>Your role can view locks but not change them.</p>}
    </Section>
  )
}

const Loading = () => (
  <div className='flex flex-col gap-4'>
    <Skeleton className='h-8 w-2/3' />
    <div className='grid gap-4 lg:grid-cols-2'>
      <Skeleton className='h-56' />
      <Skeleton className='h-56' />
    </div>
    <Skeleton className='h-40' />
  </div>
)

/** The whole view — the Risk tab on the user page, and the body of the dialog. */
export const RiskManagementPanel = ({ userId, inDialog = false }: { userId: string; inDialog?: boolean }) => {
  const q = useApi<PlayerRisk>(riskPath(userId), undefined, { retry: false })
  const promotions = useSession().actor?.promotions === true

  // The VIP standing is the player report's ladder (`users.level` is not the VIP level); agent-tree
  // logins have no promotions, so it is neither read nor shown for them.
  const vip = useApi<{ vip?: { level?: number; name?: string } }>(promotions ? `admin/reports/players/${userId}` : null)

  // An agent's player has no deposits / withdrawals: its money is points (INR, no symbol).
  const agentPlayer = q.data ? !q.data.user.isDirect : false
  const pts = useApi<{ points?: Record<'total' | 'sports' | 'casino' | 'original' | 'balance' | 'credit', string> }>(agentPlayer ? `admin/reports/client-balance-sheet/${userId}` : null, { limit: 1 })

  if (q.error) return <ErrorState error={q.error} />
  if (!q.data) return <Loading />

  const d = q.data
  const u = d.user
  const reg = d.registration
  const reward = d.financials.reward
  const ratio = d.withdrawalRatio
  const flags = FLAGS.filter(([k]) => d.riskFlags[k])

  const bets = [...d.activity.recentBets.map(fromSports), ...(d.activity.recentCasinoBets ?? []).map(fromCasino)]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, BET_ROWS)

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-1.5'>
        {flags.length ? (
          flags.map(([k, f]) => (
            <Badge key={k} variant={f.tone}>
              <ShieldAlertIcon /> {f.label(d)}
            </Badge>
          ))
        ) : (
          <Badge variant='outline'>No risk flags</Badge>
        )}
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Section
          title='Profile'
          action={
            inDialog ? (
              <Link href={`/users/${u.id}`} className='text-primary text-xs hover:underline'>
                Open user page
              </Link>
            ) : undefined
          }
        >
          <dl className='divide-y'>
            <Row label='UID'>
              <span className='font-mono'>{u.id}</span>
            </Row>
            <Row label='Name'>{u.name || <Muted>—</Muted>}</Row>
            <Row label='Email'>{u.email || <Muted>—</Muted>}</Row>
            <Row label='Phone'>{u.phone || <Muted>—</Muted>}</Row>
            <Row label='Country'>{u.country || <Muted>—</Muted>}</Row>
            {promotions && <Row label='VIP level'>{vip.data?.vip ? `L${vip.data.vip.level ?? 0} · ${vip.data.vip.name ?? ''}` : <Muted>—</Muted>}</Row>}
            <Row label='Registered'>{u.created ? <DateTime value={u.created} /> : <Muted>—</Muted>}</Row>
            <Row label='Updated'>{u.updatedAt ? <DateTime value={u.updatedAt} /> : <Muted>—</Muted>}</Row>
            <Row label='Type'>
              {u.isDirect ? (
                <Badge variant='secondary'>Direct player</Badge>
              ) : (
                <span className='flex flex-wrap items-center gap-1.5'>
                  <Badge variant='outline'>Agent player</Badge>
                  <span>{u.staffName ?? (u.staffId ? `#${u.staffId}` : '—')}</span>
                  {u.staffEmail && <Muted>{u.staffEmail}</Muted>}
                </span>
              )}
            </Row>
            <Row label='2FA'>{u.twoFaEnabled ? <Badge variant='secondary'>Enabled</Badge> : <Badge variant='outline'>Disabled</Badge>}</Row>
          </dl>
        </Section>

        <Section title='Registration origin'>
          <dl className='divide-y'>
            <Row label='Registration IP'>
              {reg.ip ? (
                <span className='flex flex-wrap items-center gap-1.5'>
                  <span className='font-mono'>{reg.ip}</span>
                  {reg.source === 'first_login' && <Badge variant='outline'>Inferred from earliest login</Badge>}
                  {reg.isPrivate && <Badge variant='outline'>local</Badge>}
                </span>
              ) : (
                <Muted>Not recorded</Muted>
              )}
            </Row>
            <Row label='Location'>{reg.ip ? <Place r={reg} /> : <Muted>—</Muted>}</Row>
            <Row label='ISP / network'>{reg.isp ?? <Muted>—</Muted>}</Row>
            <Row label='Country on form'>{reg.declaredCountry ?? <Muted>—</Muted>}</Row>
            <Row label='Registered on'>{reg.registeredAt ? <DateTime value={reg.registeredAt} /> : <Muted>—</Muted>}</Row>
          </dl>
        </Section>
      </div>

      {agentPlayer ? (
        <Section title='Points'>
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6'>
            {(
              [
                ['Balance', 'balance'],
                ['Credit', 'credit'],
                ['Total points', 'total'],
                ['Sports points', 'sports'],
                ['Casino points', 'casino'],
                ['Original points', 'original']
              ] as const
            ).map(([label, key]) => (
              <div key={key}>
                <p className='text-muted-foreground text-xs'>{label}</p>
                <p className='text-lg font-semibold'>{formatAmount(pts.data?.points?.[key] ?? '0')}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : (
      <Section title={`Financial exposure (${reward.currency})`}>
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <div>
            <p className='text-muted-foreground text-xs'>Total deposits</p>
            <p className='text-lg font-semibold'>
              <Money value={reward.totalDeposit} currency={reward.currency} />
            </p>
            <p className='text-muted-foreground text-xs'>{reward.depositCount} deposits</p>
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>Total withdrawals</p>
            <p className='text-lg font-semibold'>
              <Money value={reward.totalWithdrawal} currency={reward.currency} />
            </p>
            <p className='text-muted-foreground text-xs'>{reward.withdrawalCount} withdrawals</p>
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>Net (deposits − withdrawals)</p>
            <p className='text-lg font-semibold'>
              <Money value={reward.net} currency={reward.currency} signed />
            </p>
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>Withdrawal ratio</p>
            <p className={cn('text-lg font-semibold', d.riskFlags.highWithdrawalRatio && 'text-destructive')}>{pct(ratio?.reward ?? ratio?.inr) ?? '—'}</p>
            <p className='text-muted-foreground text-xs'>flagged above {pct(ratio?.threshold ?? 0.8)}</p>
          </div>
        </div>
        <p className='text-muted-foreground mt-3 text-xs'>
          Every completed deposit and withdrawal, all coins, valued in {reward.currency} at today&apos;s rates. Admin credits (Direct User Wallet, not deposits): <Money value={d.financials.adminCredited ?? '0'} currency='INR' />.
          {reward.unconverted.length ? ` No rate for ${reward.unconverted.join(', ')}, left out.` : ''}
        </p>
      </Section>
      )}

      <Section title='Network / IP activity'>
        <div className='mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <div>
            <p className='text-muted-foreground text-xs'>Distinct IPs</p>
            <p className='text-lg font-semibold tabular-nums'>{d.activity.publicIpCount}</p>
            <p className='text-muted-foreground text-xs'>{d.activity.distinctIpCount} incl. local</p>
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>Countries</p>
            <p className='text-lg font-semibold'>{d.activity.countries.length ? d.activity.countries.map(c => countryFlag(c.countryCode) || c.countryCode).join(' ') : '—'}</p>
          </div>
          <div className='col-span-2'>
            <p className='text-muted-foreground text-xs'>Last IP · last login</p>
            <p className='font-mono text-sm font-medium'>{u.lastIp ?? '—'}</p>
            <p className='text-muted-foreground text-xs'>{u.lastLoginAt ? <DateTime value={u.lastLoginAt} /> : 'never logged in'}</p>
          </div>
        </div>
        <DataTable columns={ipColumns} rows={d.activity.ipBreakdown} rowKey={r => r.ipAddress} dense emptyMessage='No logins recorded yet.' />
        {d.sharedIps.total > 0 && (
          <div className='mt-3 text-sm'>
            <p className='text-muted-foreground mb-1 text-xs'>Shares a public IP with {d.sharedIps.total} other account{d.sharedIps.total === 1 ? '' : 's'} in your tree</p>
            <ul className='flex flex-col gap-1'>
              {d.sharedIps.accounts.map(a => (
                <li key={a.id} className='flex flex-wrap items-center gap-2'>
                  <Link href={`/users/${a.id}?tab=risk`} className='font-medium hover:underline'>
                    {a.name || `#${a.id}`}
                  </Link>
                  <span className='text-muted-foreground font-mono text-xs'>{a.ips.join(', ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title={`Recent logins (last ${d.activity.recentLogins.length || 15})`}>
        <DataTable columns={loginColumns} rows={d.activity.recentLogins} rowKey={r => String(r.id)} dense emptyMessage='No logins recorded yet.' />
      </Section>

      <Section title={`Recent bets (last ${BET_ROWS})`}>
        <DataTable columns={betColumns} rows={bets} rowKey={r => r.key} dense emptyMessage='No sports bets or casino rounds yet.' />
      </Section>

      <LockControls userId={userId} data={d} />

      <GeoAttribution />
    </div>
  )
}

/**
 * The same view in a dialog. Controlled (`open` / `onOpenChange`) from a list row, or with a
 * `trigger` on its own.
 */
export const RiskManagementDialog = ({
  userId,
  name,
  trigger,
  open,
  onOpenChange
}: {
  userId: string | null
  name?: string | null
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) => {
  const [inner, setInner] = useState(false)
  const isOpen = open ?? inner
  const q = useApi<PlayerRisk>(isOpen && userId ? riskPath(userId) : null, undefined, { retry: false })
  const shownName = q.data?.user.name || name

  const setOpen = (next: boolean) => {
    if (open === undefined) setInner(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && (
        <DialogTrigger nativeButton={false} render={<span />}>
          {trigger}
        </DialogTrigger>
      )}
      <DialogContent className='flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl'>
        <DialogHeader className='border-b px-6 py-4 pr-24'>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldAlertIcon className='size-4' /> Risk Management
          </DialogTitle>
          <DialogDescription>
            {shownName || 'Player'} · <span className='font-mono'>UID {userId}</span>
          </DialogDescription>
          <Button
            variant='ghost'
            size='icon-sm'
            className='absolute top-4 right-14'
            aria-label='Refresh'
            title='Refresh'
            disabled={!userId || q.isFetching}
            onClick={() => void q.refetch()}
          >
            <RefreshCwIcon className={cn(q.isFetching && 'animate-spin')} />
          </Button>
        </DialogHeader>
        <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>{userId && isOpen && <RiskManagementPanel userId={userId} inDialog />}</div>
      </DialogContent>
    </Dialog>
  )
}

export default RiskManagementPanel
