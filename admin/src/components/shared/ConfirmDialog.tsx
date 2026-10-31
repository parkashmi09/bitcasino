'use client'

import { useState, type ReactNode } from 'react'

import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { notifyError } from '@/lib/notify'

type Props = {
  trigger: ReactNode
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => Promise<unknown> | unknown
  children?: ReactNode

  /** Keep the confirm button disabled (e.g. a required reason is still empty). */
  confirmDisabled?: boolean
}

/** A yes/no gate around an action. Closes itself when `onConfirm` resolves. */
const ConfirmDialog = ({ trigger, title, description, confirmLabel = 'Confirm', destructive, onConfirm, children, confirmDisabled }: Props) => {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)

    try {
      await onConfirm()
      setOpen(false)
    } catch (error) {
      // Stay open; a mutation has already toasted — anything else is toasted here, never swallowed.
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={<span />}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={run} disabled={busy || confirmDisabled}>
            {busy && <Loader2Icon className='animate-spin' />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmDialog
