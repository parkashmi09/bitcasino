import { Suspense } from 'react'

import SettlementTabs from '@/views/exchange/settlement/SettlementTabs'

export const metadata = { title: 'Settlement' }

export default function Page() {
  return (
    <Suspense>
      <SettlementTabs />
    </Suspense>
  )
}
