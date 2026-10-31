import { Suspense } from 'react'

import View from '@/views/finance/P2P'

export const metadata = { title: 'P2P trading' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
