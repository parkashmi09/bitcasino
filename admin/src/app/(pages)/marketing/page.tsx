import { Suspense } from 'react'

import MarketingAnalytics from '@/views/marketing/MarketingAnalytics'

export const metadata = { title: 'Marketing' }

export default function Page() {
  return (
    <Suspense>
      <MarketingAnalytics />
    </Suspense>
  )
}
