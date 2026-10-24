import { Suspense } from 'react'

import View from '@/views/casino/WagerReport'

export const metadata = { title: 'Casino wager report' }

export default function Page() {
  return (
    <Suspense>
      <View area='casino' />
    </Suspense>
  )
}
