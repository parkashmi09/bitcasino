'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { notifyError } from '@/lib/notify'

type Variant = { key: string; label: string; description: string }

/**
 * A business-policy dropdown that asks before it changes anything.
 *
 * These decide what a site ACCEPTS — whether strangers can sign up, whether a
 * gateway deposit is taken — and the backend enforces them on the next
 * request. A mis-click here closes a cashier, so the choice is confirmed with
 * both descriptions on screen.
 */
const PolicySelect = ({
  label,
  value,
  variants,
  isDefault,
  disabled,
  onChange
}: {
  label: string
  value: string
  variants: Variant[]
  isDefault?: boolean
  disabled?: boolean
  onChange: (next: string) => Promise<unknown>
}) => {
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const from = variants.find(v => v.key === value)
  const to = variants.find(v => v.key === pending)

  const confirm = async () => {
    if (!pending) return
    setBusy(true)

    try {
      await onChange(pending)
      setPending(null)
    } catch (error) {
      // Stay open; a mutation has already toasted, anything else is toasted here.
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex items-center gap-2'>
      <Select value={value} disabled={disabled} onValueChange={v => v && v !== value && setPending(v)}>
        <SelectTrigger className='w-52'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {variants.map(v => (
            <SelectItem key={v.key} value={v.key}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isDefault && (
        <Badge variant='outline' className='font-normal'>
          default
        </Badge>
      )}
      <Dialog open={pending !== null} onOpenChange={o => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change {label.toLowerCase()}?</DialogTitle>
            <DialogDescription>The site enforces this on the very next request. Pending items can still be approved either way.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3 text-sm'>
            <div className='rounded-md border p-3'>
              <p className='text-muted-foreground text-xs tracking-wide uppercase'>Now</p>
              <p className='font-medium'>{from?.label ?? value}</p>
              <p className='text-muted-foreground'>{from?.description}</p>
            </div>
            <div className='border-primary/50 bg-primary/5 rounded-md border p-3'>
              <p className='text-muted-foreground text-xs tracking-wide uppercase'>After</p>
              <p className='font-medium'>{to?.label ?? pending}</p>
              <p className='text-muted-foreground'>{to?.description}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={pending === 'none' ? 'destructive' : 'default'} onClick={confirm} disabled={busy}>
              {busy && <Loader2Icon className='animate-spin' />}
              Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default PolicySelect
