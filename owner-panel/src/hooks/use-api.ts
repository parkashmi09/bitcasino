'use client'

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api/client'
import { toastError } from '@/lib/api/feedback'
import type { Query } from '@/lib/api/types'

export function useApi<T>(path: string | null, query?: Query, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: ['api', path, query ?? null],
    queryFn: ({ signal }) => api.get<T>(path as string, query, signal),
    enabled: path !== null && (options?.enabled ?? true),
    ...options
  })
}

type Spec<TVars, TResult> = {
  fn: (vars: TVars) => Promise<TResult>
  invalidate?: (string | null)[][]
  success?: string | ((r: TResult, v: TVars) => string)
  onSuccess?: (r: TResult, v: TVars) => void

  /** The error toast's title (its text is the server's message); none = the message alone. */
  errorTitle?: string
}

export function useApiMutation<TVars = void, TResult = unknown>(spec: Spec<TVars, TResult>) {
  const qc = useQueryClient()

  return useMutation<TResult, Error, TVars>({
    mutationFn: spec.fn,
    onSuccess: (r, v) => {
      for (const key of spec.invalidate ?? []) void qc.invalidateQueries({ queryKey: key })
      if (spec.success) toast.success(typeof spec.success === 'function' ? spec.success(r, v) : spec.success)
      spec.onSuccess?.(r, v)
    },
    onError: e => toastError(e, spec.errorTitle)
  })
}
