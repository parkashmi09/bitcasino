'use client'

import { useState } from 'react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import JsonView from '@/components/shared/JsonView'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useListState, usePagedApi } from '@/hooks/use-api'

type Activity = {
  id: number
  action: string
  staffId: number
  staffName?: string
  actorName?: string | null
  actorRole?: string | null
  executiveId?: number | null
  service?: string
  method?: string
  path?: string
  statusCode?: number
  outcome?: string

  /** What the API sends: 'success' | 'failed'. `outcome`/`statusCode` are older shapes. */
  status?: string
  errorMessage?: string | null
  targetType?: string | null
  targetId?: string | null
  details?: Record<string, unknown> | null
  ip?: string | null
  createdAt?: string
  created_at?: string
}

const outcomeOf = (r: Activity) => {
  const v = r.status ?? r.outcome

  if (v) return v === 'success' ? 'success' : 'failed'
  const code = r.statusCode ?? Number((r.details as { statusCode?: unknown } | null)?.statusCode)

  return Number.isFinite(code) && code < 400 ? 'success' : 'failed'
}

const AuditLog = () => {
  const { state, set, query } = useListState(['status', 'action', 'staffId'])

  const list = usePagedApi<Activity>('admin/audit/activity', {
    limit: query.limit,
    page: query.page,
    q: query.search,
    status: query.status,
    action: query.action,
    staffId: query.staffId
  })

  const [selected, setSelected] = useState<Activity | null>(null)

  const columns: Column<Activity>[] = [
    { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt ?? r.created_at} /> },
    { key: 'staff', header: 'Staff', cell: r => <span>{r.actorName ?? r.staffName ?? `#${r.staffId}`}{r.executiveId ? <span className='text-muted-foreground'> · exec #{r.executiveId}</span> : null}</span> },
    { key: 'action', header: 'Action', cell: r => <code className='text-xs'>{r.action}</code> },
    { key: 'req', header: 'Request', cell: r => <span className='font-mono text-xs'>{r.method} {r.path}</span> },
    { key: 'target', header: 'Target', cell: r => (r.targetType ? <Badge variant='outline'>{r.targetType} {r.targetId}</Badge> : '—') },
    { key: 'outcome', header: 'Outcome', cell: r => <StatusBadge value={outcomeOf(r)} /> },
    { key: 'ip', header: 'IP', cell: r => <span className='font-mono text-xs'>{r.ip ?? '—'}</span> }
  ]

  return (
    <div>
      <PageHeader title='Activity log' description='Every staff write, who did it, against what, and whether the platform accepted it.' />
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        search={String(state.search ?? '')}
        onSearchChange={search => set({ search })}
        searchPlaceholder='Search path, target, details…'
        onRowClick={setSelected}
        dense
        toolbar={
          <>
            <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
              <SelectTrigger className='w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>Any outcome</SelectItem>
                <SelectItem value='success'>Success</SelectItem>
                <SelectItem value='failed'>Failed</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder='Action (e.g. staff.create)' className='w-52' value={String(state.action ?? '')} onChange={e => set({ action: e.target.value })} />
            <Input placeholder='Staff id' className='w-28' value={String(state.staffId ?? '')} onChange={e => set({ staffId: e.target.value.replace(/\D/g, '') })} />
          </>
        }
      />
      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {selected?.action} · <DateTime value={selected?.createdAt ?? selected?.created_at} />
            </DialogTitle>
          </DialogHeader>
          <JsonView value={selected} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AuditLog
