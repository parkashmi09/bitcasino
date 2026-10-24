import { clearSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  await clearSession()

  return Response.json({ success: true, data: { signedOut: true } })
}
