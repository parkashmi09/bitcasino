'use client'

import { useState } from 'react'

import { CreditCardIcon, PlusIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'

/**
 * `GET admin/site-config/payment-gateways` — only the gateways the owner has on. A gateway switched per
 * currency (F2Pay) also lists the currencies the owner has on, each with its own switch (`key`) and its
 * deposit methods (`payment_methods` rows the owner has on; `enabled` is the Super Admin's switch).
 */
type Method = { id: number; code: string; enabled: boolean; addedBy: 'owner' | 'site' }
type Currency = { code: string; key: string; label: string; enabled: boolean; methods: Method[] }
type Gateway = { name: string; label: string; enabled: boolean; currencies?: Currency[] }

/** A change waiting for the transaction password: what it says, and the request that makes it. */
type Pending = { title: string; turnsOff: boolean; done: string; send: (transactionPassword: string) => Promise<unknown> }

const PATH = 'admin/site-config/payment-gateways'
const METHOD_CODE = /^[A-Za-z0-9_]{1,40}$/

/**
 * Settings → Payment Methods: the payment gateways the owner panel has switched on, each with the
 * Super Admin's own switch — and, for F2Pay, one switch per currency and per method, plus "Add
 * method". A player is offered a method only when its gateway, currency and the method are all on.
 * Every change asks for the transaction password; the site stores who made it.
 */
const PaymentMethods = () => {
  const { can } = useSession()
  const q = useApi<Gateway[]>(PATH)
  const [pending, setPending] = useState<Pending | null>(null)
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<Record<string, string>>({})
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

  const addMethod = (g: Gateway, c: Currency) => {
    const code = (codes[c.key] ?? '').trim()

    setPending({
      title: `Add ${code} to ${g.label} · ${c.label}?`,
      turnsOff: false,
      done: `${code} added to ${c.label}`,
      send: transactionPassword => api.post(`${PATH}/${g.name}/methods`, { currency: c.code, code, transactionPassword }).then(() => setCodes(s => ({ ...s, [c.key]: '' })))
    })
  }

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
              {g.currencies?.map(c => {
                const code = (codes[c.key] ?? '').trim()
                const bad = code && (!METHOD_CODE.test(code) || c.methods.some(m => m.code === code))

                return (
                  <div key={c.key} className='pb-2'>
                    <div className='flex items-center gap-3 py-2 ps-8 pe-4'>
                      <div className='min-w-0 flex-1'>
                        <div className='text-sm font-semibold'>{c.label}</div>
                        <div className='text-muted-foreground font-mono text-xs'>{c.key}</div>
                      </div>
                      {toggle(`${g.label} · ${c.label}`, c.enabled, `${PATH}/${c.key}`)}
                    </div>
                    {c.methods.map(m => (
                      <div key={m.id} className='flex items-center gap-3 py-1.5 ps-14 pe-4'>
                        <div className='flex min-w-0 flex-1 items-center gap-2'>
                          <span className='font-mono text-sm'>{m.code}</span>
                          <Badge variant='outline'>{m.addedBy === 'owner' ? 'owner' : 'site'}</Badge>
                        </div>
                        {toggle(`${c.label} ${m.code}`, m.enabled, `${PATH}/${g.name}/methods/${m.id}`)}
                      </div>
                    ))}
                    {!c.methods.length && <div className='text-muted-foreground py-1.5 ps-14 pe-4 text-xs'>No {c.label} method yet — players are not offered {g.label} in {c.label}.</div>}
                    {editable && (
                      <div className='flex items-center gap-2 py-1.5 ps-14 pe-4'>
                        <Input
                          value={codes[c.key] ?? ''}
                          placeholder='Method code (e.g. QRIS)'
                          aria-label={`New ${c.label} method code`}
                          aria-invalid={Boolean(bad)}
                          className='h-8 w-48'
                          onChange={e => setCodes(s => ({ ...s, [c.key]: e.target.value }))}
                        />
                        <Button type='button' size='sm' variant='outline' disabled={!code || Boolean(bad) || run.isPending} onClick={() => addMethod(g, c)}>
                          <PlusIcon /> Add method
                        </Button>
                        {bad && <span className='text-destructive text-xs'>{METHOD_CODE.test(code) ? 'Already listed' : 'Letters, digits and _ only'}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
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
