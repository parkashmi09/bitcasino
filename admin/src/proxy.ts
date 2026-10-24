/**
 * Route protection. A request for an operator page without a session cookie
 * is sent to /login; a signed-in visit to /login goes home. The token itself
 * is verified by the platform on every API call, so this only checks presence
 * and expiry.
 */
import { NextResponse, type NextRequest } from 'next/server'

const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'site_admin_token'
const PUBLIC = ['/login', '/api/auth/session', '/api/auth/logout']

// Gateway reads a signed-out page needs (the login screen's site config and brand mark).
const PUBLIC_API = ['/site-config/public', '/branding/public', '/branding/asset/']

function tokenLooksValid(token: string | undefined) {
  if (!token) return false

  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))

    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const signedIn = tokenLooksValid(req.cookies.get(COOKIE)?.value)

  if (pathname.startsWith('/api/gw/')) {
    if (!signedIn && !PUBLIC_API.some(p => pathname.includes(p))) {
      return NextResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 })
    }

    return NextResponse.next()
  }

  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    if (signedIn && pathname === '/login') return NextResponse.redirect(new URL('/dashboard', req.url))

    return NextResponse.next()
  }

  if (!signedIn) {
    const url = new URL('/login', req.url)

    if (pathname !== '/') url.searchParams.set('next', pathname)

    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand-mark.png|brand-mark.webp|brand-mark.svg|images|api/auth/me).*)']
}
