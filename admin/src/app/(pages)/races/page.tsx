import { Suspense } from 'react'

import View from '@/views/promotions/Races'

export const metadata = { title: 'Races' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
