import { Suspense } from 'react'

import View from '@/views/promotions/VipClub'

export const metadata = { title: 'VIP Club' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
