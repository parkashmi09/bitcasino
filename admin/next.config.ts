import type { NextConfig } from 'next'

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
