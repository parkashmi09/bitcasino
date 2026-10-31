/**
 * Site identity and where the platform gateway lives.
 *
 * One admin build serves every clone. What differs per site is injected by
 * environment, never hardcoded: the owner panel writes these into each
 * site's `admin/.env.local` when it provisions the site.
 *
 *   API_URL                 server-only — the gateway the proxy forwards to
 *   NEXT_PUBLIC_SITE_KEY    stable id: 'shuffle' | 'hash-games' | 'stake-site' | 'admins'
 *   NEXT_PUBLIC_SITE_NAME   what the sidebar shows
 *   NEXT_PUBLIC_WHITELABEL_MODE  'true' on a whitelabel copy: its Super Admin is the company (no self-funding)
 */
export const siteConfig = {
  key: process.env.NEXT_PUBLIC_SITE_KEY ?? 'admins',
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? 'Site Admin',
  tagline: process.env.NEXT_PUBLIC_SITE_TAGLINE ?? 'Operator panel',
  environment: process.env.NEXT_PUBLIC_ENV_LABEL ?? 'localhost',
  whitelabel: process.env.NEXT_PUBLIC_WHITELABEL_MODE === 'true',

  /** The platform's public base URL: the browser signs in here directly (views/auth/Login.tsx). */
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || 'https://apitest.cfzautomation.com').replace(/\/+$/, '')
} as const

/** Server-only. Never import from a client component. */
export const serverConfig = {
  apiUrl: (process.env.API_URL || process.env.NEXT_PUBLIC_API_BASE || 'https://apitest.cfzautomation.com').replace(/\/+$/, ''),
  cookieName: process.env.SESSION_COOKIE_NAME ?? 'site_admin_token',

  /** The branch panel's (/branch) own cookie — never the staff one. Same name rule in src/proxy.ts. */
  branchCookieName: `${process.env.SESSION_COOKIE_NAME ?? 'site_admin_token'}_branch`,
  cookieMaxAgeSeconds: Number(process.env.SESSION_MAX_AGE_SECONDS ?? 8 * 60 * 60)
}
