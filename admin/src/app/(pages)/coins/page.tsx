import { Suspense } from 'react'

import View from '@/views/finance/Coins'

export const metadata = { title: 'Coins' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
