'use client'

import Link from 'next/link'

import { siteConfig } from '@/configs/site'
import { useHomeHref } from '@/hooks/use-nav-visible'

/** ccpayment-style page footer: copyright on the left, a few links on the right. */
const Footer = () => {
  const homeHref = useHomeHref()

  return (
    <footer>
      <div className='text-muted-foreground mx-auto flex size-full flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-[13px] max-sm:flex-col sm:px-6 lg:px-10'>
        <p>
          © {new Date().getFullYear()} <span className='text-brand-secondary'>{siteConfig.name}</span>, All Rights
          Reserved.
        </p>
        <nav aria-label='Footer' className='flex items-center gap-5'>
          <Link href={homeHref} className='hover:text-primary transition-colors duration-250'>
            Home
          </Link>
          <Link href='/account' className='hover:text-primary transition-colors duration-250'>
            My account
          </Link>
        </nav>
      </div>
    </footer>
  )
}

export default Footer
