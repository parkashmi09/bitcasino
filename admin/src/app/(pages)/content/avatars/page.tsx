import { Suspense } from 'react'

import View from '@/views/content/Avatars'

export const metadata = { title: 'Avatars' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
