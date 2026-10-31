/**
 * Shared by the proxy and the route handlers; the name is not a secret. Named after the site
 * (owner-panel/.env.local SITE_NAME, e.g. TestPlay → `testplay_owner_session`).
 */
export const SESSION_COOKIE = `${(process.env.SITE_NAME || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_owner_session`

export const siteConfig = {
  key: 'hash-game-exchange',
  name: 'Owner Panel',
  tagline: 'TestPlay',
  environment: process.env.NEXT_PUBLIC_ENV_LABEL ?? 'localhost'
} as const

/** Server-only. Every value comes from owner-panel/.env.local — contract §1. */
export const serverConfig = {
  cookieName: SESSION_COOKIE,
  cookieMaxAgeSeconds: 12 * 60 * 60,
  ownerUsername: process.env.OWNER_USERNAME ?? '',
  ownerPassword: process.env.OWNER_PASSWORD ?? '',
  sessionSecret: process.env.OWNER_SESSION_SECRET ?? '',
  sharedSecret: process.env.OWNER_SHARED_SECRET ?? '',

  // Ed25519 private key (base64 PKCS8 DER). The backend holds only the public half.
  signingKey: process.env.OWNER_SIGNING_KEY ?? '',
  siteKey: process.env.SITE_KEY || 'hash-game-exchange',
  siteName: process.env.SITE_NAME || 'Your site',
  gatewayUrl: process.env.SITE_GATEWAY_URL || process.env.NEXT_PUBLIC_API_BASE || 'https://apitest.cfzautomation.com',

  /**
   * Where the BROWSER fetches API assets from (coin images). `gatewayUrl` is this server's own
   * route to the gateway and is usually a loopback address, which a visitor's browser cannot
   * reach — so an asset URL built from it only works while the panel is opened on this host.
   * Falls back to `gatewayUrl`, which is right when the two are the same machine.
   */
  publicApiBase: process.env.SITE_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_BASE || process.env.SITE_GATEWAY_URL || 'https://apitest.cfzautomation.com',
  adminUrl: process.env.SITE_ADMIN_URL ?? '',
  frontendUrl: process.env.SITE_FRONTEND_URL ?? ''
}
