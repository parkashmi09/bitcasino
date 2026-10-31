import { AlertTriangleIcon } from 'lucide-react'

import { errorMessage } from '@/lib/api/client'

const ErrorState = ({ error, title = 'Could not load' }: { error: unknown; title?: string }) => (
  <div
    role='alert'
    className='bg-danger-soft flex w-full items-start gap-3 rounded-lg px-4 py-3.5 text-left text-sm'
  >
    <span className='text-danger flex size-6 shrink-0 items-center justify-center'>
      <AlertTriangleIcon className='size-5' />
    </span>
    <div className='min-w-0 space-y-0.5'>
      <p className='text-danger font-semibold'>{title}</p>
      <p className='text-foreground break-words'>{errorMessage(error)}</p>
    </div>
  </div>
)

export default ErrorState
