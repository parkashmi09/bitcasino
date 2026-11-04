'use client'

import Link from 'next/link'

import { ChartColumnIcon, EyeIcon, PlusIcon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useListState, usePagedApi } from '@/hooks/use-api'

import type { Whitelabel } from './types'

const BASE = 'admin/whitelabels'
const STATUSES = ['queued', 'creating', 'live', 'failed', 'deleting', 'deleted']

const WhitelabelsList = () => {
  const { state, set, query } = useListState(['status'])
  const list = usePagedApi<Whitelabel>(BASE, { limit: query.limit, page: query.page, search: query.search, status: query.status })

  const columns: Column<Whitelabel>[] = [
    {
      key: 'name',
      header: 'Whitelabel',
      cell: r => (
        <Link href={`/whitelabels/${r.id}`} className='grid hover:underline'>
          <span className='font-medium'>{r.name}</span>
          <span className='text-muted-foreground font-mono text-xs'>{r.slug}</span>
        </Link>
      )
    },
    {
      key: 'status',
      header: 'Status',
      cell: r => (
        <div className='flex items-center gap-1.5'>
          <StatusBadge value={r.status} />
          {r.status === 'live' && r.maintenance && <Badge variant='outline'>Off</Badge>}
        </div>
      )
    },
    { key: 'site', header: 'Player site', cell: r => <span className='font-mono text-xs'>{r.siteDomain}</span> },
    { key: 'admin', header: 'Admin', cell: r => <span className='font-mono text-xs'>{r.adminDomain}</span> },
    { key: 'company', header: 'Company', cell: r => r.companyName },
    { key: 'created', header: 'Created', cell: r => <DateTime value={r.createdAt} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <div className='flex justify-end gap-1'>
          {!['queued', 'creating'].includes(r.status) && (
            <Button variant='ghost' size='sm' nativeButton={false} render={<Link href={`/whitelabels/report?id=${r.id}`} />}>
              <ChartColumnIcon /> Report
            </Button>
          )}
          <Button variant='ghost' size='icon-sm' aria-label='Open' title='Open' nativeButton={false} render={<Link href={`/whitelabels/${r.id}`} />}>
            <EyeIcon />
          </Button>
        </div>
      )
    }
  ]

  return (
    <div>
      <PageHeader
        title='Whitelabels'
        description='Full copies of this site on their own domains. Each is run by its company, whose balance comes only from your transfers.'
        actions={
          <div className='flex gap-2'>
            <Button variant='outline' nativeButton={false} render={<Link href='/whitelabels/report' />}>
              Revenue share report
            </Button>
            <Button nativeButton={false} render={<Link href='/whitelabels/new' />}>
              <PlusIcon /> New whitelabel
            </Button>
          </div>
        }
      />
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
        searchPlaceholder='Name, short name or domain…'
        toolbar={
          <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Any status</SelectItem>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}

export default WhitelabelsList
