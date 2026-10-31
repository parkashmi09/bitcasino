import { Suspense } from 'react'

import View from '@/views/promotions/GiftCards'

export const metadata = { title: 'Gift cards' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
