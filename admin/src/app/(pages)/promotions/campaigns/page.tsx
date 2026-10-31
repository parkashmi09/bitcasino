import { Suspense } from 'react'

import View from '@/views/promotions/Promotions'

export const metadata = { title: 'Promotions' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
