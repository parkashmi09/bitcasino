'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { Loader2Icon } from 'lucide-react'

// ccpayment snackbar icons: a 24px filled glyph (Eva icons) in a 40px, 12px-radius box tinted 16% of its colour.
const GLYPHS = {
  success:
    'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m4.3 7.61l-4.57 6a1 1 0 0 1-.79.39a1 1 0 0 1-.79-.38l-2.44-3.11a1 1 0 0 1 1.58-1.23l1.63 2.08l3.78-5a1 1 0 1 1 1.6 1.22Z',
  info: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m1 14a1 1 0 0 1-2 0v-5a1 1 0 0 1 2 0Zm-1-7a1 1 0 1 1 1-1a1 1 0 0 1-1 1',
  warning:
    'M22.56 16.3L14.89 3.58a3.43 3.43 0 0 0-5.78 0L1.44 16.3a3 3 0 0 0-.05 3A3.37 3.37 0 0 0 4.33 21h15.34a3.37 3.37 0 0 0 2.94-1.66a3 3 0 0 0-.05-3.04M12 17a1 1 0 1 1 1-1a1 1 0 0 1-1 1m1-4a1 1 0 0 1-2 0V9a1 1 0 0 1 2 0Z',
  error: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 15a1 1 0 1 1 1-1a1 1 0 0 1-1 1m1-4a1 1 0 0 1-2 0V8a1 1 0 0 1 2 0Z'
}

const SnackIcon = ({ className, d }: { className: string; d: string }) => (
  <span className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] ${className}`}>
    <svg viewBox='0 0 24 24' className='size-6' fill='currentColor' aria-hidden>
      <path d={d} />
    </svg>
  </span>
)

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group'

      // ccpayment: top-right, 14px from the top and 20px from the edge, with a close cross.
      position='top-right'
      offset={{ top: 14, right: 20 }}
      closeButton
      icons={{
        success: <SnackIcon className='bg-success-soft text-success' d={GLYPHS.success} />,
        info: <SnackIcon className='bg-info-soft text-info' d={GLYPHS.info} />,
        warning: <SnackIcon className='bg-warning-soft text-warning' d={GLYPHS.warning} />,
        error: <SnackIcon className='bg-destructive/16 text-destructive' d={GLYPHS.error} />,
        loading: <Loader2Icon className='text-primary size-5 animate-spin' />
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'transparent',

          // ccpayment snackbar: paper surface, 8px radius, card shadow, wide enough for a one-line message
          '--border-radius': '8px',
          '--width': 'min(520px, calc(100vw - 40px))'
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast font-sans gap-3! py-1.5! pr-4! pl-5! min-h-[52px] shadow-[var(--shadow-card)]!',
          icon: 'size-auto! m-0!',
          content: 'py-2',
          title: 'text-heading! text-sm! leading-[22px]! font-semibold!',
          description: 'text-muted-foreground! text-[13px]',

          // The cross sits at the end of the row, not sonner's floating top-left badge.
          closeButton:
            'static! order-last! ml-auto! self-center! size-8! shrink-0 transform-none! rounded-full! border-0! bg-transparent! text-muted-foreground! hover:bg-muted!'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
