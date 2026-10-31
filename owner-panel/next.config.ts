import type { NextConfig } from 'next'

const basePath = process.env.BASEPATH ?? ''

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js`: the framework and its version are not advertised (docs/SECURITY-CHECKLIST.md #10).
  poweredByHeader: false,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
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
  redirects: async () => [{ source: '/', destination: '/overview', permanent: false }]
}

export default nextConfig
