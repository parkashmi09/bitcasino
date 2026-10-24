'use client'

import type { ReactNode } from 'react'

import {
  ArchiveIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BadgePercentIcon,
  BanIcon,
  CheckCheckIcon,
  CoinsIcon,
  CrownIcon,
  GiftIcon,
  HandCoinsIcon,
  HandshakeIcon,
  HourglassIcon,
  LockIcon,
  PercentIcon,
  SendIcon,
  TrophyIcon,
  UsersIcon
} from 'lucide-react'

import { FilterBar, type StatsFilters } from '@/components/shared/charts'
import { useRewardCurrency } from '@/components/shared/RewardCurrency'
import { formatNumber } from '@/lib/format'
import StatsPanel, { formatStat, num, type StatsPanelConfig } from '@/views/reports/StatsPanel'

/**
 * `GET admin/reports/reward-stats/<section>` — `from`/`to` (instants), `granularity`; every currency, valued in the default coin.
 * Scoped to the caller's tree like the users report. `tips` and `bonus-balances` answer every staff
 * level; `vault`, `vip`, `bonus` and `affiliate` are house-only (403 for the agent tree), exactly as
 * the tables on those pages are.
 */
export type RewardSection = 'tips' | 'vault' | 'vip' | 'bonus' | 'bonus-balances' | 'affiliate'

const count = (key: string, noun: string) => (k: Record<string, unknown>) => `${formatNumber(num(k[key]))} ${noun}`

