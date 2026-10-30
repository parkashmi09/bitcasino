import { Suspense } from 'react'

import WhitelabelsList from '@/views/whitelabels/WhitelabelsList'

export const metadata = { title: 'Whitelabels' }

export default function Page() {
  return (
    <Suspense>
      <WhitelabelsList />
    </Suspense>
  )
}
