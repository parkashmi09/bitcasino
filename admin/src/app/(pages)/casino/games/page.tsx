import { Suspense } from 'react'

import View from '@/views/casino/GameCatalogue'

export const metadata = { title: 'Game catalogue' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
