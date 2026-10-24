'use client'

import { useEffect, useState } from 'react'

import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'

/**
 * The site's brand MARK (the owner panel's square "mark" slot), from the public
 * `admin/branding/public` read — once per session, and the bundled crowned-P when the owner has
 * none, the read fails or the image does not load. It is also the tab icon.
 */
type PublicBranding = { markUrl?: string | null; logoUrl?: string | null; siteName?: string | null }

export const DEFAULT_MARK = '/brand-mark.webp?v=308'

// The asset route answers on the platform; the browser reaches it through the `/api/gw` proxy.
const proxied = (url: string | null | undefined) => {
  const m = /\/api\/v1\/(admin\/branding\/asset\/[^/?#]+)$/.exec(String(url ?? ''))

  return m ? `/api/gw/api/v1/${m[1]}` : null
}

const BrandMark = ({ className }: { className?: string }) => {
  const branding = useApi<PublicBranding>('admin/branding/public', undefined, { staleTime: Infinity, retry: false })
  const markUrl = proxied(branding.data?.markUrl)
  const [failed, setFailed] = useState<string | null>(null)
  const src = markUrl && failed !== markUrl ? markUrl : DEFAULT_MARK

  useEffect(() => {
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => (link.href = src))
  }, [src])

  return (
    <img
      src={src}
      alt=''
      className={cn('size-8 shrink-0 rounded-md object-contain', className)}
      onError={() => setFailed(markUrl)}
    />
  )
}

/**
 * The site's full wordmark (the owner panel's wide "logo" slot) from the same public read — dark theme only,
 * since it is drawn for the dark header (white text). The light theme, and any load gap or failure, show `fallback`.
 */
export const BrandLogo = ({ className, fallback }: { className?: string; fallback: React.ReactNode }) => {
  const branding = useApi<PublicBranding>('admin/branding/public', undefined, { staleTime: Infinity, retry: false })
  const logoUrl = proxied(branding.data?.logoUrl)
  const [failed, setFailed] = useState<string | null>(null)

  if (!logoUrl || failed === logoUrl) return <>{fallback}</>

  return (
    <>
      <div className='dark:hidden'>{fallback}</div>
      <img
        src={logoUrl}
        alt={branding.data?.siteName ?? ''}
        className={cn('hidden h-12 w-auto max-w-[320px] object-contain dark:block', className)}
        onError={() => setFailed(logoUrl)}
      />
    </>
  )
}

export default BrandMark
