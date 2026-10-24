'use client'

import { useState, type ReactNode } from 'react'

import { ChartColumnIcon, ListIcon } from 'lucide-react'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Deposit / Withdraw screens: pehle **Listing** (table), stats / charts alag **Stats** tab me.
 * `stats` null ho (reports:read nahi) to tabs nahi, sirf listing.
 */
const ListStatsTabs = ({ stats, children }: { stats: ReactNode; children: ReactNode }) => {
  const [tab, setTab] = useState<'list' | 'stats'>('list')

  if (!stats) return <>{children}</>

  return (
    <div>
      <Tabs value={tab} onValueChange={v => setTab(v === 'stats' ? 'stats' : 'list')}>
        <TabsList className='mb-4'>
          <TabsTrigger value='list'>
            <ListIcon /> Listing
          </TabsTrigger>
          <TabsTrigger value='stats'>
            <ChartColumnIcon /> Stats
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'list' ? children : stats}
    </div>
  )
}

export default ListStatsTabs
