import { Suspense } from 'react'

import MarketAnalysis from '@/views/exchange/market/MarketAnalysis'

export const metadata = { title: 'Market Analysis' }

export default function Page() {
  return (
    <Suspense>
      <MarketAnalysis />
    </Suspense>
  )
}
