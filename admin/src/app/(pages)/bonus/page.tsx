import { Suspense } from 'react'

import View from '@/views/promotions/BonusAdmin'

export const metadata = { title: 'Bonus' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
