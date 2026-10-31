'use client'

import type { ReactNode } from 'react'

import { useSession } from '@/contexts/SessionContext'

/** Renders children only when the current role holds the grant (client-side courtesy; the platform still enforces). */
const Can = ({ permission, children, fallback = null }: { permission: string | string[]; children: ReactNode; fallback?: ReactNode }) => {
  const { can } = useSession()

  return <>{can(permission) ? children : fallback}</>
}

export default Can
