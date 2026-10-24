import type { NextRequest } from 'next/server'

import { serverConfig } from '@/configs/site'
import { writeSession } from '@/lib/auth/session'
import { loginFailed, loginSucceeded, loginWait } from '@/lib/auth/throttle'
import { safeEqual } from '@/lib/auth/token'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { ownerUsername, ownerPassword, sessionSecret } = serverConfig

  if (!ownerUsername || !ownerPassword || !sessionSecret) {
    return Response.json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Owner login is not set in .env.local' } }, { status: 503 })
  }

  // Per client and global throttling; see lib/auth/throttle.ts.
  const client = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'direct'
  const wait = loginWait(client)

  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000)

    return Response.json(
      { success: false, error: { code: 'TOO_MANY_ATTEMPTS', message: `Too many failed sign-ins. Try again in ${seconds} s.` } },
      { status: 429, headers: { 'retry-after': String(seconds) } }
    )
  }

  const { username, password } = (await req.json().catch(() => ({}))) as { username?: string; password?: string }

  // Compare both, always — no early exit that tells a wrong username from a wrong password.
  const userOk = safeEqual(String(username ?? ''), ownerUsername)
  const passOk = safeEqual(String(password ?? ''), ownerPassword)

  if (!userOk || !passOk) {
    loginFailed(client)

    // A fixed pause on every failure: guessing costs time even inside the free attempts.
    await new Promise(resolve => setTimeout(resolve, 750))

    return Response.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Wrong username or password' } }, { status: 401 })
  }

  loginSucceeded(client)
  await writeSession()

  return Response.json({ success: true, data: { signedIn: true } })
}
