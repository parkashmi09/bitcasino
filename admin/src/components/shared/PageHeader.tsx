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

/** Luno's page toolbar: breadcrumb (teal Home link), title + muted subtitle, actions on the right. */
const PageHeader = ({ title, description, actions }: Props) => {
  const pathname = usePathname()
  const homeHref = useHomeHref()
  const segments = pathname.split('/').filter(Boolean)

  return (
    <div className='mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3'>
      <div className='min-w-0'>
        <Breadcrumb className='mb-3'>
          <BreadcrumbList className='text-[15px]'>
            <BreadcrumbItem>
              <Link href={homeHref} className='text-brand-secondary hover:underline'>
                Home
              </Link>
            </BreadcrumbItem>
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1
              const href = '/' + segments.slice(0, index + 1).join('/')

              return (
                <Fragment key={href}>
                  <BreadcrumbSeparator className='[&>svg]:size-3' />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className='text-foreground'>{segmentLabel(segment)}</BreadcrumbPage>
                    ) : (
                      <span className='text-muted-foreground'>{segmentLabel(segment)}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className='text-heading text-xl font-semibold'>{title}</h1>
        {description && <p className='text-muted-foreground mt-1 max-w-prose text-[13px]'>{description}</p>}
      </div>
      {actions && <div className='flex flex-wrap items-center gap-2'>{actions}</div>}
    </div>
  )
}

export default PageHeader
