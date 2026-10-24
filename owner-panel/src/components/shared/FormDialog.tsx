'use client'

import { useState, type ReactNode } from 'react'

import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type Props = {
  trigger: ReactNode
  title: string
  description?: ReactNode
  submitLabel?: string
  destructive?: boolean

  /** Return normally to close; throw (or let the mutation toast) to stay open. */
  onSubmit: () => Promise<unknown> | unknown
  children: ReactNode
  wide?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** A dialog wrapping a form. State lives in the caller; this owns open/busy only. */
const FormDialog = ({ trigger, title, description, submitLabel = 'Save', destructive, onSubmit, children, wide, open, onOpenChange }: Props) => {
  const [innerOpen, setInnerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isOpen = open ?? innerOpen
  const setOpen = onOpenChange ?? setInnerOpen

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)

    try {
      await onSubmit()
      setOpen(false)
    } catch {
      // the mutation already toasted
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger render={<span />}>{trigger}</DialogTrigger>
      <DialogContent className={wide ? 'sm:max-w-2xl' : undefined}>
        <form onSubmit={submit} className='contents'>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className='grid gap-4 py-2'>{children}</div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type='submit' variant={destructive ? 'destructive' : 'default'} disabled={busy}>
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
