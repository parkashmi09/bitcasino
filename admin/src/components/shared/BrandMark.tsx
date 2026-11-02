'use client'

import { useEffect, type ReactNode } from 'react'

import themeConfig from '@/configs/themeConfig'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/** The common TestPlay mark: shown until the owner uploads one (owner panel → Branding). */
export const DEFAULT_MARK = '/brand-mark.svg'

type PublicBranding = { siteName: string | null; logoUrl: string | null; markUrl: string | null }

/* `/api/v1/admin/branding/asset/<file>` → the same file through this panel's gateway proxy. */
const asset = (path: string | null | undefined) => (path ? api.url(path.replace(/^\/api\/v1\//, '')) : null)

/**
 * The owner's branding (owner panel → Branding), the same document the player site draws:
 * name, wordmark and square mark. Public, so the login screen reads it too.
 */
export function useOwnerBranding() {
  const q = useApi<PublicBranding>('admin/branding/public', undefined, { staleTime: 60_000, retry: false })

  return {
    siteName: q.data?.siteName || themeConfig.templateName,
    logoUrl: asset(q.data?.logoUrl),
    markUrl: asset(q.data?.markUrl)
  }
}

/** The site's square mark (the owner's, else TestPlay's). It is also the tab icon. */
const BrandMark = ({ className }: { className?: string }) => {
  const { markUrl } = useOwnerBranding()
  const src = markUrl ?? DEFAULT_MARK

  useEffect(() => {
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => (link.href = src))
  }, [src])

  return <img src={src} alt='' className={cn('size-8 shrink-0 rounded-md object-contain', className)} />
}

/** The site's name: the owner's, else this panel's. */
export const BrandName = () => <>{useOwnerBranding().siteName}</>

/**
 * The full wordmark slot (login screen): the owner's logo on a white chip, since a wordmark is
 * drawn for a light page; else `fallback` (mark + name).
 */
export const BrandLogo = ({ className, fallback }: { className?: string; fallback: ReactNode }) => {
  const { logoUrl, siteName } = useOwnerBranding()

  if (!logoUrl) return <>{fallback}</>

  return (
    <span className={cn('inline-flex self-start rounded-lg bg-white px-3 py-2', className)}>
      <img src={logoUrl} alt={siteName} className='h-10 w-auto max-w-[240px] object-contain' />
    </span>
  )
}

export default BrandMark
