// React Imports
import type { ReactNode } from 'react'

// Next Imports
import type { Metadata } from 'next'
import { Geist_Mono, Nunito } from 'next/font/google'

// Third-party Imports
import { NuqsAdapter } from 'nuqs/adapters/next/app'

// Component Imports
import Providers from '@/components/Providers'
import ScrollToTop from '@/components/layout/ScrollToTop'

// Config Imports
import { siteConfig } from '@/configs/site'

// Util Imports
import { cn } from '@/lib/utils'

// Style Imports
import './globals.css'

// Luno's body font.
const nunito = Nunito({ variable: '--font-nunito', subsets: ['latin'], weight: ['400', '600', '700', '800'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  description: `${siteConfig.name} operator panel`,
  robots: { index: false, follow: false },
  icons: { icon: { url: '/brand-mark.webp?v=308', type: 'image/webp' }, apple: '/brand-mark.png?v=308' }
}

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  return (
    <html
      lang='en'
      className={cn(nunito.variable, geistMono.variable, 'flex min-h-full w-full antialiased')}
      data-scroll-behavior='smooth'
      suppressHydrationWarning
    >
      <body className='flex min-h-full w-full flex-auto flex-col'>
        <NuqsAdapter>
          <Providers sidebarDefaultOpen={true}>{children}</Providers>
        </NuqsAdapter>
        <ScrollToTop />
      </body>
    </html>
  )
}

export default RootLayout
