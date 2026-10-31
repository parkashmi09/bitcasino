import { Suspense } from 'react'

import View from '@/views/settings/TypePriority'

export const metadata = { title: 'Type Priority' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
