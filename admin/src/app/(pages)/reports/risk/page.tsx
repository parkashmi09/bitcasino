import { Suspense } from 'react'

import RiskReview from '@/views/reports/RiskReview'

export const metadata = { title: 'Risk review' }

export default function Page() {
  return (
    <Suspense>
      <RiskReview />
    </Suspense>
  )
}
