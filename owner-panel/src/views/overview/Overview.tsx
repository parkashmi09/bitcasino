'use client'

import Link from 'next/link'

import { toast } from 'sonner'
import { ActivityIcon, BanIcon, PaletteIcon, RefreshCwIcon, ShieldCheckIcon, TagIcon } from 'lucide-react'

import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { templateByKey, templateLabel } from '@/configs/templateCatalogue'
import { useApi } from '@/hooks/use-api'
import { toastError } from '@/lib/api/feedback'
import type { Overview as OverviewData, Probe } from '@/lib/entitlements/types'

const ProbeRow = ({ label, probe }: { label: string; probe: Probe }) => (
  <TableRow>
    <TableCell className='font-medium'>{label}</TableCell>
    <TableCell className='text-muted-foreground font-mono text-xs'>{probe.url || '—'}</TableCell>
    <TableCell>
      <StatusBadge value={probe.ok ? 'active' : 'failed'} />
    </TableCell>
    <TableCell className='text-muted-foreground text-xs tabular-nums'>
      {probe.status ?? probe.error ?? '—'}
      {probe.ms !== null && ` · ${probe.ms} ms`}
    </TableCell>
  </TableRow>
)

const Overview = () => {
  const { data, error, isLoading, refetch, isFetching } = useApi<OverviewData>('/api/owner/overview')
  const template = templateByKey(data?.entitlements.template)

  const refresh = async () => {
    const r = await refetch()

    if (r.error) toastError(r.error, 'Could not refresh the overview')
    else {
      const down = r.data ? Object.values(r.data.health).filter(p => !p.ok).length : 0

      if (down) toast.warning('Refreshed', { description: `${down} app${down === 1 ? '' : 's'} not answering — see Reachability.` })
      else toast.success('Refreshed', { description: 'Every app answers.' })
    }
  }

  return (
    <>
      <PageHeader
        title={data?.site.name ?? 'Overview'}
        description={data ? `Site key ${data.site.key}. What this site is entitled to, and whether its apps answer.` : 'Loading…'}
        actions={
          <Button variant='outline' onClick={() => void refresh()} disabled={isFetching}>
            <RefreshCwIcon className={isFetching ? 'animate-spin' : undefined} /> Refresh
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} title='Could not load the overview' onRetry={refetch} retrying={isFetching} />
      ) : (
        <div className='flex flex-col gap-6'>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
            <StatCard
              label='Template'
              icon={<PaletteIcon />}
              loading={isLoading}
              value={
                data ? (
                  <span className='flex items-center gap-2'>
                    {template && (
                      <span className='inline-flex size-5 items-center justify-center rounded-sm border' style={{ backgroundColor: template.swatch.background }} aria-hidden>
                        <span className='size-2.5 rounded-xs' style={{ backgroundColor: template.swatch.accent }} />
                      </span>
                    )}
                    {templateLabel(data.entitlements.template)}
                  </span>
                ) : (
                  '—'
                )
              }
              hint={<Link href='/entitlements' className='underline-offset-4 hover:underline'>Set by the owner · change</Link>}
            />
            <StatCard label='Entitlement version' icon={<TagIcon />} loading={isLoading} value={data ? `v${data.entitlements.version}` : '—'} hint={data && <DateTime value={data.entitlements.updatedAt} relative />} />
            <StatCard
              label='Last save'
              icon={<ActivityIcon />}
              loading={isLoading}
              value={data?.entitlements.lastSave ? <DateTime value={data.entitlements.lastSave.at} relative /> : 'Never'}
              hint={data?.entitlements.lastSave ? `${data.entitlements.lastSave.user} · ${data.entitlements.lastSave.changes.length} change(s)` : 'Defaults: everything entitled'}
            />
            <StatCard label='Entitled' icon={<ShieldCheckIcon />} loading={isLoading} value={data?.entitlements.entitled ?? '—'} hint={data && `of ${data.entitlements.total} features and flags`} />
            <StatCard label='Blocked' icon={<BanIcon />} loading={isLoading} value={data?.entitlements.blocked ?? '—'} hint={<Link href='/entitlements' className='underline-offset-4 hover:underline'>Manage features &amp; plan</Link>} />
          </div>
          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle>Reachability</CardTitle>
              <CardDescription>Anonymous checks from this panel: gateway /health, then the admin and frontend home pages.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading || !data ? (
                <Skeleton className='h-32 w-full' />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>App</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <ProbeRow label='Backend gateway' probe={data.health.gateway} />
                    <ProbeRow label='Site admin' probe={data.health.admin} />
                    <ProbeRow label='Frontend' probe={data.health.frontend} />
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

export default Overview
