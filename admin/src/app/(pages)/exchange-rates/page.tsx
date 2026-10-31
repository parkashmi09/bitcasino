import { Suspense } from 'react'

import View from '@/views/finance/ExchangeRates'

export const metadata = { title: 'Exchange rates' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
