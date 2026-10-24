'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from 'lucide-react'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group'
      icons={{
        success: <CircleCheckIcon className='text-success size-5' />,
        info: <InfoIcon className='text-info size-5' />,
        warning: <TriangleAlertIcon className='text-warning size-5' />,
        error: <OctagonXIcon className='text-destructive size-5' />,
        loading: <Loader2Icon className='text-primary size-5 animate-spin' />
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'transparent',

          // ccpayment snackbar: paper surface, 8px radius, card shadow
          '--border-radius': '8px'
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast font-sans gap-3! p-3! pr-4! shadow-[var(--shadow-card)]!',
          title: 'text-heading text-sm font-semibold',
          description: 'text-muted-foreground! text-[13px]'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
