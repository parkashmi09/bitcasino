import type { NextRequest } from 'next/server'

import { serverConfig } from '@/configs/site'
import { writeSessionToken } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * Keeps a branch token in its own httpOnly cookie (the branch panel, /branch). The browser signs in
 * through the gateway proxy (`admin/branches/portal/login`) and hands the token here; it is stored
 * only after the platform accepts it as a branch session, so this cannot plant an arbitrary cookie.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown }
  const token = typeof body.token === 'string' ? body.token : ''

  if (!token) return Response.json({ success: false, error: { code: 'TOKEN_REQUIRED', message: 'No token' } }, { status: 400 })

  let ok = false

  try {
    const res = await fetch(`${serverConfig.apiUrl}/api/v1/admin/branches/portal/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store'
    })

    ok = res.ok
  } catch {
    return Response.json({ success: false, error: { code: 'GATEWAY_UNREACHABLE', message: `Gateway ${serverConfig.apiUrl} did not answer` } }, { status: 502 })
  }

  if (!ok) return Response.json({ success: false, error: { code: 'BRANCH_UNAUTHENTICATED', message: 'The platform did not accept this token' } }, { status: 401 })

  await writeSessionToken(token, serverConfig.branchCookieName)

  return Response.json({ success: true, data: {} })
}
