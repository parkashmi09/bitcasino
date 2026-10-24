import type { NextConfig } from 'next'

const basePath = process.env.BASEPATH ?? ''

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  redirects: async () => [{ source: '/', destination: '/overview', permanent: false }]
}

export default nextConfig
