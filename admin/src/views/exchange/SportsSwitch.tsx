'use client'

import { Loader2Icon } from 'lucide-react'

import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

type Sports = { enabled: boolean; [k: string]: unknown }

const SportsSwitch = () => {
  const { can, refreshFlags } = useSession()
  const q = useApi<Sports>('admin/site-config/sports')

  const set = useApiMutation({
    fn: (enabled: boolean) => api.put('admin/site-config/sports', { enabled }),
    invalidate: [['api', 'admin/site-config/sports'], ['api', 'admin/site-config/global']],
    success: (_r, enabled) => (enabled ? 'Sports is ON' : 'Sports is OFF — bet placement refused'),
    onSuccess: () => refreshFlags()
  })

  const on = q.data?.enabled

  return (
    <div>
      <PageHeader title='Sports switch' description='Off hides sports exchange on the website at once and refuses every new bet; open bets still settle.' />
      {q.error && <ErrorState error={q.error} />}
      <Card className='max-w-xl shadow-none'>
        <CardHeader>
          <CardTitle className='flex items-center gap-3 text-base'>
            Sports <StatusBadge value={q.isLoading ? undefined : on ? 'enabled' : 'disabled'} />
          </CardTitle>
          <CardDescription>Every change is saved in the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          {on ? (
            <ConfirmDialog
              trigger={<Button variant='destructive' disabled={!can('config:write')}>Turn sports OFF</Button>}
              title='Turn sports off?'
              description='Users will not be able to place any sports bet until it is turned back on.'
              confirmLabel='Turn off'
              destructive
              onConfirm={() => set.mutateAsync(false)}
            />
          ) : (
            <Button onClick={() => set.mutate(true)} disabled={!can('config:write') || q.isLoading || set.isPending}>
              {set.isPending && <Loader2Icon className='animate-spin' />}
              Turn sports ON
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default SportsSwitch
