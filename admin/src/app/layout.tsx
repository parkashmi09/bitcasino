// React Imports
import type { ReactNode } from 'react'

// Next Imports
import type { Metadata } from 'next'
import { Geist_Mono, Poppins } from 'next/font/google'

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

// ccpayment's body font.
const poppins = Poppins({ variable: '--font-poppins', subsets: ['latin'], weight: ['400', '500', '600', '700'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  description: `${siteConfig.name} operator panel`,
  robots: { index: false, follow: false },
  icons: { icon: { url: '/brand-mark.svg', type: 'image/svg+xml' }, apple: '/brand-mark.svg' }
}

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  return (
    <html
      lang='en'
      className={cn(poppins.variable, geistMono.variable, 'flex min-h-full w-full antialiased')}
      data-scroll-behavior='smooth'
      suppressHydrationWarning
    >
      <head>
        {/* The owner's palette from the last visit (components/layout/PaletteSync.tsx), set before paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var p=localStorage.getItem('admin.palette');if(p)document.documentElement.dataset.palette=p}catch(e){}"
          }}
        />
      </head>
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
