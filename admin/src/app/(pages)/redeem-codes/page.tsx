import { Suspense } from 'react'

import View from '@/views/promotions/RedeemCodes'

export const metadata = { title: 'Redeem codes' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
