import { Suspense } from 'react'

import View from '@/views/finance/Vault'

export const metadata = { title: 'Vault' }

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  )
}
