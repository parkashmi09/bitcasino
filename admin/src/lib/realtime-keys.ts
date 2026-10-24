/**
 * Which admin reads a realtime push makes stale.
 *
 * The pushes are the player site's (user-service `POST /internal/user/preferences/site-config`,
 * fed by admin-service `siteConfig.pushPublic`): every save of flags / branding / site config,
 * features or coins — and every owner entitlement change — is broadcast to every socket.
 * `entitlements:changed` is the owner's own signal, when the backend sends it.
 *
 * Values are gateway path PREFIXES, matched against `queryKey[1]` of the `['api' | 'paged', path,
 * query]` keys hooks/use-api builds. Kept import-free so `realtime-keys.test.mjs` runs on plain node.
 */
const SITE = ['admin/site-config', 'admin/branding', 'admin/entitlements']
const FEATURES = ['admin/features', 'admin/entitlements']
const COINS = ['admin/currencies', 'admin/site-config/public']

export const REALTIME_PREFIXES: Record<string, string[]> = {
  siteConfigUpdated: SITE,
  featuresUpdated: FEATURES,
  currenciesUpdated: COINS,

  // A plan change can switch any of these on or off.
  'entitlements:changed': [...new Set([...SITE, ...FEATURES, ...COINS])]
}

export const REALTIME_EVENTS = Object.keys(REALTIME_PREFIXES)

/** True when the query `key` reads one of `prefixes`. */
export function isStale(key: readonly unknown[], prefixes: Iterable<string>): boolean {
  if ((key[0] !== 'api' && key[0] !== 'paged') || typeof key[1] !== 'string') return false
  const path = key[1].replace(/^\/+/, '')

  for (const p of prefixes) if (path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`)) return true

  return false
}
