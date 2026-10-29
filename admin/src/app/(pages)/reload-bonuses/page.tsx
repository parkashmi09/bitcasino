import { Suspense } from 'react'

import View from '@/views/promotions/ReloadRewards'

export const metadata = { title: 'Reload bonuses' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
