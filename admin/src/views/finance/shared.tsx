'use client'

import { useRef, useState, type ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { CheckIcon, CopyIcon, ImageIcon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'

import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextAreaField, TextField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useApiMutation } from '@/hooks/use-api'
import { api, request } from '@/lib/api/client'
import type { Paged, Query } from '@/lib/api/types'
import { check } from '@/lib/validate'
import { StaffFloatNote, useIsAgentTree, TxnPasswordLabel } from './StaffFloat'
import { useCurrencyCodes, useOwnerCoinFilter } from './useCurrencyCodes'

/**
 * Some user-service listings page by `page`/`limit` rather than `limit`/`offset`
 * (deposit-reports, P2P — and P2P is `.strict()`, so `offset` is a 422 there).
 * `api.paged` always translates to `offset`, so those lists go through here.
 */
export function usePageNumbered<T>(path: string | null, query: Query) {
  return useQuery<Paged<T>>({
    queryKey: ['paged', path, query],
    enabled: path !== null,
    placeholderData: prev => prev,
    queryFn: async ({ signal }) => {
      const page = Math.max(Number(query.page ?? 1), 1)
      const limit = Number(query.limit ?? 20)
      const { data, meta } = await request<T[]>(path as string, { query: { ...query, page, limit }, signal })

      const pagination = (meta?.pagination as Paged<T>['pagination']) ?? {
        page,
        limit,
        total: Array.isArray(data) ? data.length : 0,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      }

      return { rows: Array.isArray(data) ? data : [], pagination }
    }
  })
}

/** Label/value rows for a detail dialog. */
export const Details = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className='grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm'>
    {items.map(([k, v]) => (
      <div key={k} className='contents'>
        <dt className='text-muted-foreground'>{k}</dt>
        <dd className='min-w-0 break-words'>{v === null || v === undefined || v === '' ? <span className='text-muted-foreground'>—</span> : v}</dd>
      </div>
    ))}
  </dl>
)

/** A read-only dialog: trigger, title, children. */
export const ViewDialog = ({ trigger, title, description, children, wide }: { trigger: ReactNode; title: string; description?: ReactNode; children: ReactNode; wide?: boolean }) => (
  <Dialog>
    <DialogTrigger nativeButton={false} render={<span />}>{trigger}</DialogTrigger>
    <DialogContent className={wide ? 'sm:max-w-2xl' : undefined}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
)

/** An image served by a gateway route (the proxy adds the staff token). Loaded only once the dialog opens. */
export const ImageDialog = ({ path, title, label = 'View', thumbnail }: { path: string; title: string; label?: string; thumbnail?: boolean }) => {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next) setFailed(false)
        setOpen(next)
      }}
    >
      <DialogTrigger nativeButton={false} render={<span />}>
        {thumbnail ? (
          <button
            type='button'
            aria-label={label}
            title={label}
            className='bg-muted text-muted-foreground hover:ring-primary/60 flex size-10 items-center justify-center overflow-hidden rounded-md border transition hover:ring-2'
          >
            {thumbFailed ? (
              <ImageIcon className='size-4' />
            ) : (
              <img src={api.url(path)} alt='' loading='lazy' className='size-full object-cover' onError={() => setThumbFailed(true)} />
            )}
          </button>
        ) : (
          <Button variant='outline' size='sm'>
            <ImageIcon /> {label}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open && !failed && (
          <img src={api.url(path)} alt={title} className='max-h-[70vh] w-full rounded-md object-contain' onError={() => setFailed(true)} />
        )}
        {failed && <p className='text-destructive text-sm'>Could not load the image — it may not exist or you may not have access.</p>}
        <a href={api.url(path)} target='_blank' rel='noreferrer' className='text-muted-foreground text-xs underline'>
          Open in a new tab
        </a>
      </DialogContent>
    </Dialog>
  )
}


/** Copies `value` to the clipboard (a bank reference, a tx hash). */
export const CopyButton = ({ value, label = 'Copy' }: { value: string; label?: string }) => {
  const [done, setDone] = useState(false)

  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-xs'
      aria-label={label}
      title={label}
      className='text-muted-foreground hover:text-foreground shrink-0'
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          },
          () => toast.error('Could not copy')
        )
      }}
    >
      {done ? <CheckIcon className='text-success' /> : <CopyIcon />}
    </Button>
  )
}

/** A fresh per-submit idempotency key (UUID where the browser has one). */
const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `ui-${crypto.randomUUID()}`
    : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

/** Stops a row click from also firing when an action button inside the row is pressed. */
export const stop = (e: React.MouseEvent) => e.stopPropagation()

