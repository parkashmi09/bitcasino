'use client'

import { AlertTriangleIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api/client'

type Props = { error: unknown; title?: string; onRetry?: () => unknown; retrying?: boolean }

/** A failed load: what went wrong (the server's message, in plain words) and, when given, a Retry. */
const ErrorState = ({ error, title = 'Could not load', onRetry, retrying }: Props) => (
  <Alert variant='destructive' role='alert'>
    <AlertTriangleIcon />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>{errorMessage(error)}</AlertDescription>
    {onRetry && (
      <AlertAction>
        <Button size='sm' variant='outline' onClick={() => void onRetry()} disabled={retrying}>
          {retrying ? <Loader2Icon className='animate-spin' /> : <RefreshCwIcon />} Retry
        </Button>
      </AlertAction>
    )}
  </Alert>
)

export default ErrorState
