'use client'

import TabbedPage from '@/components/shared/TabbedPage'
import FancySettlement from './FancySettlement'
import MatchSettlement from './MatchSettlement'
import VoidBets from './VoidBets'

/** Sports Exchange → Settlement: teeno screen ek page pe, tab se switch (`?tab=`). */
const SettlementTabs = () => (
  <TabbedPage
    tabs={[
      { value: 'match', label: 'Match Settlement', render: () => <MatchSettlement /> },
      { value: 'fancy', label: 'Fancy Settlement', render: () => <FancySettlement /> },
      { value: 'void-bets', label: 'Void Bets', render: () => <VoidBets /> }
    ]}
  />
)

export default SettlementTabs
