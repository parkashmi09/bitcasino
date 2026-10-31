import { Suspense } from 'react'

import BranchesList from '@/views/branches/BranchesList'

export const metadata = { title: 'Branches' }

export default function Page() {
  return (
    <Suspense>
      <BranchesList />
    </Suspense>
  )
}
