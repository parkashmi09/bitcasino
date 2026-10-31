import { Suspense } from 'react'

import View from '@/views/finance/SwapHistory'

export const metadata = { title: 'Swap history' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
