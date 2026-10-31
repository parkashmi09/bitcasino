import { Suspense } from 'react'

import View from '@/views/settings/PaymentMethods'

export const metadata = { title: 'Payment Methods' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
