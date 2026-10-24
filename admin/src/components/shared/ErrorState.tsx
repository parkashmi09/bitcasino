import { AlertTriangleIcon } from 'lucide-react'

import { errorMessage } from '@/lib/api/client'

const ErrorState = ({ error, title = 'Could not load' }: { error: unknown; title?: string }) => (
  <div
    role='alert'
    className='border-danger/30 bg-danger-soft flex w-full items-start gap-3 rounded-[6px] border border-dashed px-4 py-3.5 text-left text-sm'
  >
    <span className='bg-card text-danger flex size-7 shrink-0 items-center justify-center rounded-md'>
      <AlertTriangleIcon className='size-4' />
    </span>
    <div className='min-w-0 space-y-0.5'>
      <p className='text-foreground font-medium'>{title}</p>
      <p className='text-muted-foreground break-words'>{errorMessage(error)}</p>
    </div>
  </div>
)

export default ErrorState
