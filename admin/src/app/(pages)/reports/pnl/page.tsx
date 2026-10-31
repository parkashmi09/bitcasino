import { Suspense } from 'react'

import ProfitLoss from '@/views/reports/ProfitLoss'

export const metadata = { title: 'Profit & loss' }

export default function Page() {
  return (
    <Suspense>
      <ProfitLoss />
    </Suspense>
  )
}
