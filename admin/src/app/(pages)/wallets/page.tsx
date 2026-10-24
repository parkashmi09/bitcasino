import { Suspense } from 'react'

import DirectUserWallet from '@/views/players/DirectUserWallet'

export const metadata = { title: 'Wallets' }

export default function Page() {
  return (
    <Suspense>
      <DirectUserWallet />
    </Suspense>
  )
}