/**
 * `POST admin/user/wallet/adjust` with `{ userId, currency, amount, operation, description, transactionPassword? }`
 * — used by Wallets and by the player page.
 *
 * Agent-tree staff (levels 4–6): the backend makes this a TRANSFER from the caller's own float
 * (INR only), refuses with 422 INSUFFICIENT_FUNDS, details.party = staff, and always needs the transaction
 * password — so the dialog shows the available float, offers INR only and marks the password
 * required. House staff: an operator adjustment, with the transaction password once one is set.
 */
export const AdjustWalletDialog = ({ userId, userName, currencies, invalidate = [], trigger }: { userId: string | number; userName?: string; currencies?: string[]; invalidate?: (string | null)[][]; trigger?: ReactNode }) => {
  const agentTree = useIsAgentTree()
  const registry = useCurrencyCodes()
  const ownerCoins = useOwnerCoinFilter()

  // House staff: the coins the caller passed first (primary + held), then every other coin in the
  // registry — so a coin the owner created (custom, phase B) can be adjusted; a coin outside the
  // owner's plan is never offered. Agent tree: INR.
  const list = agentTree ? ['INR'] : Array.from(new Set([...ownerCoins(currencies ?? []), ...registry]))
  const [form, setForm] = useState({ currency: list[0], amount: '', operation: 'credit', description: '', transactionPassword: '' })

  /*
   * One idempotency key per submit. A retry of the SAME submit (double-click, a request that
   * timed out) reuses the key and the server replays it; once a submit succeeds, or the figures
   * change, the next Apply gets a new key — so a deliberate second identical adjustment goes through.
   */
  const submitKey = useRef<{ fingerprint: string; key: string } | null>(null)

  const adjust = useApiMutation({
    fn: () => {
      const body: Record<string, string | number> = { userId: Number(userId), currency: agentTree ? 'INR' : form.currency, amount: form.amount, operation: form.operation, description: form.description }
      const fingerprint = JSON.stringify([body.userId, body.currency, body.amount, body.operation, body.description])

      if (submitKey.current?.fingerprint !== fingerprint) submitKey.current = { fingerprint, key: newIdempotencyKey() }
      body.idempotencyKey = submitKey.current.key

      if (form.transactionPassword) body.transactionPassword = form.transactionPassword

      return api.post<{ replayed?: boolean }>('admin/user/wallet/adjust', body)
    },
    invalidate: [['paged', 'admin/user/wallet/balances'], ['api', `admin/reports/players/${userId}`], ['api', `admin/user/wallet/${userId}/balances`], ['paged', `admin/user/wallet/${userId}/history`], ['api', 'admin/accounts/float'], ['api', 'admin/exchange/owner/wallet'], ...invalidate],
    onSuccess: result => {
      submitKey.current = null
      if (result?.replayed) toast.info('Already processed — this adjustment was applied once; nothing was moved again')
      else toast.success('Balance adjusted')
      setForm(f => ({ ...f, amount: '', description: '', transactionPassword: '' }))
    }
  })

  return (
    <FormDialog
      trigger={
        trigger ?? (
          <Button variant='outline' size='sm'>
            <WalletIcon /> Adjust
          </Button>
        )
      }
      title={`Adjust wallet balance${userName ? ` — ${userName}` : ''}`}
      description={
        agentTree
          ? `Moves INR between your balance and user #${userId}. A reason is required and appears on both statements.`
          : `Writes a ledger entry against user #${userId}. INR comes out of (and goes back to) your own wallet, except for a direct user (signed up on their own), who is not charged to you. A reason is required and audited.`
      }
      submitLabel='Apply'
      validate={() => ({
        // wallet.validators.js adminAdjust: amount > 0, ≤ 8 decimals; reason 1–500 chars.
        amount: check.amount(form.amount, 'Amount', { decimals: 8 }),
        description: check.required(form.description, 'Reason') ?? check.length(form.description, 'Reason', { max: 500 }),
        transactionPassword: form.transactionPassword ? undefined : 'Transaction password is required'
      })}
      onSubmit={() => adjust.mutateAsync()}
    >
      {agentTree && <StaffFloatNote />}
      <div className='grid grid-cols-2 gap-4'>
        <SelectField id='aw-op' label='Operation' value={form.operation} onChange={operation => setForm({ ...form, operation })} options={[{ value: 'credit', label: 'Credit (add)' }, { value: 'debit', label: 'Debit (remove)' }]} />
        <SelectField id='aw-cur' label='Currency' value={agentTree ? 'INR' : form.currency} onChange={currency => setForm({ ...form, currency })} options={list.map(c => ({ value: c, label: c }))} />
      </div>
      <TextField id='aw-amt' name='amount' label='Amount' required inputMode='decimal' placeholder='100.00' value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
      <TextAreaField id='aw-desc' name='description' label='Reason' required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <TextField id='aw-tp' name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required hint='Required for every balance move' value={form.transactionPassword} onChange={e => setForm({ ...form, transactionPassword: e.target.value })} />
    </FormDialog>
  )
}
