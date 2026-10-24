'use client'

import { useState } from 'react'

import Link from 'next/link'

import { CheckIcon, XIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { TextAreaField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatDate } from '@/lib/format'
import { check } from '@/lib/validate'
import { DOCUMENT_FIELDS, KYC_STATUSES, type KycApplication, type KycStatus } from './types'

const LIST = 'admin/user/kyc/applications'

const columns: Column<KycApplication>[] = [
  {
    key: 'name',
    header: 'Applicant',
    cell: r => (
      <div className='flex flex-col'>
        <span className='font-medium'>
          {r.firstName} {r.lastName}
        </span>
        <Link href={`/users/${r.userId}`} className='text-muted-foreground font-mono text-xs hover:underline' onClick={e => e.stopPropagation()}>
          user #{r.userId}
        </Link>
      </div>
    )
  },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'doc', header: 'Document', cell: r => <Badge variant='outline'>{r.documentType?.replace(/_/g, ' ')}</Badge> },
  { key: 'country', header: 'Country', cell: r => r.country ?? '—' },
  {
    key: 'files',
    header: 'Files',
    cell: r => (
      <span className='flex gap-1'>
        {DOCUMENT_FIELDS.filter(d => r.documents?.[d.field]).map(d => (
          <Badge key={d.field} variant='secondary' className='font-normal'>
            {d.label}
          </Badge>
        ))}
      </span>
    )
  },
  { key: 'submitted', header: 'Submitted', cell: r => <DateTime value={r.submittedAt} /> },
  { key: 'reviewed', header: 'Reviewed', cell: r => <DateTime value={r.status === 'Pending' ? null : r.reviewedAt} relative /> }
]

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>{label}</p>
    <p className='text-sm'>{value ?? '—'}</p>
  </div>
)

const KycDetail = ({ app, onClose }: { app: KycApplication | null; onClose: () => void }) => {
  const [reason, setReason] = useState('')
  const invalidate = [['paged', LIST]]

  const review = useApiMutation({
    fn: (status: KycStatus) => api.put('admin/user/kyc/review', { userId: Number(app?.userId), status, ...(status === 'Rejected' ? { rejectionReason: reason.trim() } : {}) }),
    invalidate,
    success: (_r, status) => `KYC marked ${status}`,
    onSuccess: () => {
      setReason('')
      onClose()
    }
  })

  return (
    <Dialog open={!!app} onOpenChange={o => !o && onClose()}>
      <DialogContent className='sm:max-w-4xl'>
        {app && (
          <>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2'>
                {app.firstName} {app.lastName} <StatusBadge value={app.status} />
              </DialogTitle>
              <DialogDescription>
                KYC #{app.id} · user <Link href={`/users/${app.userId}`} className='underline'>#{app.userId}</Link> · submitted {formatDate(app.submittedAt)}
              </DialogDescription>
            </DialogHeader>
            <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
              <Field label='Gender' value={app.gender} />
              <Field label='Date of birth' value={formatDate(app.dateOfBirth, false)} />
              <Field label='Document type' value={app.documentType?.replace(/_/g, ' ')} />
              <Field label='Country' value={app.country} />
              <Field label='City' value={app.city} />
              <div className='col-span-2 sm:col-span-3'>
                <Field label='Address' value={app.address} />
              </div>
              {app.rejectionReason && (
                <div className='col-span-2 sm:col-span-4'>
                  <Field label='Rejection reason' value={app.rejectionReason} />
                </div>
              )}
            </div>
            <div className='grid gap-3 sm:grid-cols-3'>
              {DOCUMENT_FIELDS.map(d => (
                <div key={d.field} className='rounded-md border p-2'>
                  <p className='text-muted-foreground mb-1 text-xs font-medium'>{d.label}</p>
                  {app.documents?.[d.field] ? (
                    <a href={api.url(`admin/user/kyc/documents/${app.id}/${d.field}`)} target='_blank' rel='noreferrer'>
                      <img src={api.url(`admin/user/kyc/documents/${app.id}/${d.field}`)} alt={d.label} className='bg-muted h-44 w-full rounded object-contain' />
                    </a>
                  ) : (
                    <div className='bg-muted/50 text-muted-foreground flex h-44 items-center justify-center rounded text-xs'>not uploaded</div>
                  )}
                </div>
              ))}
            </div>
            <Can permission='users:write'>
              <div className='flex justify-end gap-2'>
                <FormDialog
                  trigger={
                    <Button variant='destructive' disabled={app.status === 'Rejected'}>
                      <XIcon /> Reject
                    </Button>
                  }
                  title='Reject this application'
                  description='The reason is shown to the user.'
                  submitLabel='Reject'
                  destructive
                  validate={() => ({ rejectionReason: check.required(reason, 'Reason') ?? check.length(reason, 'Reason', { max: 500 }) })}
                  onSubmit={() => review.mutateAsync('Rejected')}
                >
                  <TextAreaField id='kyc-reason' name='rejectionReason' label='Reason' required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
                </FormDialog>
                <ConfirmDialog
                  trigger={
                    <Button disabled={app.status === 'Verified'}>
                      <CheckIcon /> Approve
                    </Button>
                  }
                  title='Approve this application?'
                  description='Marks the user as Verified; this unlocks withdrawals.'
                  confirmLabel='Approve'
                  onConfirm={() => review.mutateAsync('Verified')}
                />
              </div>
            </Can>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const StatusChip = ({ status, active, onClick }: { status: string; active: boolean; onClick: () => void }) => {
  const count = usePagedApi<KycApplication>(LIST, { limit: 1, page: 1, status: status || undefined })

  return (
    <Button size='sm' variant={active ? 'default' : 'outline'} onClick={onClick}>
      {status || 'All'}
      <Badge variant='secondary' className='ml-1'>
        {count.error ? '–' : (count.data?.pagination.total ?? '…')}
      </Badge>
    </Button>
  )
}

/** The KYC list — direct users only (the backend never lists an agent's player). */
const KycList = () => {
  // Defaults to the Pending queue; 'all' is the sentinel for no filter (a blank would fall back to the default).
  const { state, set, query } = useListState(['status'], { status: 'Pending' })
  const status = state.status === 'all' ? undefined : query.status
  const list = usePagedApi<KycApplication>(LIST, { limit: query.limit, page: query.page, search: query.search, status })
  const [selected, setSelected] = useState<KycApplication | null>(null)

  return (
    <>
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
        searchPlaceholder='Name…'
        onRowClick={setSelected}
        toolbar={
          <div className='flex flex-wrap gap-1'>
            <StatusChip status='' active={state.status === 'all'} onClick={() => set({ status: 'all' })} />
            {KYC_STATUSES.map(s => (
              <StatusChip key={s} status={s} active={state.status === s} onClick={() => set({ status: s })} />
            ))}
          </div>
        }
      />
      <KycDetail app={selected} onClose={() => setSelected(null)} />
    </>
  )
}

/** KYC review — direct users only: an agent's player cannot submit KYC (docs/KYC.md). */
const KycQueue = () => (
  <div>
    <PageHeader title='KYC review' description='Identity applications from direct users. Open one to see the documents and approve or reject it.' />
    <KycList />
  </div>
)

export default KycQueue
