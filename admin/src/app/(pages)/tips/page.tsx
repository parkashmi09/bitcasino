import { Suspense } from 'react'

import View from '@/views/finance/Tips'

export const metadata = { title: 'Tips' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
