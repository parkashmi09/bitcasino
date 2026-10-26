import { Suspense } from 'react'

import { BranchPlayerPage } from '@/views/branches/BranchPage'

export const metadata = { title: 'Branch player' }

export default async function Page({ params }: { params: Promise<{ branchId: string; userId: string }> }) {
  const { branchId, userId } = await params

  return (
    <Suspense>
      <BranchPlayerPage branchId={branchId} userId={userId} />
    </Suspense>
  )
}
