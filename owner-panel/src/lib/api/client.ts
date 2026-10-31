import { BASE_PATH, withBase } from '../basePath'
import type { Envelope, Query } from './types'

/** Owner panel HTTP seam: same-origin `/api/owner/...` route handlers. */
export class ApiError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function buildQuery(query?: Query) {
  if (!query) return ''
  const p = new URLSearchParams()

  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()

  return s ? `?${s}` : ''
}

/** `fetch` of a same-origin path (the mount point added), with a dropped connection turned into an ApiError the toasts can name. */
export async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(withBase(input), init)
  } catch (error) {
    // The caller's own abort (a query unmounting) stays an AbortError.
    if (error instanceof DOMException && error.name === 'AbortError' && init.signal?.aborted) throw error

    throw new ApiError(0, 'NETWORK', 'Could not reach the owner panel — check the connection and that the panel is running')
  }
}

/** The `{ success, data | error }` envelope of a response, or an ApiError. */
export async function readEnvelope<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as Envelope<T> | null

  if (!json) throw new ApiError(res.status, 'BAD_RESPONSE', `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''} without a readable reply`)

  if (!json.success) {
    // Only the panel's own session check sends to /login; a 401 forwarded from the site backend (bad owner key) is an error to show.
    if (res.status === 401 && json.error?.code === 'UNAUTHENTICATED' && typeof window !== 'undefined' && !location.pathname.startsWith(`${BASE_PATH}/login`))
      location.assign(withBase(`/login?expired=1&next=${encodeURIComponent(location.pathname.slice(BASE_PATH.length) || '/')}`))
    throw new ApiError(res.status, json.error.code, json.error.message)
  }

  return json.data
}

export async function request<T>(path: string, opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  const res = await send(path + buildQuery(opts.query), {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: 'no-store'
  })

  return readEnvelope<T>(res)
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
}

/** A failure on the panel's server side that is really the site backend not answering. */
const UNREACHABLE = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|timed? ?out|aborted due to timeout|unreachable/i

/**
 * What to tell the owner about a failure: the server's own message, with the known codes put in
 * plain words. Used by every toast and every inline error.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.name === 'TimeoutError') return 'The request timed out — could not reach the site backend in time. Try again.'
  if (!(error instanceof ApiError)) return error.message || 'Something went wrong'

  const msg = error.message

  switch (error.code) {
    case 'NETWORK':
      return msg
    case 'TOO_MANY_ATTEMPTS':
      return msg || 'Too many failed sign-ins. Wait a little and try again.'
    case 'INVALID_CREDENTIALS':
      return 'Wrong username or password.'
    case 'UNAUTHENTICATED':
      return 'Your session has ended — sign in again.'
    case 'NOT_CONFIGURED':
      return `Not set up on this panel: ${msg}`
    case 'VERSION_CONFLICT':
      return `Someone saved in the meantime. ${msg}`
    case 'VALIDATION_ERROR':
      return `Not saved — ${msg}`
    case 'COIN_DELETE_REFUSED':
      return msg
    case 'BRANDING_FILE_MISSING':
      return `An image in this save is not stored on the panel (${msg}). Upload it again, then save.`
    case 'BRANDING_TOO_LARGE':
      return `Image too large: ${msg}`
    case 'BRANDING_TOO_SMALL':
    case 'BRANDING_NOT_AN_IMAGE':
    case 'BRANDING_FORMAT_REFUSED':
    case 'BRANDING_UNSAFE_SVG':
    case 'BRANDING_BAD_SHAPE':
    case 'BRANDING_NO_FILE':
      return `Image refused: ${msg}`
    case 'SITE_UNREACHABLE':
      return `Could not reach the site backend (${msg}).`
    case 'NOT_FOUND':
      return msg || 'Not found'
    case 'BAD_RESPONSE':
      return error.status >= 500 ? `The panel's server failed (${error.status}). Try again; if it repeats, check the panel's log.` : msg
  }

  if (UNREACHABLE.test(msg)) return `Could not reach the site backend (${msg}).`

  return msg || `Request failed (${error.status})`
}
