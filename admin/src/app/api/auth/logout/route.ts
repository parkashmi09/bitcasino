import { serverConfig } from '@/configs/site'
import { clearSessionToken, readSessionToken } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const token = await readSessionToken()

  if (token) {
    // Best effort: the platform invalidates the jti. The cookie is cleared either way.
    await fetch(`${serverConfig.apiUrl}/api/v1/admin/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store'
    }).catch(() => undefined)
  }

  await clearSessionToken()

  return Response.json({ success: true, data: { signedOut: true } })
}
