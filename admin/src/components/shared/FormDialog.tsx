'use client'

import { useState, type ReactNode } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { FormErrorsProvider } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { notifyError } from '@/lib/notify'
import { cleanErrors, serverFieldErrors, type FieldErrors } from '@/lib/validate'

type Props = {
  trigger: ReactNode
  title: string
  description?: ReactNode
  submitLabel?: string
  destructive?: boolean

  /** Return normally to close; throw (or let the mutation toast) to stay open. */
  onSubmit: () => Promise<unknown> | unknown

  /**
   * Runs before `onSubmit`. Return a message (string) or a `{ [field name|id]: message }` map
   * to block the submit: each message shows under its field and the first one is toasted.
   */
  validate?: () => FieldErrors | string | null | undefined | false

  /** Keep the submit button disabled (e.g. nothing chosen yet). */
  submitDisabled?: boolean
  children: ReactNode
  wide?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** A dialog wrapping a form. State lives in the caller; this owns open/busy only. */
const FormDialog = ({ trigger, title, description, submitLabel = 'Save', destructive, onSubmit, validate, submitDisabled, children, wide, open, onOpenChange }: Props) => {
  const [innerOpen, setInnerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isOpen = open ?? innerOpen

  /* Uncontrolled (no `open`) keeps its own state even when the caller listens with
     `onOpenChange` — e.g. to prefill a form on open. Replacing the setter with the
     listener left the dialog unable to open at all. */
  const setOpen = (next: boolean) => {
    if (!next) setErrors({})
    if (open === undefined) setInnerOpen(next)
    onOpenChange?.(next)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return

    const problems = validate?.()

    if (typeof problems === 'string' && problems) {
      toast.error(problems)

      return
    }

    const found = typeof problems === 'object' ? cleanErrors(problems) : {}

    if (Object.keys(found).length) {
      setErrors(found)
      toast.error(Object.values(found)[0])

      return
    }

    setErrors({})
    setBusy(true)

    try {
      await onSubmit()
      setOpen(false)
    } catch (error) {
      // A mutation has already toasted its error; anything else (a thrown check, a direct api call) is toasted here.
      setErrors(serverFieldErrors(error))
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={<span />}>{trigger}</DialogTrigger>
      <DialogContent className={wide ? 'sm:max-w-2xl' : undefined}>
        <form onSubmit={submit} className='contents'>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FormErrorsProvider errors={errors} onClear={key =>
              setErrors(prev => {
                const next = { ...prev }

                delete next[key]

                return next
              })
            }>
            <div className='grid gap-4 py-2'>{children}</div>
          </FormErrorsProvider>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type='submit' variant={destructive ? 'destructive' : 'default'} disabled={busy || submitDisabled}>
              {busy && <Loader2Icon className='animate-spin' />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default FormDialog
