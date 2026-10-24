import { Suspense } from 'react'

import View from '@/views/casino/Curation'

export const metadata = { title: 'Curation' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
