import { Suspense } from 'react'

import { PanelPlayer } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Player' }

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params

  return (
    <Suspense>
      <PanelPlayer userId={userId} />
    </Suspense>
  )
}
