import { Suspense } from 'react'

import AuditLog from '@/views/audit/AuditLog'

export const metadata = { title: 'Activity log' }

export default function Page() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  )
}
