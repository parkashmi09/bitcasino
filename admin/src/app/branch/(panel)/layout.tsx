import type { ReactNode } from 'react'

import BranchPanel from '@/views/branches/BranchPanel'

export default function Layout({ children }: { children: ReactNode }) {
  return <BranchPanel>{children}</BranchPanel>
}
