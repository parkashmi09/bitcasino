/**
 * The tab icon: the owner's square mark (owner panel → Branding → Square mark / favicon), the same
 * one the player site uses; the TestPlay mark until the owner uploads one. Revalidated on every
 * load, so an owner change shows on the next page load.
 */
import { NextResponse, type NextRequest } from 'next/server'

import { serverConfig } from '@/configs/site'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FALLBACK = '/brand-mark.svg'
const TYPES = new Set(['image/svg+xml', 'image/png', 'image/webp'])

export async function GET(req: NextRequest) {
  const fallback = () => NextResponse.redirect(new URL(FALLBACK, req.url))

  try {
    const branding = await fetch(`${serverConfig.apiUrl}/api/v1/admin/branding/public`, { cache: 'no-store' })
    const markUrl: unknown = (await branding.json())?.data?.markUrl

    // Only the gateway's own asset route: nothing the document says can point this elsewhere.
    if (typeof markUrl !== 'string' || !markUrl.startsWith('/api/v1/admin/branding/asset/')) return fallback()

    const image = await fetch(`${serverConfig.apiUrl}${markUrl}`, { cache: 'no-store' })
    const type = image.headers.get('content-type')?.split(';')[0] ?? ''

    if (!image.ok || !TYPES.has(type)) return fallback()

    return new NextResponse(await image.arrayBuffer(), {
      headers: { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }
    })
  } catch {
    return fallback()
  }
}
