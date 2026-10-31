import { Suspense } from 'react'

import View from '@/views/promotions/SpinWheel'

export const metadata = { title: 'Spin wheel' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
