import 'server-only'

import { FLAG_GROUPS } from '@/configs/entitlementCatalogue'
import { serverConfig } from '@/configs/site'
import type { SiteCoin } from './types'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

type Answer = { coins: SiteCoin[]; source: 'site' | 'catalogue'; reason?: string }

/** The coin flag keys of the catalogue (fiat + crypto groups), without the crypto master. */
function catalogueCoins(): SiteCoin[] {
  const groups = FLAG_GROUPS.filter(g => /currenc/i.test(g.title))

  return groups.flatMap(g =>
    g.keys
      .filter(key => key !== 'cryptocoin')
      .map(key => ({
        code: key.toUpperCase(),
        kind: /fiat/i.test(g.title) ? ('fiat' as const) : ('crypto' as const),
        name: key.toUpperCase(),
        symbol: key.toUpperCase(),
        builtin: true,
        retired: false,
        imageUrl: null,
        ownerEnabled: true,
        siteEnabled: null,
        networks: []
      }))
  )
}

/**
 * Every coin the site knows, as it names and shows them:
 * `GET <SITE_GATEWAY_URL>/api/v1/admin/currencies/owner` with `x-owner-key`. Only https, or
 * http to this host (the key travels in the header). Unreachable → the catalogue's coin flags.
 */
export async function siteCoins(): Promise<Answer> {
  const base = serverConfig.gatewayUrl.replace(/\/$/, '')
  const assetBase = serverConfig.publicApiBase.replace(/\/$/, '')

  if (!base || !serverConfig.sharedSecret) return { coins: catalogueCoins(), source: 'catalogue', reason: 'SITE_GATEWAY_URL / OWNER_SHARED_SECRET not set' }

  try {
    const { protocol, hostname } = new URL(base)

    if (protocol !== 'https:' && !(protocol === 'http:' && LOOPBACK.has(hostname))) {
      return { coins: catalogueCoins(), source: 'catalogue', reason: 'SITE_GATEWAY_URL must be https unless it is this host' }
    }

    const res = await fetch(`${base}/api/v1/admin/currencies/owner`, {
      headers: { 'x-owner-key': serverConfig.sharedSecret, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000)
    })

    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: (Omit<SiteCoin, 'imageUrl'> & { image?: string | null })[] } | null

    if (!res.ok || !body?.success || !Array.isArray(body.data)) return { coins: catalogueCoins(), source: 'catalogue', reason: `the site answered ${res.status}` }

    return {
      source: 'site',
      coins: body.data.map(({ image, ...c }) => ({
        ...c,
        siteEnabled: typeof c.siteEnabled === 'boolean' ? c.siteEnabled : null,
        networks: Array.isArray(c.networks) ? c.networks : [],

        // The image route answers with Cross-Origin-Resource-Policy: cross-origin, so the page loads
        // it directly — from the browser-facing origin, not `base`, which may be a loopback address.
        imageUrl: typeof image === 'string' && image.startsWith('/') ? `${assetBase}${image}` : null
      }))
    }
  } catch (error) {
    return { coins: catalogueCoins(), source: 'catalogue', reason: error instanceof Error ? error.message : String(error) }
  }
}
