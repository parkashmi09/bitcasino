'use client'

import Link from 'next/link'

import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { BetsReport, BranchDashboard, BranchPlayers, BranchStatement, BranchTitle, MoneyReport, PlayerPage, type BetKind } from './BranchView'

/** The branch panel's pages: the shared branch reports on the branch's own API (`admin/branches/portal`). */
const BASE = 'admin/branches/portal'

const playerHref = (id: string) => `/branch/users/${id}`

export const PanelDashboard = () => <BranchDashboard base={BASE} />

export const PanelUsers = () => (
  <div>
    <BranchTitle title='Users' description='Your players. Create an ID here; open a player for their deposits, withdrawals, bets and statement.' />
    <BranchPlayers base={BASE} playerHref={playerHref} />
  </div>
)

export const PanelPlayer = ({ userId }: { userId: string }) => (
  <PlayerPage
    base={BASE}
    userId={userId}
    back={
      <Button variant='outline' nativeButton={false} render={<Link href='/branch/users' />}>
        <ArrowLeftIcon /> All users
      </Button>
    }
  />
)

const MONEY_TITLES = {
  deposits: ['Deposits', 'Every deposit request of your players, on every payment method and in every status.'],
  withdrawals: ['Withdrawals', 'Every withdrawal request of your players, on every payment method and in every status.']
} as const

export const PanelMoney = ({ kind }: { kind: 'deposits' | 'withdrawals' }) => (
  <div>
    <BranchTitle title={MONEY_TITLES[kind][0]} description={MONEY_TITLES[kind][1]} />
    <MoneyReport base={BASE} kind={kind} />
  </div>
)

const BET_TITLES: Record<BetKind, [string, string]> = {
  originals: ['Originals', "Your players' rounds on the site's own games."],
  casino: ['Casino', "Your players' rounds on third-party casino games."],
  sports: ['Sports', "Your players' sports bets."]
}

export const PanelBets = ({ kind }: { kind: BetKind }) => (
  <div>
    <BranchTitle title={BET_TITLES[kind][0]} description={BET_TITLES[kind][1]} />
    <BetsReport base={BASE} kind={kind} />
  </div>
)

export const PanelStatement = () => (
  <div>
    <BranchTitle title='Statement' description="Every balance change of your players: deposits, withdrawals, bets, wins and bonuses." />
    <BranchStatement base={BASE} />
  </div>
)
