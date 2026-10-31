import { Suspense } from 'react'

import KycQueue from '@/views/kyc/KycQueue'

export const metadata = { title: 'KYC' }

export default function Page() {
  return (
    <Suspense>
      <KycQueue />
    </Suspense>
  )
}
