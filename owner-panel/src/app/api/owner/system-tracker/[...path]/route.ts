import type { NextRequest } from 'next/server'

import { serverConfig } from '@/configs/site'
import { handler, HttpError } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * System Tracker ka data site ke backend se:
 * `<SITE_GATEWAY_URL>/api/v1/admin/owner/system-tracker/<path>` with `x-owner-key`.
 * Key header me jaati hai, isliye sirf https, ya http isi machine pe (siteCoins jaisa).
 */
async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const base = serverConfig.gatewayUrl.replace(/\/$/, '')

  if (!base || !serverConfig.sharedSecret)
    throw new HttpError(503, 'NOT_CONFIGURED', 'SITE_GATEWAY_URL / OWNER_SHARED_SECRET not set')

  const { protocol, hostname } = new URL(base)

  if (protocol !== 'https:' && !(protocol === 'http:' && LOOPBACK.has(hostname))) {
    throw new HttpError(503, 'NOT_CONFIGURED', 'SITE_GATEWAY_URL must be https unless it is this host')
  }

  const { path } = await ctx.params

  if (!path.length || path.length > 3) throw new HttpError(404, 'NOT_FOUND', 'Not found')

  const url = `${base}/api/v1/admin/owner/system-tracker/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`

  const res = await fetch(url, {
    method: req.method,
    headers: {
      'x-owner-key': serverConfig.sharedSecret,
      accept: 'application/json',
      ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {})
    },
    body: req.method === 'POST' ? '{}' : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000) // scan me thoda time lag sakta hai
  })

  // Backend ka envelope ({ success, data } / { success, error }) waisa hi aage
  const body = await res.json().catch(() => null)

  if (!body) throw new HttpError(502, 'SITE_UNREACHABLE', `the site answered ${res.status}`)

  return Response.json(body, { status: res.status })
}

export const GET = handler(forward)
export const POST = handler(forward)
