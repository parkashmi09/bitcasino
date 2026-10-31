'use client'

import type { ReactNode } from 'react'

import { AlertTriangleIcon, CheckCircle2Icon, CrownIcon, FingerprintIcon, GiftIcon, ShieldIcon, UserIcon } from 'lucide-react'

import { ChartCard, seriesTable, TimeSeriesChart, type ChartSeries, type StatsFilters, fillBuckets } from '@/components/shared/charts'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CircularProgress } from '@/components/ui/circular-progress'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/hooks/use-api'
import { formatMoney, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * `GET admin/reports/players/:id/status-stats` — `from`/`to` (instants) and `granularity`, nothing
 * else (strict). `reports:read` and the player detail's own tree check: a player outside the
 * caller's tree is a 404, like the detail itself. `vip` is null for agent-tree callers.
 */
const pathFor = (id: string) => `admin/reports/players/${id}/status-stats`

type PlayerStatus = {
  player: { id: string; name: string | null; registeredAt: string | null }
  account: {
    status: string
    rawStatus: string | null
    betStatus: string | null
    channel: 'direct' | 'agent'
    locks: { system: boolean; casino: boolean; sports: boolean; withdraw?: boolean; originals?: boolean; muted: boolean; withdrawHoldUntil: string | null }
    twoFa: boolean
    hasEmail: boolean
    hasPhone: boolean
    country: string | null
    lastLoginAt: string | null
    lastActivityAt: string | null
  }
  kyc: { status: string; rawStatus: string | null; documentType: string | null; submittedAt: string | null; updatedAt: string | null }
  vip: {
    level: number
    name: string
    card: string
    nextName: string | null
    progressPct: string
    wager: string
    wagerToNextLevel: string | null
    /** The site's default coin the two figures above are shown in (the ladder itself is USD). */
    wagerCurrency?: string
    topLevel: number
  } | null
  bonuses: {
    id: string
    source: string
    description: string | null
    amount: string
    currency: string
    wagerMultiplier: string
    requiredWager: string
    wagered: string
    progressPct: number
    grantedAt: string | null
    expiresAt: string | null
  }[]
  risk: {
    distinctIps: number
    distinctCountries: number
    logins: number
    flags: { multipleIps: boolean; multipleCountries: boolean; proxyOrHosting: boolean; twoFaDisabled: boolean; locked: boolean }
  }
  kpis: { activeDays: number; loginDays: number; betDays: number; logins: number; bets: number; periodDays: number }
  days: { day: string; logins: number; bets: number }[]
  series: { bucket: string; activeDays: number; logins: number; bets: number }[]
}

const KYC_LABEL: Record<string, string> = { none: 'Not submitted' }

/** One player's standing and activity — the top of the user page's Stats tab. */
const PlayerStatusSection = ({ userId, filters: f }: { userId: string; filters: StatsFilters }) => {
  const q = useApi<PlayerStatus>(pathFor(userId), { ...f.apiRange, granularity: f.granularity }, { placeholderData: prev => prev, retry: false })
  const s = q.data

  if (q.error && !s) return <ErrorState error={q.error} title='Could not load this user’s status' />

  if (!s) {
    return (
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4' aria-busy>
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className='h-44 w-full rounded-xl' />
        ))}
      </div>
    )
  }

  const { account: a, kyc, vip, risk } = s

  const activity: ChartSeries[] = [
    { name: 'Logins', data: fillBuckets(f.buckets, s.series, r => r.bucket, r => r.logins), color: 'chart-1' },
    { name: 'Bets', data: fillBuckets(f.buckets, s.series, r => r.bucket, r => r.bets), color: 'chart-3' }
  ]

  const flags: { on: boolean; label: string }[] = [
    { on: risk.flags.locked, label: 'Account locked or closed' },
    { on: risk.flags.twoFaDisabled, label: '2FA is off' },
    { on: risk.flags.multipleIps, label: `${formatNumber(risk.distinctIps)} sign-in IPs` },
    { on: risk.flags.multipleCountries, label: `${formatNumber(risk.distinctCountries)} sign-in countries` },
    { on: risk.flags.proxyOrHosting, label: 'Signed in from a proxy or hosting IP' }
  ]

  const raised = flags.filter(x => x.on)

  return (
    <section aria-label='User status' className='flex flex-col gap-4'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <Panel title='Account' icon={<UserIcon />}>
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge value={a.status === 'restricted' ? 'Product-restricted' : a.status} className={a.status === 'restricted' ? 'bg-warning-soft text-warning' : undefined} />
            <Badge variant='outline'>{a.channel === 'agent' ? 'Agent player' : 'Direct signup'}</Badge>
          </div>
          <div className='flex flex-wrap gap-1.5'>
            <Flag on={a.locks.system} label='System lock' />
            <Flag on={a.locks.casino} label='Casino lock' />
            <Flag on={a.locks.sports} label='Sports lock' />
            {a.locks.originals !== undefined && <Flag on={a.locks.originals} label='Original Games lock' />}
            {a.locks.withdraw !== undefined && <Flag on={a.locks.withdraw} label='Withdrawal block' />}
            {a.betStatus && a.betStatus.toLowerCase() !== 'active' && <Flag on label={`Betting ${a.betStatus}`} />}
            {a.locks.muted && <Flag on label='Chat muted' />}
            {a.locks.withdrawHoldUntil && <Flag on label='Withdrawal hold' />}
          </div>
          <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
            <dt className='text-muted-foreground'>Last sign-in</dt>
            <dd><DateTime value={a.lastLoginAt} relative /></dd>
            <dt className='text-muted-foreground'>Last activity</dt>
            <dd><DateTime value={a.lastActivityAt} relative /></dd>
            <dt className='text-muted-foreground'>Registered</dt>
            <dd><DateTime value={s.player.registeredAt} relative /></dd>
          </dl>
        </Panel>

        <Panel title='Identity and security' icon={<FingerprintIcon />}>
          <div className='flex items-center gap-2'>
            <span className='text-muted-foreground text-xs'>KYC</span>
            <StatusBadge value={KYC_LABEL[kyc.status] ?? kyc.status} className={kyc.status === 'none' ? 'bg-muted text-muted-foreground' : undefined} />
          </div>
          {kyc.status !== 'none' && (
            <p className='text-muted-foreground text-xs'>
              {kyc.documentType ? `${kyc.documentType.replace(/[_-]+/g, ' ')} · ` : ''}submitted <DateTime value={kyc.submittedAt} relative />
              {kyc.updatedAt && kyc.updatedAt !== kyc.submittedAt ? <> · updated <DateTime value={kyc.updatedAt} relative /></> : null}
            </p>
          )}
          <div className='flex flex-wrap gap-1.5'>
            <Check ok={a.twoFa} label={a.twoFa ? '2FA on' : '2FA off'} />
            <Check ok={a.hasEmail} label={a.hasEmail ? 'Email on file' : 'No email'} />
            <Check ok={a.hasPhone} label={a.hasPhone ? 'Phone on file' : 'No phone'} />
          </div>
        </Panel>

        {vip ? (
          <Panel title='VIP tier' icon={<CrownIcon />}>
            <div className='flex items-center gap-4'>
              <CircularProgress
                value={Number(vip.progressPct)}
                size={84}
                strokeWidth={8}
                showLabel
                renderLabel={v => <span className='text-sm font-semibold tabular-nums'>{Math.round(v)}%</span>}
                progressClassName='text-primary'
                aria-label={vip.nextName ? `${vip.progressPct}% of the way to ${vip.nextName}` : 'Top tier'}
              />
              <div className='flex min-w-0 flex-col gap-0.5'>
                <span className='font-medium'>{vip.name}</span>
                <span className='text-muted-foreground text-xs'>Level {vip.level} of {vip.topLevel}</span>
                <span className='text-muted-foreground text-xs'>
                  {vip.nextName && vip.wagerToNextLevel !== null ? `${formatMoney(vip.wagerToNextLevel, undefined, { digits: 0 })} ${vip.wagerCurrency ?? 'USD'} to ${vip.nextName}` : 'Top tier reached'}
                </span>
              </div>
            </div>
            <p className='text-muted-foreground text-xs'>Lifetime wager {formatMoney(vip.wager, undefined, { digits: 2 })} {vip.wagerCurrency ?? 'USD'}</p>
          </Panel>
        ) : null}

        <Panel title='Risk flags' icon={<ShieldIcon />}>
          {raised.length === 0 ? (
            <p className='text-success flex items-center gap-1.5 text-sm'>
              <CheckCircle2Icon className='size-4' /> No flags raised
            </p>
          ) : (
            <ul className='flex flex-col gap-1.5'>
              {raised.map(x => (
                <li key={x.label} className='text-danger flex items-center gap-1.5 text-sm'>
                  <AlertTriangleIcon className='size-4 shrink-0' /> {x.label}
                </li>
              ))}
            </ul>
          )}
          <p className='text-muted-foreground text-xs'>
            {formatNumber(risk.logins)} sign-ins in total, from {formatNumber(risk.distinctIps)} IP{risk.distinctIps === 1 ? '' : 's'}.
          </p>
        </Panel>
      </div>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <ChartCard
          title='Active days'
          description={`${formatNumber(s.kpis.activeDays)} of ${formatNumber(f.days)} days with a sign-in or a bet · ${formatNumber(s.kpis.logins)} sign-ins · ${formatNumber(s.kpis.bets)} bets.`}
        >
          <ActivityHeatmap from={f.from} to={f.to} days={s.days} />
        </ChartCard>

        <ChartCard
          title='Sign-ins and bets'
          description={`Per ${f.granularity}.`}
          table={seriesTable({ buckets: f.buckets, granularity: f.granularity, series: activity, format: 'number' })}
        >
          <TimeSeriesChart
            ariaLabel={`Sign-ins and bets per ${f.granularity}`}
            buckets={f.buckets}
            granularity={f.granularity}
            series={activity}
            kind='bar'
            format='number'
            height={220}
            loading={q.isLoading}
            error={q.error}
            emptyMessage='No sign-ins or bets in this period.'
          />
        </ChartCard>
      </div>

      <Card className='shadow-none'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-sm font-medium'>
            <GiftIcon className='text-muted-foreground size-4' /> Wagering on active bonuses
          </CardTitle>
        </CardHeader>
        <CardContent>
          {s.bonuses.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No active bonus.</p>
          ) : (
            <ul className='flex flex-col gap-4'>
              {s.bonuses.map(bonus => (
                <li key={bonus.id} className='flex flex-col gap-1.5'>
                  <div className='flex flex-wrap items-baseline justify-between gap-2 text-sm'>
                    <span className='font-medium'>
                      {bonus.description || bonus.source} · <Money value={bonus.amount} currency={bonus.currency} />
                    </span>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {formatMoney(bonus.wagered, undefined, { digits: 2 })} / {formatMoney(bonus.requiredWager, undefined, { digits: 2 })} {bonus.currency} wagered ·{' '}
                      {bonus.progressPct.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={bonus.progressPct} aria-label={`Wagering progress, ${bonus.progressPct.toFixed(1)}%`} />
                  <span className='text-muted-foreground text-xs'>
                    {bonus.wagerMultiplier}× wagering · granted <DateTime value={bonus.grantedAt} relative />
                    {bonus.expiresAt ? <> · expires <DateTime value={bonus.expiresAt} /></> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

const Panel = ({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) => (
  <Card className='gap-3 shadow-none'>
    <CardHeader>
      <CardTitle className='flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground'>
        {icon} {title}
      </CardTitle>
    </CardHeader>
    <CardContent className='flex flex-col gap-3'>{children}</CardContent>
  </Card>
)

/** A restriction: red when on, quiet when off. */
const Flag = ({ on, label }: { on: boolean; label: string }) => (
  <Badge variant='outline' className={cn('rounded-full border-transparent text-xs', on ? 'bg-danger-soft text-danger' : 'bg-muted text-muted-foreground line-through decoration-1')}>
    {label}
    <span className='sr-only'>{on ? ' (on)' : ' (off)'}</span>
  </Badge>
)

/** A safeguard: green when present, amber when missing. */
const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <Badge variant='outline' className={cn('rounded-full border-transparent text-xs', ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
    {label}
  </Badge>
)

const DAY_MS = 86_400_000
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', '']

/**
 * One square per UTC day of the period, a column per week (Monday first): darker = more sign-ins
 * and bets. Each square has a title and the grid an accessible summary; the numbers are also in
 * the "Sign-ins and bets" table.
 */
const ActivityHeatmap = ({ from, to, days }: { from: string; to: string; days: PlayerStatus['days'] }) => {
  const byDay = new Map(days.map(d => [d.day, d]))
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  const lead = (new Date(start).getUTCDay() + 6) % 7
  const cells: ({ day: string; n: number; logins: number; bets: number } | null)[] = Array.from({ length: lead }, () => null)

  for (let t = start; t <= end; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10)
    const d = byDay.get(day)

    cells.push({ day, n: (d?.logins ?? 0) + (d?.bets ?? 0), logins: d?.logins ?? 0, bets: d?.bets ?? 0 })
  }

  const max = Math.max(1, ...cells.map(c => c?.n ?? 0))

  const tone = (n: number) => {
    if (n === 0) return 'bg-muted'
    const r = n / max

    if (r > 0.75) return 'bg-primary'
    if (r > 0.4) return 'bg-primary/70'
    if (r > 0.15) return 'bg-primary/45'

    return 'bg-primary/25'
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex gap-1 overflow-x-auto pb-1'>
        <div className='text-muted-foreground grid grid-rows-7 gap-1 pr-1 text-[10px] leading-3' aria-hidden>
          {WEEKDAYS.map((w, i) => (
            <span key={i} className='h-3'>{w}</span>
          ))}
        </div>
        <div
          role='img'
          aria-label={`Activity heatmap: ${days.filter(d => d.logins + d.bets > 0).length} active days between ${from} and ${to}`}
          className='grid auto-cols-[0.75rem] grid-flow-col grid-rows-7 gap-1'
        >
          {cells.map((c, i) =>
            c ? (
              <span
                key={c.day}
                className={cn('size-3 rounded-[3px]', tone(c.n))}
                title={`${c.day}: ${c.logins} sign-in${c.logins === 1 ? '' : 's'}, ${c.bets} bet${c.bets === 1 ? '' : 's'}`}
              />
            ) : (
              <span key={`pad-${i}`} className='size-3' />
            )
          )}
        </div>
      </div>
      <div className='text-muted-foreground flex items-center gap-1 text-[10px]' aria-hidden>
        Less
        {['bg-muted', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'].map(c => (
          <span key={c} className={cn('size-3 rounded-[3px]', c)} />
        ))}
        More
      </div>
    </div>
  )
}

export default PlayerStatusSection
