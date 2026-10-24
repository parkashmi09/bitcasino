import { Suspense } from 'react'

import View from '@/views/casino/OriginalGames'

export const metadata = { title: 'Original Games · Bet history' }

export default function Page() {
  return (
    <Suspense>
      <View section='bets' />
    </Suspense>
  )
}
