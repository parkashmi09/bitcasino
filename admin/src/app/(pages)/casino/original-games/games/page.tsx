import { Suspense } from 'react'

import View from '@/views/casino/OriginalGames'

export const metadata = { title: 'Original Games · Games' }

export default function Page() {
  return (
    <Suspense>
      <View section='games' />
    </Suspense>
  )
}
