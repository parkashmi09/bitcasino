'use client'

import TabbedPage from '@/components/shared/TabbedPage'
import AutoVoid from './AutoVoid'
import BetLimits from './BetLimits'
import BufferTime from './BufferTime'
import Commission from './Commission'
import MaxOdds from './MaxOdds'

/** Sports Exchange → Global Settings: saari sports settings ek page pe, tab se switch (`?tab=`). */
const GlobalSettings = () => (
  <TabbedPage
    tabs={[
      { value: 'buffer-time', label: 'Buffer Time', render: () => <BufferTime /> },
      { value: 'commission', label: 'Commission', render: () => <Commission /> },
      { value: 'max-odds', label: 'Max Odds', render: () => <MaxOdds /> },
      { value: 'auto-void', label: 'Auto Void', render: () => <AutoVoid /> },
      { value: 'bet-limits', label: 'Bet Limits', render: () => <BetLimits /> }
    ]}
  />
)

export default GlobalSettings
