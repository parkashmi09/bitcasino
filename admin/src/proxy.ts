/**
 * Route protection. A request for an operator page without a session cookie
 * is sent to /login; a signed-in visit to /login goes home. The token itself
 * is verified by the platform on every API call, so this only checks presence
 * and expiry.
 */
import { NextResponse, type NextRequest } from 'next/server'

const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'site_admin_token'

// The branch panel (/branch, owner policy `branch_management`) runs on its own cookie (configs/site.ts).
const BRANCH_COOKIE = `${COOKIE}_branch`
const BRANCH_API = '/api/gw/api/v1/admin/branches/portal/'
const PUBLIC = ['/login', '/api/auth/session', '/api/auth/logout']

// Gateway calls a signed-out page needs (the login screen's site config, brand mark and sign-in).
const PUBLIC_API = ['/site-config/public', '/branding/public', '/branding/asset/', '/admin/auth/login', '/admin/auth/executive/login']

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

  if (pathname.startsWith(BRANCH_API) || pathname === '/branch' || pathname.startsWith('/branch/') || pathname.startsWith('/api/branch/')) {
    const branchIn = tokenLooksValid(req.cookies.get(BRANCH_COOKIE)?.value)

    if (pathname.startsWith(BRANCH_API)) {
      if (!branchIn && pathname !== `${BRANCH_API}login`) {
        return NextResponse.json({ success: false, error: { code: 'BRANCH_UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 })
      }

      return NextResponse.next()
    }

    if (pathname.startsWith('/api/branch/')) return NextResponse.next()
    if (pathname === '/branch/login') return branchIn ? NextResponse.redirect(new URL('/branch', req.url)) : NextResponse.next()

    return branchIn ? NextResponse.next() : NextResponse.redirect(new URL('/branch/login', req.url))
  }

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
