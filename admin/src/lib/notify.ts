import { toast } from 'sonner'

import { errorMessage } from '@/lib/api/client'

const TOASTED = Symbol.for('admin.errorToasted')

/** Remember that this error has been shown, so a dialog catching it does not toast it twice. */
export const markToasted = (error: unknown) => {
  if (error && typeof error === 'object') {
    try {
      Object.defineProperty(error, TOASTED, { value: true, configurable: true })
    } catch {
      // frozen object — worst case it toasts twice
    }
  }
}

export const wasToasted = (error: unknown) => Boolean(error && typeof error === 'object' && (error as Record<symbol, unknown>)[TOASTED])

/** Toast an error with the server's message — once. */
export const notifyError = (error: unknown, prefix?: string) => {
  if (wasToasted(error)) return
  markToasted(error)
  const message = errorMessage(error)

  toast.error(prefix ? `${prefix}: ${message}` : message)
}
