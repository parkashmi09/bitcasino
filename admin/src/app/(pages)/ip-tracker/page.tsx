import { Suspense } from 'react'

import View from '@/views/players/IpTracker'

export const metadata = { title: 'Login & IP history' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
