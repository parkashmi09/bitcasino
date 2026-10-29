import { Suspense } from 'react'

import View from '@/views/promotions/Raffle'

export const metadata = { title: 'Raffle' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
