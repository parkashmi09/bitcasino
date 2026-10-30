/**
 * The gateway proxy.
 *
 * Every browser call goes `/api/gw/<gateway path>` → `${API_URL}/<gateway path>`
 * with the staff token added from the httpOnly session cookie. The browser
 * never holds the token, there is no CORS to configure per site, and binary
 * routes (banner images, CSV/PDF exports, multipart uploads) stream through
 * untouched.
 */
import type { NextRequest } from 'next/server'

import { serverConfig } from '@/configs/site'
import { readSessionToken } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'host',
  'cookie',
  'authorization',

  // Server-to-server call: the browser's origin (localhost, a bare IP) must not trip the gateway's CORS list.
  'origin'
])

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const target = `${serverConfig.apiUrl}/${path.join('/')}${req.nextUrl.search}`

  // The branch panel's calls carry the branch cookie, every other call the staff one.
  const token = await readSessionToken(path.slice(0, 5).join('/') === 'api/v1/admin/branches/portal' ? serverConfig.branchCookieName : undefined)

  const headers = new Headers()

  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value)
  })
  if (token) headers.set('authorization', `Bearer ${token}`)
  headers.set('x-forwarded-for', req.headers.get('x-forwarded-for') ?? '127.0.0.1')

  const hasBody = !['GET', 'HEAD'].includes(req.method)

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
    cache: 'no-store'
  }

  if (hasBody && req.method === 'DELETE') {
    // A DELETE body must go with a Content-Length. Streamed (chunked), the gateway's
    // http.request does not chunk-encode a DELETE, so the upstream never sees the body
    // and answers 400 — e.g. the sports config "reset to Inherit" routes.
    const buf = await req.arrayBuffer()

    if (buf.byteLength) init.body = buf
  } else if (hasBody) {
    init.body = req.body
    init.duplex = 'half'
  }

  let upstream: Response

  try {
    upstream = await fetch(target, init)
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'GATEWAY_UNREACHABLE',
          message: `The platform gateway at ${serverConfig.apiUrl} did not answer`,
          details: { cause: error instanceof Error ? error.message : String(error) }
        }
      },
      { status: 502 }
    )
  }

  const outHeaders = new Headers()

  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders.set(key, value)
  })

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders })
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE }
