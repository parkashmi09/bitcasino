import { Suspense } from 'react'

import View from '@/views/promotions/VipClub'

export const metadata = { title: 'VIP & club' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
