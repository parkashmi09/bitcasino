'use client'

import { useQuery } from '@tanstack/react-query'

import { request } from '@/lib/api/client'
import type { Paged, Query } from '@/lib/api/types'

/**
 * A list route that pages by `page`/`limit` (bet-history, gis, games) rather
 * than `limit`/`offset`. `api.paged` translates page → offset, which these
 * strict validators reject with a 422, so the page number goes through as-is.
 */
export function usePageList<T>(path: string | null, query: Query = {}) {
  return useQuery<Paged<T>>({
    queryKey: ['paged', path, query],
    enabled: path !== null,
    placeholderData: prev => prev,
    queryFn: async ({ signal }) => {
      const page = Math.max(Number(query.page ?? 1), 1)
      const limit = Number(query.limit ?? 20)
      const { data, meta } = await request<T[]>(path as string, { query: { ...query, page, limit }, signal })
      const pagination = (meta?.pagination as Paged<T>['pagination']) ?? { page, limit, total: Array.isArray(data) ? data.length : 0, totalPages: 1, hasNext: false, hasPrev: false }

      return { rows: Array.isArray(data) ? data : [], pagination }
    }
  })
}
