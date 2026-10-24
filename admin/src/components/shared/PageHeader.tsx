'use client'

import { Fragment, type ReactNode } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { useHomeHref } from '@/hooks/use-nav-visible'

type Props = {
  title: string
  description?: ReactNode
  actions?: ReactNode
}

/**
 * Breadcrumbs title-case each URL segment; these segments would read wrong
 * that way ("Pnl"), so they are spelled out.
 */
const SEGMENT_LABELS: Record<string, string> = {
  pnl: 'Profit & loss',
  'ip-tracker': 'Login & IP history'
}

const segmentLabel = (segment: string) => {
  const raw = decodeURIComponent(segment)

  return SEGMENT_LABELS[raw.toLowerCase()] ?? raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** ccpayment's page title row: 24px semibold title, breadcrumb and muted subtitle under it, actions on the right. */
const PageHeader = ({ title, description, actions }: Props) => {
  const pathname = usePathname()
  const homeHref = useHomeHref()
  const segments = pathname.split('/').filter(Boolean)

  return (
    <div className='mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3'>
      <div className='min-w-0'>
        <h1 className='text-heading text-2xl leading-normal font-semibold'>{title}</h1>
        <Breadcrumb className='mt-2'>
          <BreadcrumbList className='text-[14px]'>
            <BreadcrumbItem>
              <Link href={homeHref} className='text-foreground hover:underline'>
                Home
              </Link>
            </BreadcrumbItem>
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1
              const href = '/' + segments.slice(0, index + 1).join('/')

              return (
                <Fragment key={href}>
                  <BreadcrumbSeparator className='text-muted-foreground/60 [&>svg]:size-3' />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className='text-muted-foreground'>{segmentLabel(segment)}</BreadcrumbPage>
                    ) : (
                      <span className='text-foreground'>{segmentLabel(segment)}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
        {description && <p className='text-muted-foreground mt-2 max-w-prose text-[14px]'>{description}</p>}
      </div>
      {actions && <div className='flex flex-wrap items-center gap-2'>{actions}</div>}
    </div>
  )
}

export default PageHeader
