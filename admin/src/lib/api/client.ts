import type { Envelope, Paged, Query } from './types'

/**
 * The one HTTP seam. Every call goes through the same-origin proxy at
 * `/api/gw/…`, which adds the staff token. Paths are GATEWAY paths — pass
 * `admin/staff`, not `/api/v1/admin/staff`; `API_V1` is prefixed here.
 */
export const API_V1 = '/api/gw/api/v1'

export class ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** `STAFF_AUTH_TWO_FACTOR_REQUIRED` → is('TWO_FACTOR_REQUIRED') */
  is(suffix: string) {
    return this.code === suffix || this.code.endsWith('_' + suffix)
  }
}

export function buildQuery(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  const s = params.toString()

  return s ? `?${s}` : ''
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Query
  body?: unknown

  /** Send a FormData body untouched (uploads). */
  form?: FormData
  signal?: AbortSignal

  /** Where the path is already absolute (e.g. `/api/auth/login`). */
  raw?: boolean
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const url = (opts.raw ? path : `${API_V1}/${path.replace(/^\/+/, '')}`) + buildQuery(opts.query)
  const headers: Record<string, string> = { accept: 'application/json' }
  let body: BodyInit | undefined

  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: opts.signal, cache: 'no-store' })
  const text = await res.text()
  let json: Envelope<T> | null = null

  try {
    json = text ? (JSON.parse(text) as Envelope<T>) : null
  } catch {
    json = null
  }

  if (!json) {
    if (res.ok) return { data: undefined as T }
    throw new ApiError(res.status, 'BAD_RESPONSE', text.slice(0, 200) || res.statusText)
  }


  // A few platform routes answer with a bare body (no `{ success, data }` envelope), e.g.
  // `admin/user/wallet/:id/history` → `{ history, count }`. An OK response like that IS the data.
  const isEnvelope = typeof json === 'object' && !Array.isArray(json) && typeof (json as { success?: unknown }).success === 'boolean'

  if (!isEnvelope) {
    if (res.ok) return { data: json as unknown as T }
    const bare = json as { code?: unknown; message?: unknown; error?: unknown }
    const message = typeof bare.message === 'string' ? bare.message : typeof bare.error === 'string' ? bare.error : res.statusText || 'Request failed'

    throw new ApiError(res.status, typeof bare.code === 'string' ? bare.code : `HTTP_${res.status}`, message)
  }

  if (!json.success) {
    // Some error bodies carry `success: false` without an `error` block.
    // The sports service (mssports port) answers `{ success: false, error: '<text>' }` or
    // `{ success: false, message: '<text>' }` — keep that text instead of "Request failed".
    const failed = json as { error?: unknown; message?: unknown }

    const error: { code?: string; message?: string; details?: Record<string, unknown> } =
      failed.error && typeof failed.error === 'object'
        ? (failed.error as typeof error)
        : { message: typeof failed.error === 'string' ? failed.error : typeof failed.message === 'string' ? failed.message : undefined }

    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login') && error.code === 'UNAUTHENTICATED') {
      location.assign(`/login?next=${encodeURIComponent(location.pathname)}`)
    }

    // A password somebody else chose (new account, or reset by a superior): the platform refuses
    // every admin API but "who am I", change-password and logout until it is replaced.
    if (
      res.status === 403 &&
      typeof window !== 'undefined' &&
      (error.code === 'PASSWORD_CHANGE_REQUIRED' || error.code?.endsWith('_PASSWORD_CHANGE_REQUIRED')) &&
      !location.pathname.startsWith('/change-password') &&
      !location.pathname.startsWith('/login')
    ) {
      location.assign('/change-password')
    }

    throw new ApiError(res.status, typeof error.code === 'string' ? error.code : `HTTP_${res.status}`, typeof error.message === 'string' && error.message ? error.message : 'Request failed', error.details)
  }

  return { data: json.data, meta: json.meta }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }).then(r => r.data),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>(path, { method: 'POST', body: body ?? {}, query }).then(r => r.data),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }).then(r => r.data),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }).then(r => r.data),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }).then(r => r.data),
  upload: <T>(path: string, form: FormData, method: 'POST' | 'PUT' | 'PATCH' = 'POST') => request<T>(path, { method, form }).then(r => r.data),

  /** A list route: rows plus the pagination block from `meta`. */
  /**
   * A list route: rows plus the pagination block from `meta`.
   * The platform pages by `limit`/`offset`; callers think in `page`, so `page`
   * is translated here and never sent (validators are `.strict()`).
   */
  paged: async <T>(path: string, query?: Query, signal?: AbortSignal): Promise<Paged<T>> => {
    const { page: rawPage, ...rest } = query ?? {}
    const limit = Number(rest.limit ?? 20)
    const page = Math.max(Number(rawPage ?? 1), 1)
    const sent: Query = { ...rest, limit, offset: (page - 1) * limit }
    const { data, meta } = await request<T[] | Record<string, unknown>>(path, { query: sent, signal })

    // Envelope routes send the rows as `data`. A few legacy routes send a bare
    // `{ <rows>: [...], count }` body instead (e.g. wallet history → `{ history, count }`).
    let rows: T[] = []
    let total: number | undefined

    if (Array.isArray(data)) {
      rows = data
    } else if (data && typeof data === 'object') {
      const list = Object.values(data).find(Array.isArray)

      rows = (list as T[] | undefined) ?? []
      total = typeof data.count === 'number' ? data.count : typeof data.total === 'number' ? data.total : undefined
    }

    const known = total ?? (meta?.pagination ? undefined : rows.length)
    const totalPages = known === undefined ? 1 : Math.max(Math.ceil(known / limit), 1)

    const pagination = (meta?.pagination as Paged<T>['pagination']) ?? {
      page,
      limit,
      total: known ?? rows.length,
      totalPages: total === undefined ? 1 : totalPages,
      hasNext: total === undefined ? false : page < totalPages,
      hasPrev: total === undefined ? false : page > 1
    }

    return { rows, pagination, meta }
  },

  /** Binary routes (CSV, PDF, images) — returns the Blob. */
  blob: async (path: string, query?: Query) => {
    const res = await fetch(`${API_V1}/${path.replace(/^\/+/, '')}${buildQuery(query)}`, { cache: 'no-store' })

    if (!res.ok) {
      // The failure body is the usual JSON envelope — surface its message, not just "404 Not Found".
      let code = 'DOWNLOAD_FAILED'
      let message = `Download failed (${res.status} ${res.statusText})`

      try {
        const json = (await res.json()) as { error?: { code?: unknown; message?: unknown } | string; message?: unknown }
        const err = json?.error

        if (err && typeof err === 'object') {
          if (typeof err.code === 'string') code = err.code
          if (typeof err.message === 'string' && err.message) message = err.message
        } else if (typeof err === 'string' && err) message = err
        else if (typeof json?.message === 'string' && json.message) message = json.message
      } catch {
        // not JSON — keep the status line
      }

      throw new ApiError(res.status, code, message)
    }

    return res.blob()
  },

  /** The URL a browser can load directly (images in <img>). */
  url: (path: string, query?: Query) => `${API_V1}/${path.replace(/^\/+/, '')}${buildQuery(query)}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // The owner panel has not put this in the site's plan — say so plainly, whatever the backend's wording.
    if (error.is('NOT_ENTITLED')) {
      const key = typeof error.details?.key === 'string' ? ` “${error.details.key}”` : ''
      const kind = error.details?.kind === 'flag' ? 'flag' : error.details?.kind === 'currency' ? 'coin' : 'feature'

      return `Not in your plan: the ${kind}${key} is not enabled for this site. Contact the platform to add it.`
    }

    // Variants, switches and the template are set from the owner panel only.
    if (error.is('OWNER_MANAGED') || error.is('TEMPLATE_OWNER_ONLY')) {
      return 'Features are managed by the platform. Contact support to change them.'
    }

    // 422 from the platform's `validate()` middleware: `details.fields = [{ field, message }]`
    // (older routes: `issues`/`errors` with `path`). Show what was wrong, not just "Validation failed".
    const details = error.details?.fields ?? error.details?.issues ?? error.details?.errors

    if (Array.isArray(details) && details.length) {
      const parts = (details as { field?: unknown; path?: unknown; message?: unknown }[])
        .map(d => {
          const raw = typeof d.field === 'string' ? d.field : Array.isArray(d.path) ? d.path.join('.') : typeof d.path === 'string' ? d.path : ''
          const field = raw.replace(/^(body|query|params)\./, '')
          const message = typeof d.message === 'string' ? d.message : ''

          if (!message) return field
          if (!field || message.toLowerCase().includes(field.toLowerCase())) return message

          return `${field}: ${message}`
        })
        .filter(Boolean)

      if (parts.length) return Array.from(new Set(parts)).slice(0, 4).join('; ')
    }

    if (error.status === 403 && (!error.message || error.message === 'Request failed')) return 'You do not have permission to do this.'
    if (error.status === 429) return error.message && error.message !== 'Request failed' ? error.message : 'Too many requests — wait a moment and try again.'
    if (error.status >= 500 && (!error.message || error.message === 'Request failed')) return 'Server error — please try again.'

    return readable(error.message, 'Request failed')
  }

  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return 'Network error — check your connection and try again.'
  if (error instanceof Error) return readable(error.message, 'Something went wrong')

  return readable(error, 'Something went wrong')
}

/** Never show `[object Object]` or an empty toast. */
function readable(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value.trim() && value !== '[object Object]' ? value : fallback

  if (value && typeof value === 'object') {
    const m = (value as { message?: unknown }).message

    if (typeof m === 'string' && m.trim()) return m
  }

  return fallback
}
