import 'server-only'

import { serverConfig } from '@/configs/site'
import type { SiteMethod } from './types'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

type Answer = { methods: SiteMethod[]; source: 'site' | 'unavailable'; reason?: string }

/**
 * Every payment method the site has (its seeded rows, the Super Admin's and the owner's):
 * `GET <SITE_GATEWAY_URL>/api/v1/admin/site-config/payment-methods/owner` with `x-owner-key`. Only
 * https, or http to this host (the key travels in the header). Unreachable → none, with the reason.
 */
export async function siteMethods(): Promise<Answer> {
  const base = serverConfig.gatewayUrl.replace(/\/$/, '')

  if (!base || !serverConfig.sharedSecret) return { methods: [], source: 'unavailable', reason: 'SITE_GATEWAY_URL / OWNER_SHARED_SECRET not set' }

  try {
    const { protocol, hostname } = new URL(base)

    if (protocol !== 'https:' && !(protocol === 'http:' && LOOPBACK.has(hostname))) {
      return { methods: [], source: 'unavailable', reason: 'SITE_GATEWAY_URL must be https unless it is this host' }
    }

    const res = await fetch(`${base}/api/v1/admin/site-config/payment-methods/owner`, {
      headers: { 'x-owner-key': serverConfig.sharedSecret, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000)
    })

    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: Partial<SiteMethod>[] } | null

    if (!res.ok || !body?.success || !Array.isArray(body.data)) return { methods: [], source: 'unavailable', reason: `the site answered ${res.status}` }

    return {
      source: 'site',
      methods: body.data
        .filter(m => typeof m.gateway === 'string' && typeof m.currency === 'string' && typeof m.code === 'string')
        .map(m => ({
          gateway: m.gateway as string,
          currency: m.currency as string,
          code: m.code as string,
          ownerEnabled: m.ownerEnabled !== false,
          siteEnabled: m.siteEnabled !== false,
          addedBy: m.addedBy === 'owner' ? 'owner' : 'site'
        }))
    }
  } catch (error) {
    return { methods: [], source: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
}
