import { serverConfig } from '@/configs/site'
import { decodeToken, readSessionToken } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** Staff levels 4–6 (SUPER_MASTER, MASTER, AGENT) — the agent tree under the operator. */
const isAgentTreeLevel = (level: number) => level >= 4 && level <= 6

/**
 * Who is signed in. The token's claims plus the platform's CURRENT permission
 * resolution, so a demoted role is reflected without a re-login.
 */
export async function GET() {
  const token = await readSessionToken()

  if (!token) return Response.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 })

  const claims = decodeToken(token)!

  let permissions = claims.permissions ?? []
  let live: Record<string, unknown> = {}

  try {
    const res = await fetch(`${serverConfig.apiUrl}/api/v1/admin/access/me/permissions`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store'
    })

    if (res.status === 401) {
      return Response.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Session expired' } }, { status: 401 })
    }

    const json = (await res.json()) as { success: boolean; data?: { permissions?: string[] } & Record<string, unknown> }

    if (json.success && json.data) {
      live = json.data
      if (Array.isArray(json.data.permissions)) permissions = json.data.permissions
    }
  } catch {
    // Gateway down: fall back to the token's claims so the shell still renders.
  }

  // The marketing panel is gated on the executive's `kind` (re-read from the DB by the
  // backend's protectMarketing), which no token claim or permission carries. Only an
  // executive sub-login can be one, so probe the panel's own `me` for those alone.
  let marketing = false
  const executiveId = claims.executiveId ?? (live.executiveId as number | null | undefined) ?? null

  if (executiveId) {
    try {
      const res = await fetch(`${serverConfig.apiUrl}/api/v1/admin/marketing/me`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store'
      })

      marketing = res.ok
    } catch {
      // Unknown — leave the panel hidden; the backend refuses it anyway.
    }
  }

  // Promotions (bonus, codes, gift cards, wheel, VIP & club, affiliate, races, rakeback) are an
  // operator matter: agent-tree logins — SUPER_MASTER (4), MASTER (5), AGENT (6), and any
  // executive of one, whose token already carries the PARENT's level — see none of it. A backend
  // that sends its own `promotions` / `capabilities.promotions` can only narrow this further.
  const level = Number((live.level as number | null | undefined) ?? claims.level)
  const capabilities = (live.capabilities ?? null) as { promotions?: unknown } | null
  const backendPromotions = typeof live.promotions === 'boolean' ? live.promotions : capabilities?.promotions

  const promotions = !isAgentTreeLevel(level) && backendPromotions !== false

  // Direct users (no parent staff) are the Super Admin's alone (level 1, legacy owner 0) and its executives' —
  // `effectiveLevel` is the parent's level for an executive. Admin, Sub Admin and the agent tree see none.
  const effectiveLevel = Number((live.effectiveLevel as number | null | undefined) ?? level)
  const direct = Number.isFinite(effectiveLevel) && effectiveLevel <= 1

  return Response.json({
    success: true,
    data: {
      staffId: Number(claims.sub),
      roleId: claims.roleId,
      roleName: claims.roleName,
      level: claims.level,
      executiveId: claims.executiveId ?? null,
      permissions,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      ...live,
      marketing,
      promotions,
      direct
    }
  })
}
