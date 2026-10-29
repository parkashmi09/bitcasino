import { Suspense } from 'react'

import View from '@/views/promotions/Challenges'

export const metadata = { title: 'Challenges' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
