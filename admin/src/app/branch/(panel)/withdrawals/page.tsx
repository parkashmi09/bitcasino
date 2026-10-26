import { Suspense } from 'react'

import { PanelMoney } from '@/views/branches/BranchPanelPages'

export const metadata = { title: 'Withdrawals' }

export default function Page() {
  return (
    <Suspense>
      <PanelMoney kind='withdrawals' />
    </Suspense>
  )
}
