'use client'

import { useEffect, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The site's brand mark: the common TestPlay mark (frontend/apps/web/public/brand/testplay-mark.svg), not the shared
 * API's owner branding, which is another site's. It is also the tab icon.
 */
export const DEFAULT_MARK = '/brand-mark.svg'

const BrandMark = ({ className }: { className?: string }) => {
  const src = DEFAULT_MARK

  useEffect(() => {
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => (link.href = src))
  }, [src])

  return (
    <img
      src={src}
      alt=''
      className={cn('size-8 shrink-0 rounded-md object-contain', className)}
    />
  )
}

/**
 * The site's full wordmark slot. The shared API's owner branding is another site's, so bitcasino
 * always shows its own mark + name (`fallback`).
 */
export const BrandLogo = ({ fallback }: { className?: string; fallback: ReactNode }) => <>{fallback}</>

export default BrandMark
