import type { NextConfig } from 'next'

const dev = process.env.NODE_ENV !== 'production'
const base = process.env.BASEPATH ?? ''

/* Security step 3.1: the full policy, REPORT-ONLY. The browser blocks nothing; it reports what this list would
   block to /api/csp-report, which logs each new origin once. Add the real origins it reports, then rename the
   header to Content-Security-Policy to enforce. The admin talks to the gateway through its own /api/gw proxy, so
   connect-src is 'self'. */
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "frame-src 'self' https:",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `report-uri ${base}/api/csp-report`
].join('; ')

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js`: the framework and its version are not advertised (docs/SECURITY-CHECKLIST.md #10).
  poweredByHeader: false,
  basePath: process.env.BASEPATH ?? '',
  reactStrictMode: true,

  // Staff screens are never framed by another site (clickjacking), and the browser never guesses a
  // file's type. CSP carries only `frame-ancestors`: scripts, games and embeds are not restricted
  // here (docs/SECURITY-CHECKLIST.md #18).
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
      ]
    }
  ],
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  redirects: async () => [
    { source: '/', destination: '/dashboard', permanent: false },

    // The players screens moved to /users; keep old links and bookmarks working.
    { source: '/players', destination: '/users', permanent: true },
    { source: '/players/:path*', destination: '/users/:path*', permanent: true },

    // The races screen lives at /races; the old promotions path 404'd.
    { source: '/promotions/races', destination: '/races', permanent: true },

    // Short link to the owner panel's login (owner panel runs under /owner on the same host).
    { source: '/owner-login', destination: '/owner/login', permanent: false, basePath: false }
  ]
}

export default nextConfig
