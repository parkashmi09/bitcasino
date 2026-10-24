'use client'

import { CreditCardIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

/** `GET admin/site-config/payment-gateways` — only the gateways the owner has on. */
type Gateway = { name: string; label: string; enabled: boolean }

const PATH = 'admin/site-config/payment-gateways'

/**
 * Settings → Payment Methods: the payment gateways the owner panel has switched on, each with the
 * Super Admin's own switch. Off = no new deposit or withdrawal through it and it leaves the site;
 * orders already open still settle. A gateway the owner has off is not listed.
 */
const PaymentMethods = () => {
  const { can } = useSession()
  const q = useApi<Gateway[]>(PATH)

  const set = useApiMutation({
    fn: ({ name, enabled }: { name: string; enabled: boolean }) => api.put<Gateway[]>(`${PATH}/${name}`, { enabled }),
    invalidate: [['api', PATH]],
    success: (_r, { enabled }) => (enabled ? 'Gateway is ON' : 'Gateway is OFF — no new deposits or withdrawals')
  })

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
            <div key={g.name} className='flex items-center gap-3 px-4 py-3'>
              <div className='min-w-0 flex-1'>
                <div className='font-semibold'>{g.label}</div>
                <div className='text-muted-foreground font-mono text-xs'>{g.name}</div>
              </div>
              <StatusBadge value={g.enabled ? 'enabled' : 'disabled'} />
              <Switch
                checked={g.enabled}
                disabled={!can('config:write') || set.isPending}
                onCheckedChange={enabled => set.mutate({ name: g.name, enabled })}
                aria-label={`${g.label} on or off`}
              />
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

export default PaymentMethods
