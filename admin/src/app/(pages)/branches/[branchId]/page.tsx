import { Suspense } from 'react'

import BranchPage from '@/views/branches/BranchPage'

export const metadata = { title: 'Branch' }

export default async function Page({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params

  return (
    <Suspense>
      <BranchPage branchId={branchId} />
    </Suspense>
  )
}
