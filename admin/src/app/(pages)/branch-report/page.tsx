import { Suspense } from 'react'

import BranchReport from '@/views/branches/BranchReport'

export const metadata = { title: 'Branch Report' }

export default function Page() {
  return (
    <Suspense>
      <BranchReport />
    </Suspense>
  )
}
