import { Suspense } from 'react'

import { PanelUsers } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Users' }

export default function Page() {
  return (
    <Suspense>
      <PanelUsers />
    </Suspense>
  )
}