const CONFIGS: Record<RewardSection, StatsPanelConfig> = {
  tips: {
    kpis: [
      { key: 'tips', label: 'Tips sent', format: 'number', icon: <SendIcon />, spark: 'count', sparkColor: 'chart-2' },
      { key: 'volume', label: 'Tip volume', format: 'money', icon: <HandCoinsIcon />, spark: 'volume', sparkColor: 'chart-1' },
      { key: 'averageTip', label: 'Average tip', format: 'money', icon: <CoinsIcon /> },
      { key: 'senders', label: 'Tipping players', format: 'number', icon: <UsersIcon />, hint: count('receivers', 'received a tip') }
    ],
    charts: [
      { title: 'Tip volume', format: 'money', kind: 'bar', series: [{ key: 'volume', name: 'Volume', color: 'chart-1' }], emptyMessage: 'No tips in this period.' },
      { title: 'Tips sent', format: 'number', kind: 'line', series: [{ key: 'count', name: 'Tips', color: 'chart-2' }], emptyMessage: 'No tips in this period.' }
    ],
    breakdowns: [
      {
        title: 'Top tippers',
        description: 'By volume sent in this period.',
        path: 'topSenders',
        kind: 'bar',
        horizontal: true,
        format: 'money',
        values: [{ key: 'volume', name: 'Volume', color: 'chart-1' }],
        emptyMessage: 'No tips in this period.'
      }
    ]
  },

  vault: {
    kpis: [
      { key: 'vaultIn', label: 'Locked in', format: 'money', icon: <ArrowDownToLineIcon />, spark: 'vaultIn', sparkColor: 'chart-1', hint: count('deposits', 'deposits') },
      { key: 'vaultOut', label: 'Released', format: 'money', icon: <ArrowUpFromLineIcon />, spark: 'vaultOut', sparkColor: 'chart-2', goodWhen: 'neutral', hint: count('withdrawals', 'withdrawals') },
      { key: 'interestPaid', label: 'Interest paid', format: 'money', icon: <PercentIcon />, spark: 'interest', sparkColor: 'chart-4', goodWhen: 'neutral' },
      { key: 'lockedNow', label: 'Locked now', format: 'money', icon: <LockIcon />, delta: false, hint: count('activeLocks', 'active locks') }
    ],
    charts: [
      {
        title: 'Vault in and out',
        format: 'money',
        kind: 'bar',
        series: [
          { key: 'vaultIn', name: 'Locked in', color: 'chart-1' },
          { key: 'vaultOut', name: 'Released', color: 'chart-2' }
        ],
        emptyMessage: 'No vault movements in this period.'
      },
      { title: 'Interest paid', format: 'money', kind: 'area', series: [{ key: 'interest', name: 'Interest', color: 'chart-4' }], emptyMessage: 'No interest paid in this period.' }
    ],
    breakdowns: [
      { title: 'Locked now, by term', description: 'Principal in active locks.', path: 'lockedByPeriod', kind: 'donut', format: 'money', emptyMessage: 'Nothing is locked.' }
    ]
  },

  vip: {
    kpis: [
      { key: 'vipRewardsPaid', label: 'VIP rewards paid', format: 'money', icon: <CrownIcon />, spark: 'vipRewards', sparkColor: 'chart-1', goodWhen: 'neutral', hint: () => 'Level-up and rank-up credits' },
      { key: 'rakebackClaimed', label: 'Rakeback paid', format: 'money', icon: <HandCoinsIcon />, spark: 'rakebackClaimed', sparkColor: 'chart-2', goodWhen: 'neutral' },
      {
        key: 'rakebackAccruedUsd',
        label: 'Rakeback accrued',
        format: 'usd',
        icon: <HourglassIcon />,
        spark: 'rakebackAccruedUsd',
        sparkColor: 'chart-3',
        goodWhen: 'neutral',
        hint: count('rakebackPlayers', 'players earning')
      },
      {
        key: 'periodicClaimRate',
        label: 'Daily/weekly/monthly claimed',
        format: 'percent',
        icon: <GiftIcon />,
        hint: k => `${formatNumber(num(k.periodicClaimed))} of ${formatNumber(num(k.periodicAwarded))} awards · ${formatStat(k.periodicClaimedUsd, 'usd')} USD`
      },
      { key: 'rankedPlayers', label: 'Ranked players', format: 'number', icon: <TrophyIcon />, delta: false, hint: k => `of ${formatNumber(num(k.players))} players` },
      {
        key: 'clubEarnings',
        label: 'Club earnings',
        format: 'money',
        icon: <UsersIcon />,
        hint: k => `${formatNumber(num(k.activeClubs))} active clubs · ${formatNumber(num(k.clubMembers))} members`
      }
    ],
    charts: [
      {
        title: 'VIP rewards and rakeback paid',
        format: 'money',
        kind: 'bar',
        stacked: true,
        series: [
          { key: 'vipRewards', name: 'VIP rewards', color: 'chart-1' },
          { key: 'rakebackClaimed', name: 'Rakeback', color: 'chart-2' }
        ],
        emptyMessage: 'Nothing paid in this period.'
      },
      {
        title: 'Rakeback accrued',
        description: 'Earned on counted stakes before it is claimed. USD by design.',
        format: 'usd',
        kind: 'area',
        series: [{ key: 'rakebackAccruedUsd', name: 'Accrued', color: 'chart-3' }],
        emptyMessage: 'No rakeback accrued in this period.'
      }
    ],
    breakdowns: [
      {
        title: 'Players by VIP tier',
        description: 'Where every player stands now, on lifetime wager.',
        path: 'tiers',
        kind: 'bar',
        format: 'number',
        values: [{ key: 'value', name: 'Players', color: 'chart-5' }]
      },
      { title: 'Rewards paid, by kind', path: 'rewardsByKind', kind: 'donut', format: 'money', emptyMessage: 'Nothing paid in this period.' }
    ]
  },

  bonus: {
    kpis: [
      { key: 'bonusPaid', label: 'Bonuses paid', format: 'money', icon: <GiftIcon />, spark: 'paid', sparkColor: 'chart-1', goodWhen: 'neutral', hint: count('bonusCredits', 'credits') },
      { key: 'periodicAwarded', label: 'Periodic bonuses awarded', format: 'number', icon: <TrophyIcon />, goodWhen: 'neutral' },
      { key: 'periodicClaimed', label: 'Periodic bonuses claimed', format: 'number', icon: <CheckCheckIcon />, goodWhen: 'neutral' },
      { key: 'periodicClaimRate', label: 'Claim rate', format: 'percent', icon: <BadgePercentIcon /> }
    ],
    charts: [
      { title: 'Bonuses paid to wallets', format: 'money', kind: 'bar', series: [{ key: 'paid', name: 'Paid', color: 'chart-1' }], emptyMessage: 'No bonuses paid in this period.' },
      {
        title: 'Daily, weekly and monthly bonuses',
        description: 'Awarded and claimed, by the day they were awarded. USD by design.',
        format: 'usd',
        kind: 'line',
        series: [
          { key: 'periodicAwardedUsd', name: 'Awarded', color: 'chart-3' },
          { key: 'periodicClaimedUsd', name: 'Claimed', color: 'chart-2' }
        ],
        emptyMessage: 'No periodic bonuses in this period.'
      }
    ],
    breakdowns: [
      { title: 'Paid, by kind', description: 'What paid each bonus credit.', path: 'paidByKind', kind: 'donut', format: 'money', emptyMessage: 'No bonuses paid in this period.' },
      {
        title: 'Periodic bonuses, by type',
        path: 'periodicByType',
        kind: 'bar',
        format: 'number',
        values: [
          { key: 'awarded', name: 'Awarded', color: 'chart-3' },
          { key: 'claimed', name: 'Claimed', color: 'chart-2' }
        ]
      }
    ]
  },

  'bonus-balances': {
    kpis: [
      { key: 'granted', label: 'Granted', format: 'money', icon: <GiftIcon />, spark: 'granted', sparkColor: 'chart-1', goodWhen: 'neutral', hint: count('grantedCount', 'bonuses') },
      { key: 'converted', label: 'Converted to cash', format: 'money', icon: <CheckCheckIcon />, spark: 'converted', sparkColor: 'chart-2', goodWhen: 'neutral', hint: count('convertedCount', 'bonuses') },
      { key: 'forfeited', label: 'Forfeited / expired', format: 'money', icon: <BanIcon />, spark: 'forfeited', sparkColor: 'chart-6', goodWhen: 'neutral', hint: count('forfeitedCount', 'bonuses') },
      { key: 'activeBalance', label: 'Locked now', format: 'money', icon: <ArchiveIcon />, delta: false, hint: count('activeBonuses', 'active bonuses') },
      { key: 'conversionRate', label: 'Conversion', format: 'percent', icon: <BadgePercentIcon />, hint: () => 'Converted, of bonuses that ended' },
      {
        key: 'wageringProgress',
        label: 'Wagering progress',
        format: 'percent',
        icon: <HourglassIcon />,
        hint: (k, unit) => `${formatStat(k.wagered, 'money')} of ${formatStat(k.requiredWager, 'money')} ${unit}, on bonuses granted in this period`
      }
    ],
    charts: [
      {
        title: 'Granted, converted and forfeited',
        description: 'Each by the day it happened.',
        format: 'money',
        kind: 'bar',
        wide: true,
        series: [
          { key: 'granted', name: 'Granted', color: 'chart-1' },
          { key: 'converted', name: 'Converted', color: 'chart-2' },
          { key: 'forfeited', name: 'Forfeited', color: 'chart-6' }
        ],
        emptyMessage: 'No bonus activity in this period.'
      }
    ],
    breakdowns: [
      { title: 'Outcome', description: 'Bonuses that ended in this period, and those still running.', path: 'outcome', kind: 'donut', format: 'number' },
      { title: 'Granted, by source', path: 'bySource', kind: 'donut', format: 'money', emptyMessage: 'No bonuses granted in this period.' }
    ]
  },

  affiliate: {
    kpis: [
      { key: 'accrued', label: 'Commission accrued', format: 'money', icon: <HandshakeIcon />, spark: 'accrued', sparkColor: 'chart-1', goodWhen: 'neutral', hint: count('accruedCount', 'rewards') },
      { key: 'claimed', label: 'Commission claimed', format: 'money', icon: <CheckCheckIcon />, spark: 'claimed', sparkColor: 'chart-2', goodWhen: 'neutral', hint: count('claimedCount', 'claims') },
      { key: 'voided', label: 'Voided', format: 'money', icon: <BanIcon />, spark: 'voided', sparkColor: 'chart-6', goodWhen: 'neutral', hint: count('voidedCount', 'rewards') },
      { key: 'unclaimedNow', label: 'Unclaimed now', format: 'money', icon: <HourglassIcon />, delta: false },
      { key: 'tierRewardsPaid', label: 'Tier rewards paid', format: 'money', icon: <TrophyIcon />, goodWhen: 'neutral' },
      { key: 'earningAffiliates', label: 'Earning affiliates', format: 'number', icon: <UsersIcon /> }
    ],
    charts: [
      {
        title: 'Commission accrued, claimed and voided',
        format: 'money',
        kind: 'bar',
        wide: true,
        series: [
          { key: 'accrued', name: 'Accrued', color: 'chart-1' },
          { key: 'claimed', name: 'Claimed', color: 'chart-2' },
          { key: 'voided', name: 'Voided', color: 'chart-6' }
        ],
        emptyMessage: 'No commission in this period.'
      }
    ],
    breakdowns: [
      {
        title: 'Top affiliates',
        description: 'Commission accrued in this period (not voided).',
        path: 'topAffiliates',
        kind: 'bar',
        horizontal: true,
        format: 'money',
        values: [{ key: 'value', name: 'Accrued', color: 'chart-1' }],
        emptyMessage: 'No commission in this period.'
      },
      { title: 'Accrued, by type', path: 'byType', kind: 'donut', format: 'money', emptyMessage: 'No commission in this period.' }
    ]
  }
}

type Props = {
  section: RewardSection
  filters: StatsFilters

  /** Extra controls for the filter row. */
  children?: ReactNode

  /** The "rewards are paid in …" line; off where the page already shows the reward-currency notice. */
  rewardNote?: boolean
  className?: string
}

/** The filter bar and the charts for one Rewards page. The page's table can read the same `filters`. */
const RewardStats = ({ section, filters, children, rewardNote = true, className }: Props) => {
  const reward = useRewardCurrency()
  const paidInRewardCurrency = rewardNote && section !== 'tips' && section !== 'vault'

  return (
    <section aria-label='Statistics' className={className ?? 'mb-6 flex flex-col gap-4'}>
      <FilterBar filters={filters}>
        {children}
      </FilterBar>
      {paidInRewardCurrency && !reward.loading && (
        <p className='text-muted-foreground -mt-2 text-xs'>
          Rewards are paid in {reward.code}. These figures value every coin in the site’s default coin at today’s rate.
        </p>
      )}
      <StatsPanel path={`admin/reports/reward-stats/${section}`} filters={filters} config={CONFIGS[section]} />
    </section>
  )
}

export default RewardStats
