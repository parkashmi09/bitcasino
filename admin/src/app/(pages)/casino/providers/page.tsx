import { Suspense } from 'react'

import View from '@/views/casino/Providers'

export const metadata = { title: 'Providers' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
