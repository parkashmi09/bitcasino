'use client'

import { useEffect, type ReactNode } from 'react'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { BanIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { DIRECT_ROUTES, isPromotionRoute, routeRequirement } from '@/configs/navConfig'
import themeConfig from '@/configs/themeConfig'
import { useSession } from '@/contexts/SessionContext'
import { useHomeHref } from '@/hooks/use-nav-visible'

const isRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

type Refusal = 'promotions' | 'direct' | 'permission' | 'account' | 'plan'

/** Why the screen is closed, worded for the area the pasted URL points at. */
const noticeReason = (pathname: string, reason: Refusal) => {
  if (reason === 'promotions') {
    if (isRoute(pathname, '/vault')) return 'The Vault is managed by the site operator and is not part of agent accounts.'
    if (isRoute(pathname, '/swap')) return 'Swap is not available for your account.'

    // The coin registry is house configuration, not a promotion (see PROMOTION_ROUTES).
    if (isRoute(pathname, '/coins')) return 'Coins are managed by the site operator.'

    return 'Promotions are managed by the site operator and are not part of agent accounts.'
  }

  // Other Super-Admin-only screens are refused with the same reason; they are not about direct users.
  if (reason === 'direct' && !DIRECT_ROUTES.some(r => isRoute(pathname, r))) return 'Only the Super Admin can open this screen.'
  if (reason === 'direct') return 'Direct users are managed by the Super Admin and are not part of your account.'
  if (reason === 'account') return 'This screen is only for marketing logins.'
  if (reason === 'plan') return 'This section is not enabled for this site. Contact the platform to add it.'

  return 'Your role does not include this screen. Ask the site operator if you need access.'
}

export const NotAvailableNotice = ({ pathname = '', reason = 'promotions' }: { pathname?: string; reason?: Refusal }) => {
  // The first page this account can open, so the way out is never another refusal.
  const home = useHomeHref()

  return (
    <div
      role='status'
      className='border-border bg-card mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 rounded-xl border px-6 py-10 text-center'
    >
      <span className='bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full'>
        <BanIcon className='size-5' />
      </span>
      <h1 className='text-foreground text-base font-semibold'>{reason === 'plan' ? 'Not in your plan' : 'Not available for your account'}</h1>
      <p className='text-muted-foreground text-sm'>{noticeReason(pathname, reason)}</p>
      {home !== pathname && (
        <Link href={home} className='text-sm font-medium underline underline-offset-4'>
          {home === themeConfig.homePageUrl ? 'Back to dashboard' : 'Go to your start page'}
        </Link>
      )}
    </div>
  )
}

/**
 * The route gate. Every screen the sidebar links to carries the marks it is filtered on
 * (`permission`, `promotions`, `account` in `navConfig.tsx`); a pasted URL is held to the same
 * marks. When the session lacks them the screen is not rendered at all — so none of its API calls
 * fire — and the "not available" notice is shown instead of the shell plus a raw permission error.
 *
 * Promotions routes (bonus, codes, gift cards, wheel, VIP & club, affiliate, races), the vault,
 * swap history and the coin registry are closed to agent-tree logins (levels 4–6 and their executives) with their own
 * wording. The server still refuses on its own; this is so the screen never opens to say so.
 */
const RouteGate = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname()
  const router = useRouter()
  const { actor, loading, can, flagsLoading, flagEntitled, featureEntitled } = useSession()
  const home = useHomeHref()
  const mustChange = actor?.mustChangePassword === true

  const required = routeRequirement(pathname)
  const promotions = isPromotionRoute(pathname) || required?.promotions === true
  const direct = required?.direct === true || DIRECT_ROUTES.some(r => pathname === r || pathname.startsWith(`${r}/`))

  /*
   * Every way into the panel lands on the dashboard (sign-in, `/`, a signed-in visit to /login,
   * a changed password). An account whose role cannot open it — e.g. an executive granted only
   * users:read — is sent on to the first page in the sidebar it CAN use, instead of a refusal.
   */
  const landingRefused =
    pathname === themeConfig.homePageUrl && !!actor && !flagsLoading && !!required && (!required.permissions.every(p => can(p)) || (required.direct && actor.direct !== true))

  // Nothing opens until a password somebody else chose is replaced — the platform refuses it anyway.
  useEffect(() => {
    if (mustChange) router.replace('/change-password')
    else if (landingRefused && home !== pathname) router.replace(home)
  }, [mustChange, landingRefused, home, pathname, router])

  if (mustChange || (landingRefused && home !== pathname)) return <Skeleton className='h-40 w-full' />

  if (!promotions && !direct && !required) return <>{children}</>
  if (!actor) return loading ? <Skeleton className='h-40 w-full' /> : <NotAvailableNotice pathname={pathname} reason='permission' />

  let refusal: Refusal | null = null

  if (promotions && actor.promotions !== true) refusal = 'promotions'
  else if (direct && actor.direct !== true) refusal = 'direct'
  else if (required?.account === 'marketing' && actor.marketing !== true) refusal = 'account'
  else if (required && !required.permissions.every(p => can(p))) refusal = 'permission'
  else if (required && [...required.ownerFlags, ...required.planFlags].some(f => !flagEntitled(f))) refusal = 'plan'
  else if (required?.planFeatures.some(f => !featureEntitled(f))) refusal = 'plan'

  if (refusal) return <NotAvailableNotice pathname={pathname} reason={refusal} />

  return <>{children}</>
}

export default RouteGate
