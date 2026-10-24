'use client'

import { useState } from 'react'

import { CreditCardIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'

/**
 * `GET admin/site-config/payment-gateways` — only the gateways the owner has on. A gateway switched per
 * currency (F2Pay) also lists the currencies the owner has on, each with its own switch (`key`).
 */
type Currency = { key: string; label: string; enabled: boolean }
type Gateway = { name: string; label: string; enabled: boolean; currencies?: Currency[] }

/** One switch about to change: a gateway (`apay`) or one of its currencies (`f2pay_idr`). */
type Pending = { name: string; label: string; enabled: boolean }

const PATH = 'admin/site-config/payment-gateways'

/**
 * Settings → Payment Methods: the payment gateways the owner panel has switched on, each with the
 * Super Admin's own switch — and, for F2Pay, one switch per currency (a player depositing in a
 * currency that is off is not offered F2Pay). Off = no new deposit or withdrawal through it; orders
 * already open still settle. Every change asks for the transaction password.
 */
const PaymentMethods = () => {
  const { can } = useSession()
  const q = useApi<Gateway[]>(PATH)
  const [pending, setPending] = useState<Pending | null>(null)
  const [password, setPassword] = useState('')

  const set = useApiMutation({
    fn: () => api.put<Gateway[]>(`${PATH}/${pending?.name}`, { enabled: pending?.enabled, transactionPassword: password }),
    invalidate: [['api', PATH]],
    success: () => `${pending?.label} is ${pending?.enabled ? 'ON' : 'OFF'}`,
    onSuccess: () => {
      setPending(null)
      setPassword('')
    }
  })

  const toggle = (row: { name: string; label: string; enabled: boolean }) => (
    <>
      <StatusBadge value={row.enabled ? 'enabled' : 'disabled'} />
      <Switch
        checked={row.enabled}
        disabled={!can('config:write') || set.isPending}
        onCheckedChange={enabled => setPending({ name: row.name, label: row.label, enabled })}
        aria-label={`${row.label} on or off`}
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
                {toggle(g)}
              </div>
              {g.currencies?.map(c => (
                <div key={c.key} className='flex items-center gap-3 py-2 ps-8 pe-4'>
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm'>{c.label}</div>
                    <div className='text-muted-foreground font-mono text-xs'>{c.key}</div>
                  </div>
                  {toggle({ name: c.key, label: `${g.label} · ${c.label}`, enabled: c.enabled })}
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
        title={`Switch ${pending?.label} ${pending?.enabled ? 'ON' : 'OFF'}?`}
        description={pending?.enabled ? 'Players will be offered it again.' : 'No new deposits or withdrawals through it until you switch it back on. Open orders still settle.'}
        submitLabel={pending?.enabled ? 'Switch ON' : 'Switch OFF'}
        destructive={pending?.enabled === false}
        validate={() => (password ? null : { transactionPassword: 'Transaction password is required' })}
        onSubmit={() => set.mutateAsync()}
      >
        <TextField id='payment-methods-tp' name='transactionPassword' label={<TxnPasswordLabel />} type='password' value={password} onChange={e => setPassword(e.target.value)} />
      </FormDialog>
    </div>
  )
}

export default PaymentMethods
