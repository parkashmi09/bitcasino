'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { request } from '@/lib/api/client'
import { toastError } from '@/lib/api/feedback'
import { withBase } from '@/lib/basePath'

type SessionValue = {
  can: (permission?: string | string[]) => boolean
  flags: Record<string, boolean>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionValue | null>(null)

/** The owner has every permission; this exists so the shared shell components keep one API. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()

  const signOut = useCallback(async () => {
    const pending = toast.loading('Signing out…')

    try {
      await request('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      // The session cookie is still set: say so instead of landing on /login and bouncing back.
      toast.dismiss(pending)
      toastError(error, 'Sign out failed')

      return
    }

    qc.clear()
    location.assign(withBase('/login?signedOut=1'))
  }, [qc])

  const value = useMemo<SessionValue>(() => ({ can: () => true, flags: {}, signOut }), [signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const v = useContext(Ctx)

  if (!v) throw new Error('useSession outside SessionProvider')

  return v
}
