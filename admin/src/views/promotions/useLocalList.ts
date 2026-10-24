'use client'

import { useCallback, useState } from 'react'

/**
 * Page/limit kept in component state rather than the URL — for the second and
 * third tables on a screen, where `useListState` would make every table share
 * one `?page=`.
 */
export function useLocalList(initial: { limit?: number } = {}) {
  const [state, setState] = useState<{ page: number; limit: number }>({ page: 1, limit: initial.limit ?? 20 })

  const set = useCallback((patch: { page?: number; limit?: number }) => {
    setState(s => ({ page: 'page' in patch ? (patch.page ?? 1) : 1, limit: patch.limit ?? s.limit }))
  }, [])

  return { page: state.page, limit: state.limit, set }
}
