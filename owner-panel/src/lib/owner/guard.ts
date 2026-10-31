import 'server-only'

import { isSignedIn } from '@/lib/auth/session'

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const ok = (data: unknown, meta?: Record<string, unknown>) => Response.json({ success: true, data, ...(meta ? { meta } : {}) })

/** Wrap a route handler: enforce the session, shape errors as the platform envelope. */
export function handler<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    if (!(await isSignedIn())) return Response.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 })

    try {
      return await fn(...args)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const code = error instanceof HttpError ? error.code : 'OWNER_ERROR'

      return Response.json({ success: false, error: { code, message: error instanceof Error ? error.message : String(error) } }, { status })
    }
  }
}
