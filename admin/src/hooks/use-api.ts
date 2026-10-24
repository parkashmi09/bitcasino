'use client'

import { useCallback, useMemo } from 'react'

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { toast } from 'sonner'

import { api } from '@/lib/api/client'
import type { Paged, Query } from '@/lib/api/types'
import { notifyError } from '@/lib/notify'

/** GET a single resource. `path` is a gateway path (`admin/dashboard`). */
export function useApi<T>(path: string | null, query?: Query, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: ['api', path, query ?? null],
    queryFn: ({ signal }) => api.get<T>(path as string, query, signal),
    enabled: path !== null && (options?.enabled ?? true),
    ...options
  })
}

/** GET a list route with the platform's `meta.pagination`. */
export function usePagedApi<T>(path: string | null, query?: Query, options?: Partial<UseQueryOptions<Paged<T>>>) {
  return useQuery<Paged<T>>({
    queryKey: ['paged', path, query ?? null],
    queryFn: ({ signal }) => api.paged<T>(path as string, query, signal),
    enabled: path !== null && (options?.enabled ?? true),
    placeholderData: prev => prev,
    ...options
  })
}

/**
 * Page, limit, search and sort kept in the URL so a list survives reload and
 * a link to "page 3 filtered by X" is shareable. Extra filter keys are
 * declared by the caller.
 */
export function useListState(extraKeys: string[] = [], defaults: Record<string, string> = {}) {
  // Callers pass fresh array/object literals every render: memoise on their content.
  const keyList = extraKeys.join('|')
  const defaultsKey = JSON.stringify(defaults)

  const parsers = useMemo(() => {
    const dflt = JSON.parse(defaultsKey) as Record<string, string>

    const p: Record<string, ReturnType<typeof parseAsString.withDefault> | ReturnType<typeof parseAsInteger.withDefault>> = {
      page: parseAsInteger.withDefault(1),
      limit: parseAsInteger.withDefault(20),
      search: parseAsString.withDefault(''),
      sort: parseAsString.withDefault(dflt.sort ?? ''),
      order: parseAsString.withDefault(dflt.order ?? '')
    }

    for (const key of keyList ? keyList.split('|') : []) p[key] = parseAsString.withDefault(dflt[key] ?? '')

    return p
  }, [keyList, defaultsKey])

  const [state, setState] = useQueryStates(parsers, { history: 'replace' })

  const set = useCallback(
    (patch: Record<string, string | number | null>) => {
      // Any filter change goes back to page 1 unless the page itself changed.
      const next: Record<string, string | number | null> = { ...patch }

      if (!('page' in patch)) next.page = 1
      void setState(next as never)
    },
    [setState]
  )

  const query: Query = useMemo(() => {
    const q: Query = {}

    for (const [k, v] of Object.entries(state)) if (v !== '' && v !== null && v !== undefined) q[k] = v as string | number

    return q
  }, [state])

  return { state: state as Record<string, string | number>, set, query }
}

type MutationSpec<TVars, TResult> = {
  fn: (vars: TVars) => Promise<TResult>

  /** Query-key prefixes to refetch on success (`['paged', 'admin/reports/players']`). */
  invalidate?: (string | null)[][]
  success?: string | ((result: TResult, vars: TVars) => string)
  onSuccess?: (result: TResult, vars: TVars) => void
}

/** A write with toast feedback and cache invalidation baked in. */
export function useApiMutation<TVars = void, TResult = unknown>(spec: MutationSpec<TVars, TResult>) {
  const qc = useQueryClient()

  return useMutation<TResult, Error, TVars>({
    mutationFn: spec.fn,
    onSuccess: (result, vars) => {
      for (const key of spec.invalidate ?? []) void qc.invalidateQueries({ queryKey: key })
      if (spec.success) toast.success(typeof spec.success === 'function' ? spec.success(result, vars) : spec.success)
      spec.onSuccess?.(result, vars)
    },
    onError: error => notifyError(error)
  })
}

export function useInvalidate() {
  const qc = useQueryClient()

  return useCallback((...prefixes: (string | null)[][]) => prefixes.forEach(k => qc.invalidateQueries({ queryKey: k })), [qc])
}
