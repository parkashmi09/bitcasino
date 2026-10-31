import { Suspense } from 'react'

import View from '@/views/promotions/Affiliate'

export const metadata = { title: 'Affiliate' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
