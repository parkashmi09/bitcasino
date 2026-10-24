'use client'

import type { ReactNode } from 'react'

import { ActivityIcon, ArrowDownToLineIcon, BadgePercentIcon, DicesIcon, UserPlusIcon, UsersIcon, WalletIcon } from 'lucide-react'

import { FilterBar, useStatsFilters } from '@/components/shared/charts'
import { formatNumber } from '@/lib/format'

import StatsPanel, { num, type StatsPanelConfig } from './StatsPanel'

/**
 * `GET admin/reports/player-stats` — `from`/`to` (instants), `granularity`, `currency`, `channel`
 * (all|direct|agent, the same filter as the users table below). Scoped to the caller's tree like
 * the users table: an agent sees only their own players.
 */
const PATH = 'admin/reports/player-stats'

const CONFIG: StatsPanelConfig = {
  kpis: [
    {
      key: 'newPlayers',
      label: 'New players',
      format: 'number',
      icon: <UserPlusIcon />,
      spark: 'newPlayers',
      sparkColor: 'chart-1',
      hint: k => `${formatNumber(num(k.totalPlayers))} players in total`
    },
    {
      key: 'activePlayers',
      label: 'Active players',
      format: 'number',
      icon: <ActivityIcon />,
      spark: 'activePlayers',
      sparkColor: 'chart-2',
      hint: () => 'Played casino or sports (the wager reports\' players)'
    },
    {
      key: 'depositors',
      label: 'Depositors',
      format: 'number',
      icon: <UsersIcon />,
      spark: 'depositors',
      sparkColor: 'chart-3',
      hint: k => `${formatNumber(num(k.firstTimeDepositors))} first-time`
    },
    {
      key: 'conversionRate',
      label: 'Conversion',
      format: 'percent',
      icon: <BadgePercentIcon />,
      hint: k => `${formatNumber(num(k.newDepositors))} of ${formatNumber(num(k.newPlayers))} new players deposited`
    },
    {
      key: 'depositAmount',
      label: 'Deposits',
      format: 'money',
      icon: <ArrowDownToLineIcon />,
      spark: 'depositAmount',
      sparkColor: 'chart-1',
      hint: k => `${formatNumber(num(k.deposits))} deposits`
    },
    { key: 'averageDeposit', label: 'Average deposit', format: 'money', icon: <WalletIcon /> },
    { key: 'firstTimeDepositors', label: 'First-time depositors', format: 'number', icon: <UserPlusIcon />, spark: 'firstTimeDepositors', sparkColor: 'chart-4' },
    {
      key: 'wagerUsd',
      label: 'Wagered',

      // In the report currency (`kpis.wagerCurrency`): the same turnover as the casino + sports wager reports.
      format: 'money',
      icon: <DicesIcon />,
      spark: 'wagerUsd',
      sparkColor: 'chart-5',
      hint: () => 'Casino + sports turnover, as on the wager reports'
    }
  ],
  charts: [
    {
      title: 'New and active players',
      format: 'number',
      kind: 'line',
      series: [
        { key: 'newPlayers', name: 'New players', color: 'chart-1' },
        { key: 'activePlayers', name: 'Active players', color: 'chart-2' },
        { key: 'originalsPlayers', name: 'Originals players', color: 'chart-4' }
      ]
    },
    {
      title: 'Depositors',
      format: 'number',
      kind: 'bar',
      series: [
        { key: 'depositors', name: 'Depositors', color: 'chart-3' },
        { key: 'firstTimeDepositors', name: 'First-time', color: 'chart-4' }
      ]
    },
    {
      title: 'Deposit volume',
      format: 'money',
      kind: 'bar',
      series: [{ key: 'depositAmount', name: 'Deposits', color: 'chart-1' }]
    }
  ],
  breakdowns: [
    { title: 'New players by channel', path: 'channel', kind: 'donut', format: 'number', emptyMessage: 'No new players in this period.' },
    { title: 'Active players by product', path: 'activeByProduct', kind: 'donut', format: 'number', emptyMessage: 'No bets in this period.' },
    {
      title: 'New players by country',
      path: 'countries',
      kind: 'bar',
      horizontal: true,
      format: 'number',
      values: [{ key: 'value', name: 'New players', color: 'chart-1' }],
      emptyMessage: 'No new players in this period.'
    }
  ]
}

/** The player-base charts above the users table; `channel` is the table's own filter. */
const PlayerStatsOverview = ({ channel, children }: { channel?: string; children?: ReactNode }) => {
  const f = useStatsFilters({ defaultPreset: '30d' })

  return (
    <section aria-label='Player statistics' className='mb-6 flex flex-col gap-4'>
      <FilterBar filters={f}>
        {children}
      </FilterBar>
      <StatsPanel path={PATH} filters={f} extraQuery={channel ? { channel } : undefined} config={CONFIG} />
    </section>
  )
}

export default PlayerStatsOverview
