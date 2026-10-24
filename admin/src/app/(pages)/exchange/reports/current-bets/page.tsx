import { Suspense } from 'react'

import CurrentBets from '@/views/exchange/market/CurrentBets'

export const metadata = { title: 'Current Bets' }

export default function Page() {
  return (
    <Suspense>
      <CurrentBets />
    </Suspense>
  )
}
