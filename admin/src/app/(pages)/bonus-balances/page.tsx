import { Suspense } from 'react'

import View from '@/views/promotions/BonusBalances'

export const metadata = { title: 'Bonus balances' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
