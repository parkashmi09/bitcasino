'use client'

import { RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import DateTime from '@/components/shared/DateTime'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { featureLabel, flagLabel } from '@/configs/entitlementCatalogue'
import { useApi } from '@/hooks/use-api'
import { toastError } from '@/lib/api/feedback'
import { deviceOf } from '@/lib/entitlements/device'
import type { AuditEntry } from '@/lib/entitlements/types'
import ChangeList from '@/views/entitlements/ChangeList'

/** One label/value row of the details list; empty values are left out. */
const Detail = ({ label, value }: { label: string; value?: string | number | boolean | null }) =>
  value === undefined || value === null || value === '' ? null : (
    <div className='grid grid-cols-[7.5rem_1fr] gap-2'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='font-mono break-all'>{String(value)}</dd>
    </div>
  )

/** Where a save came from: the browser's ip and device, the API path, and — on expand — every recorded detail. */
const Source = ({ row }: { row: AuditEntry }) => {
  const { client, caller } = row

  if (!client && !caller) return <span className='text-muted-foreground text-xs'>Not recorded (saved before details were logged)</span>

  // Through this server's panel the backend sees loopback, so the browser's ip is the one that matters;
  // anything else called the site API directly with the owner key (a panel running elsewhere, or a script).
  const direct = caller && caller.local === false
  const ip = client?.ip ?? caller?.ip ?? null
  const device = deviceOf(client?.userAgent, client?.platform, client?.mobile)

  return (
    <div className='flex min-w-56 flex-col gap-1 text-xs'>
      <div className='flex flex-wrap items-center gap-1.5'>
        <span className='font-mono text-sm'>{ip ?? 'unknown ip'}</span>
        {direct ? (
          <Badge variant='destructive' className='text-[10px]'>
            Direct API call
          </Badge>
        ) : caller ? (
          <Badge variant='secondary' className='text-[10px]'>
            Owner panel
          </Badge>
        ) : null}
      </div>
      {device ? <span>{device}</span> : null}
      {direct && caller?.ip !== ip ? <span className='text-muted-foreground'>API reached from {caller?.ip}</span> : null}
      <span className='text-muted-foreground font-mono'>{client?.api ?? (caller ? `${caller.method} ${caller.path}` : '')}</span>
      <details className='mt-0.5'>
        <summary className='text-primary cursor-pointer select-none'>All details</summary>
        <dl className='mt-1.5 flex flex-col gap-1'>
          <p className='font-medium'>Browser (as the owner panel saw it)</p>
          {client ? (
            <>
              <Detail label='IP' value={client.ip} />
              <Detail label='X-Forwarded-For' value={client.forwardedFor} />
              <Detail label='Device' value={device} />
              <Detail label='Platform hint' value={client.platform} />
              <Detail label='Mobile' value={client.mobile === undefined ? undefined : client.mobile ? 'yes' : 'no'} />
              <Detail label='Browser hint' value={client.browser} />
              <Detail label='Language' value={client.language} />
              <Detail label='Origin' value={client.origin} />
              <Detail label='Page' value={client.referer} />
              <Detail label='Panel API' value={client.api} />
              <Detail label='User-Agent' value={client.userAgent} />
            </>
          ) : (
            <p className='text-muted-foreground'>None sent — the save did not come through a browser on an up-to-date owner panel.</p>
          )}
          <p className='mt-1 font-medium'>Site API call (as the site&apos;s server saw it)</p>
          {caller ? (
            <>
              <Detail label='API' value={`${caller.method ?? ''} ${caller.path ?? ''}`.trim()} />
              <Detail label='Caller IP' value={caller.ip} />
              <Detail label='Caller' value={caller.local ? 'owner panel on this server' : 'outside this server (holds the owner key)'} />
              <Detail label='Caller User-Agent' value={caller.userAgent} />
            </>
          ) : (
            <p className='text-muted-foreground'>Not recorded.</p>
          )}
        </dl>
      </details>
    </div>
  )
}

const AuditLog = () => {
  const { data, error, isLoading, isFetching, refetch } = useApi<AuditEntry[]>('/api/owner/audit')

  const refresh = async () => {
    const r = await refetch()

    if (r.error) toastError(r.error, 'Could not refresh the audit log')
    else toast.success('Audit log refreshed', { description: `${r.data?.length ?? 0} save${r.data?.length === 1 ? '' : 's'}` })
  }

  return (
    <>
      <PageHeader
        title='Audit log'
        description='Every entitlement save, newest first, with the IP, device and API call it came from. Stored in the site database (owner_audit).'
        actions={
          <Button variant='outline' onClick={() => void refresh()} disabled={isFetching}>
            <RefreshCwIcon className={isFetching ? 'animate-spin' : undefined} /> Refresh
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} title='Could not load the audit log' onRetry={refetch} retrying={isFetching} />
      ) : (
        <Card className='py-0 shadow-none'>
          <CardContent className='px-0'>
            {isLoading ? (
              <Skeleton className='m-4 h-40' />
            ) : !data?.length ? (
              <p className='text-muted-foreground p-6 text-sm'>No saves yet. The site runs on the defaults: everything entitled.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='pl-4'>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>From (IP · device · API)</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map(row => (
                    <TableRow key={`${row.version}-${row.at}`} className='align-top'>
                      <TableCell className='pl-4'>
                        <DateTime value={row.at} />
                      </TableCell>
                      <TableCell>{row.user}</TableCell>
                      <TableCell className='whitespace-normal'>
                        <Source row={row} />
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline' className='font-mono'>
                          v{row.version}
                        </Badge>
                      </TableCell>
                      <TableCell className='whitespace-normal'>
                        <ChangeList changes={row.changes} labelOf={c => (typeof c.key !== 'string' ? String(c.kind ?? '(unknown)') : c.kind === 'feature' ? featureLabel(c.key) : flagLabel(c.key))} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}

export default AuditLog
