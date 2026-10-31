'use client'

import { useState } from 'react'

import { CreditCardIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'

/**
 * `GET admin/site-config/payment-gateways` — only the gateways the owner has on. F2Pay also lists the
 * currencies the owner has on (INR, crypto) with their methods — shown only: the owner picks them.
 */
type Method = { id: number; code: string }
type Currency = { code: string; key: string; label: string; methods: Method[] }
type Gateway = { name: string; label: string; enabled: boolean; currencies?: Currency[] }

/** A change waiting for the transaction password: what it says, and the request that makes it. */
type Pending = { title: string; turnsOff: boolean; done: string; send: (transactionPassword: string) => Promise<unknown> }

const PATH = 'admin/site-config/payment-gateways'

/**
 * Settings → Payment Methods: the payment gateways the owner panel has switched on, each with the
 * Super Admin's own ON / OFF switch — the only thing the Super Admin changes here (user, 2026-10-24).
 * F2Pay's active currencies and methods are listed under it. A switch asks for the transaction
 * password; the site stores who made it.
 */
const PaymentMethods = () => {
  const { can } = useSession()
  const q = useApi<Gateway[]>(PATH)
  const [pending, setPending] = useState<Pending | null>(null)
  const [password, setPassword] = useState('')
  const editable = can('config:write')

  const run = useApiMutation({
    fn: () => pending!.send(password),
    invalidate: [['api', PATH]],
    success: () => pending?.done ?? 'Saved',
    onSuccess: () => {
      setPending(null)
      setPassword('')
    }
  })

  /** A switch row's badge + switch; flipping it asks for the transaction password. */
  const toggle = (label: string, enabled: boolean, path: string) => (
    <>
      <StatusBadge value={enabled ? 'enabled' : 'disabled'} />
      <Switch
        checked={enabled}
        disabled={!editable || run.isPending}
        aria-label={`${label} on or off`}
        onCheckedChange={on =>
          setPending({
            title: `Switch ${label} ${on ? 'ON' : 'OFF'}?`,
            turnsOff: !on,
            done: `${label} is ${on ? 'ON' : 'OFF'}`,
            send: transactionPassword => api.put(path, { enabled: on, transactionPassword })
          })
        }
      />
    </>
  )

  return (
    <div>
      <PageHeader title='Payment Methods' description='The payment gateways the owner has enabled. Switch one off to stop new deposits and withdrawals through it; open orders still settle.' />
      {q.error ? (
        <ErrorState error={q.error} />
      ) : q.isLoading ? (
        <Skeleton className='h-40 w-full max-w-xl' />
      ) : !q.data?.length ? (
        <Card className='max-w-xl items-center gap-2 py-10 text-center shadow-none'>
          <CreditCardIcon className='text-border size-10' />
          <div className='font-semibold'>No payment gateway enabled</div>
          <div className='text-muted-foreground text-sm'>The owner has not enabled any payment gateway for this site.</div>
        </Card>
      ) : (
        <Card className='max-w-xl gap-0 divide-y py-0 shadow-none'>
          {q.data.map(g => (
            <div key={g.name}>
              <div className='flex items-center gap-3 px-4 py-3'>
                <div className='min-w-0 flex-1'>
                  <div className='font-semibold'>{g.label}</div>
                  <div className='text-muted-foreground font-mono text-xs'>{g.name}</div>
                </div>
                {toggle(g.label, g.enabled, `${PATH}/${g.name}`)}
              </div>
              {g.currencies?.map(c => (
                <div key={c.key} className='flex items-center gap-2 py-2 ps-8 pe-4'>
                  <div className='min-w-24 text-sm font-semibold'>{c.label}</div>
                  <div className='flex flex-wrap gap-1'>
                    {c.methods.map(m => (
                      <Badge key={m.id} variant='outline' className='font-mono'>
                        {m.code}
                      </Badge>
                    ))}
                    {!c.methods.length && <span className='text-muted-foreground text-xs'>No method yet</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
      <FormDialog
        trigger={null}
        open={pending !== null}
        onOpenChange={o => !o && setPending(null)}
        title={pending?.title ?? ''}
        description={pending?.turnsOff ? 'Players stop being offered it until you switch it back on. Open orders still settle.' : 'Players will be offered it.'}
        submitLabel='Confirm'
        destructive={pending?.turnsOff}
        validate={() => (password ? null : { transactionPassword: 'Transaction password is required' })}
        onSubmit={() => run.mutateAsync()}
      >
        <TextField id='payment-methods-tp' name='transactionPassword' label={<TxnPasswordLabel />} type='password' value={password} onChange={e => setPassword(e.target.value)} />
      </FormDialog>
    </div>
  )
}

export default PaymentMethods
