import { Suspense } from 'react'

import View from '@/views/casino/BetHistory'

export const metadata = { title: 'Casino bets' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
