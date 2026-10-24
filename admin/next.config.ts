import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  basePath: process.env.BASEPATH ?? '',
  reactStrictMode: true,
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
