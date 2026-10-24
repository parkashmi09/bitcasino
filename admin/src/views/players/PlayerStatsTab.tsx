'use client'

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BadgePlusIcon,
  CrownIcon,
  DicesIcon,
  GiftIcon,
  HandCoinsIcon,
  LandmarkIcon,
  ScaleIcon,
  SendIcon,
  TrophyIcon,
  VaultIcon,
  WalletIcon
} from 'lucide-react'

import { FilterBar, useStatsFilters } from '@/components/shared/charts'
import DateTime from '@/components/shared/DateTime'
import StatCard from '@/components/shared/StatCard'
import { useSession } from '@/contexts/SessionContext'
import { useApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'
import StatsPanel, { formatStat, num, type StatsPanelConfig, type StatsResponse } from '@/views/reports/StatsPanel'

import PlayerStatusSection from './PlayerStatusSection'

/**
 * `GET admin/reports/players/:id/stats` — `from`/`to` (instants), `granularity`, `currency`.
 * `reports:read`, and the player detail's own tree check: a player outside the caller's tree is a
 * 404, the same as the detail itself.
 */
const pathFor = (id: string) => `admin/reports/players/${id}/stats`

/** `house: false` for agent-tree callers: VIP, vault, rakeback and bonus figures come back null. */
type PlayerStatsMeta = { house?: boolean; note?: string | null }

/** The KPI cards the API answers only for house staff (see the backend's playerStats.forPlayer). */
const HOUSE_ONLY_KPIS = new Set(['bonusGranted', 'rewardsCredited', 'rakebackClaimed', 'vaultBalance', 'vaultInterest'])

type PlayerStatsKpis = {
  vip?: { level: number; name: string; card: string; nextName: string | null; progressPct: string }
  lifetimeWagerUsd?: string
  firstActivityAt?: string | null
  lastActivityAt?: string | null
}

const CONFIG: StatsPanelConfig = {
  kpis: [
    {
      key: 'deposited',
      label: 'Deposits',
      format: 'money',
      icon: <ArrowDownToLineIcon />,
      spark: 'deposits',
      sparkColor: 'chart-1',

      // Real deposits only; the Super Admin's Direct User Wallet credit is the "Admin credit" line.
      hint: k => `${formatNumber(num(k.deposits))} paid in by the player (bank, gateway, crypto) · admin credits not included`
    },
    { key: 'adminCredited', label: 'Admin credit', format: 'money', icon: <BadgePlusIcon />, goodWhen: 'neutral', hint: () => 'Super Admin Direct User Wallet credits — not a deposit' },
    { key: 'withdrawn', label: 'Withdrawn', format: 'money', icon: <ArrowUpFromLineIcon />, spark: 'withdrawals', sparkColor: 'chart-2', goodWhen: 'neutral', hint: k => `${formatNumber(num(k.withdrawals))} withdrawals` },
    { key: 'netDeposit', label: 'Net deposit', format: 'money', icon: <ScaleIcon />, goodWhen: 'neutral' },
    {
      key: 'wagered',
      label: 'Wagered',
      format: 'money',
      icon: <DicesIcon />,
      spark: 'wagered',
      sparkColor: 'chart-3',
      goodWhen: 'neutral',
      hint: (k, unit) => `Casino ${formatStat(k.casinoWagered, 'money')} · sports ${formatStat(k.sportsWagered, 'money')} ${unit}`
    },
    { key: 'won', label: 'Won', format: 'money', icon: <TrophyIcon />, spark: 'won', sparkColor: 'chart-4', goodWhen: 'neutral', hint: k => `${formatNumber(num(k.bets))} bets` },
    { key: 'ggr', label: 'GGR (house)', format: 'money', icon: <LandmarkIcon />, spark: 'ggr', sparkColor: 'chart-5', goodWhen: 'neutral', hint: () => 'Wagered minus won' },
    {
      key: 'bonusGranted',
      label: 'Bonus granted',
      format: 'money',
      icon: <GiftIcon />,
      goodWhen: 'neutral',
      hint: (k, unit) => `${formatStat(k.bonusConverted, 'money')} ${unit} converted · ${formatStat(k.bonusActive, 'money')} locked`
    },
    {
      key: 'rewardsCredited',
      label: 'Bonus & VIP credits',
      format: 'money',
      icon: <CrownIcon />,
      goodWhen: 'neutral',
      hint: (k, unit) => `Rakeback ${formatStat(k.rakebackClaimed, 'money')} ${unit} · periodic ${formatStat(k.vipPeriodicClaimedUsd, 'usd')} USD`
    },
    { key: 'rakebackClaimed', label: 'Rakeback received', format: 'money', icon: <HandCoinsIcon />, goodWhen: 'neutral' },
    {
      key: 'tipsSent',
      label: 'Tips sent',
      format: 'money',
      icon: <SendIcon />,
      goodWhen: 'neutral',
      hint: (k, unit) => `${formatNumber(num(k.tipsSentCount))} sent · received ${formatStat(k.tipsReceived, 'money')} ${unit} (${formatNumber(num(k.tipsReceivedCount))})`
    },
    {
      key: 'vaultBalance',
      label: 'Vault balance',
      format: 'money',
      icon: <VaultIcon />,
      delta: false,
      hint: (k, unit) => `In ${formatStat(k.vaultIn, 'money')} · out ${formatStat(k.vaultOut, 'money')} ${unit} this period`
    },
    { key: 'vaultInterest', label: 'Vault interest', format: 'money', icon: <WalletIcon />, goodWhen: 'neutral', hint: () => 'Credited on locks this period' }
  ],
  charts: [
    {
      title: 'Deposits vs withdrawals',
      format: 'money',
      kind: 'bar',
      series: [
        { key: 'deposits', name: 'Deposits', color: 'chart-1' },
        { key: 'withdrawals', name: 'Withdrawals', color: 'chart-2' }
      ],
      emptyMessage: 'No deposits or withdrawals in this period.'
    },
    {
      title: 'Wagered vs won',
      description: 'Stakes (less refunds), payouts and the house result (GGR).',
      format: 'money',
      kind: 'line',
      series: [
        { key: 'wagered', name: 'Wagered', color: 'chart-3' },
        { key: 'won', name: 'Won', color: 'chart-4' },
        { key: 'ggr', name: 'GGR', color: 'chart-5', kind: 'bar' }
      ],
      emptyMessage: 'No bets in this period.'
    }
  ],
  breakdowns: [
    {
      title: 'Casino vs sports',
      description: 'Wagered, by product.',
      path: 'products',
      kind: 'donut',
      format: 'money',
      values: [{ key: 'wagered', name: 'Wagered' }],
      emptyMessage: 'No bets in this period.'
    },
    {
      title: 'Top providers',
      description: 'By wagered; the wallet integration that settled the bet.',
      path: 'providers',
      kind: 'bar',
      horizontal: true,
      format: 'money',
      values: [
        { key: 'wagered', name: 'Wagered', color: 'chart-3' },
        { key: 'ggr', name: 'GGR', color: 'chart-5' }
      ],
      emptyMessage: 'No casino bets in this period.'
    },
    {
      title: 'Top sports',
      description: 'Stakes by sport, in the report currency.',
      path: 'sports',
      kind: 'bar',
      horizontal: true,
      format: 'usd',
      values: [{ key: 'wagerUsd', name: 'Staked', color: 'chart-1' }],
      emptyMessage: 'No sports bets in this period.'
    }
  ]
}

/** One player's own figures for the chosen period — the "Stats" tab of the user page. */
const PlayerStatsTab = ({ userId }: { userId: string }) => {
  const f = useStatsFilters({ defaultPreset: '30d' })
  const path = pathFor(userId)

  // The same request the panel makes (same key, so one fetch): the standing that is not a flow.
  const q = useApi<StatsResponse & PlayerStatsMeta>(path, f.query, { placeholderData: prev => prev, retry: false })
  const k = (q.data?.kpis ?? {}) as PlayerStatsKpis
  const { actor } = useSession()

  // Until the answer says so, the session decides: agent-tree logins see no promotions.
  const house = q.data?.house ?? actor?.promotions === true
  const config = house ? CONFIG : { ...CONFIG, kpis: CONFIG.kpis.filter(x => !HOUSE_ONLY_KPIS.has(x.key)) }

  return (
    <div className='flex flex-col gap-4'>
      <FilterBar filters={f} />
      <PlayerStatusSection userId={userId} filters={f} />
      <StatsPanel path={path} filters={f} config={config}>
        {!house && (
          <p role='note' className='bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm'>
            {q.data?.note ?? 'VIP, vault, rakeback and bonus figures are house-only and are not shown for agent accounts.'}
          </p>
        )}
        {!q.error && (
          <div className={`grid grid-cols-1 gap-4 ${house ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {house && (
              <StatCard
                label='VIP tier'
                loading={q.isLoading}
                icon={<CrownIcon />}
                value={k.vip ? `${k.vip.name} (L${k.vip.level})` : '—'}
                hint={k.vip ? (k.vip.nextName ? `${k.vip.progressPct}% to ${k.vip.nextName} · lifetime ${formatStat(k.lifetimeWagerUsd, 'usd')} USD` : 'Top level') : undefined}
              />
            )}
            <StatCard label='First activity' loading={q.isLoading} value={k.firstActivityAt ? <DateTime value={k.firstActivityAt} /> : '—'} hint='First wallet movement' />
            <StatCard label='Last activity' loading={q.isLoading} value={k.lastActivityAt ? <DateTime value={k.lastActivityAt} relative /> : '—'} hint='Latest wallet movement' />
          </div>
        )}
      </StatsPanel>
    </div>
  )
}

export default PlayerStatsTab
