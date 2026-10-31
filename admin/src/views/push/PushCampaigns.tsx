'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { BanIcon, CalendarClockIcon, FlaskConicalIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import { DateTimeField, TextField } from '@/components/shared/FormField'
import JsonView from '@/components/shared/JsonView'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { NotificationPreview, PushStatusCard } from './PushParts'
import { imageSrc, type Audience, type Campaign, type TestResult } from './types'

const STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'] as const
const INVALIDATE = [['paged', 'admin/push/campaigns']]

const audienceText = (a: Audience) => {
  switch (a.kind) {
    case 'all':
      return 'Everyone'
    case 'players':
      return `${a.userIds.length} player(s)`
    case 'segment':
      return `Segment: ${a.segments.join(', ')}`
    case 'filters':
      return `Tags (${a.match}): ${a.filters.map(f => `${f.tag} ${f.relation} ${f.value ?? ''}`.trim()).join(a.match === 'any' ? ' OR ' : ' AND ')}`
  }
}

const Actions = ({ c, onOpen }: { c: Campaign; onOpen: () => void }) => {
  const router = useRouter()
  const [sendAt, setSendAt] = useState('')
  const [testUser, setTestUser] = useState('')
  const editable = ['draft', 'scheduled', 'failed'].includes(c.status)

  const sendAtError = sendAt && Number.isNaN(new Date(sendAt).getTime()) ? 'Pick a valid date and time' : undefined
  const testUserError = testUser ? check.id(testUser, 'Player id') : undefined

  const send = useApiMutation({
    fn: () => api.post<Campaign>(`admin/push/campaigns/${c.id}/send`),
    success: r => (r.status === 'sent' ? `Sent — ${r.accepted} accepted by OneSignal, ${r.inboxRows} inbox row(s)` : `Campaign ${r.status}`),
    invalidate: INVALIDATE
  })

  const schedule = useApiMutation({
    fn: () => {
      if (new Date(sendAt).getTime() <= new Date().getTime()) return Promise.reject(new Error('Send time must be in the future'))

      return api.post<Campaign>(`admin/push/campaigns/${c.id}/schedule`, { sendAt: new Date(sendAt).toISOString() })
    },
    success: 'Scheduled',
    invalidate: INVALIDATE
  })

  const cancel = useApiMutation({ fn: () => api.post<Campaign>(`admin/push/campaigns/${c.id}/cancel`), success: 'Cancelled', invalidate: INVALIDATE })
  const remove = useApiMutation({ fn: () => api.delete(`admin/push/campaigns/${c.id}`), success: 'Deleted', invalidate: INVALIDATE })

  const test = useApiMutation({
    fn: () => api.post<TestResult>(`admin/push/campaigns/${c.id}/test`, { userId: Number(testUser) }),
    onSuccess: r => (r.accepted ? toast.success('Test push accepted by OneSignal') : toast.warning(r.hint ?? 'OneSignal accepted nothing'))
  })

  return (
    <div className='flex flex-wrap justify-end gap-1' onClick={e => e.stopPropagation()}>
      <Button size='sm' variant='ghost' onClick={onOpen}>
        Open
      </Button>
      <Can permission='config:write'>
        {editable && (
          <Button size='sm' variant='ghost' onClick={() => router.push(`/push/compose?id=${c.id}`)} aria-label='Edit'>
            <PencilIcon />
          </Button>
        )}
        {editable && (
          <ConfirmDialog
            trigger={
              <Button size='sm' variant='ghost' aria-label='Send now'>
                <SendIcon />
              </Button>
            }
            title={`Send #${c.id} now?`}
            description={`“${c.title}” to ${audienceText(c.audience)}. A push cannot be recalled once OneSignal accepts it.`}
            confirmLabel='Send'
            onConfirm={() => send.mutateAsync()}
          />
        )}
        {editable && (
          <ConfirmDialog
            trigger={
              <Button size='sm' variant='ghost' aria-label='Schedule'>
                <CalendarClockIcon />
              </Button>
            }
            title={`Schedule #${c.id}`}
            confirmLabel='Schedule'
            confirmDisabled={!sendAt || !!sendAtError}
            onConfirm={() => schedule.mutateAsync()}
          >
            <DateTimeField id={`s-${c.id}`} label='Send at (your local time)' required error={sendAtError} value={sendAt} onChange={setSendAt} />
          </ConfirmDialog>
        )}
        {(c.status === 'draft' || c.status === 'scheduled') && (
          <ConfirmDialog
            trigger={
              <Button size='sm' variant='ghost' aria-label='Cancel'>
                <BanIcon />
              </Button>
            }
            title={`Cancel #${c.id}?`}
            confirmLabel='Cancel campaign'
            destructive
            onConfirm={() => cancel.mutateAsync()}
          />
        )}
        <ConfirmDialog
          trigger={
            <Button size='sm' variant='ghost' aria-label='Test send'>
              <FlaskConicalIcon />
            </Button>
          }
          title={`Test #${c.id} on one player`}
          description='Push only, no bell row. The player must have allowed notifications on the site while signed in.'
          confirmLabel='Send test'
          confirmDisabled={!testUser || !!testUserError}
          onConfirm={() => test.mutateAsync()}
        >
          <TextField id={`t-${c.id}`} label='Player id' required inputMode='numeric' error={testUserError} value={testUser} onChange={e => setTestUser(e.target.value.replace(/\D/g, ''))} />
        </ConfirmDialog>
        {['draft', 'cancelled', 'failed'].includes(c.status) && (
          <ConfirmDialog
            trigger={
              <Button size='sm' variant='ghost' aria-label='Delete'>
                <Trash2Icon />
              </Button>
            }
            title={`Delete #${c.id}?`}
            confirmLabel='Delete'
            destructive
            onConfirm={() => remove.mutateAsync()}
          />
        )}
      </Can>
    </div>
  )
}

const PushCampaigns = () => {
  const router = useRouter()
  const { state, set, query } = useListState(['status'])
  const [open, setOpen] = useState<Campaign | null>(null)

  const list = usePagedApi<Campaign>('admin/push/campaigns', {
    limit: query.limit,
    page: query.page,
    status: query.status || undefined
  })

  const columns: Column<Campaign>[] = [
    { key: 'id', header: '#', cell: c => <span className='text-muted-foreground font-mono text-xs'>{c.id}</span> },
    {
      key: 'title',
      header: 'Push',
      cell: c => (
        <div className='flex max-w-72 items-center gap-3'>
          {c.imageUrl ? (
             
            <img src={imageSrc(c.imageUrl) ?? ''} alt='' className='bg-muted h-8 w-16 shrink-0 rounded object-cover' />
          ) : null}
          <span className='min-w-0'>
            <span className='block truncate font-medium'>{c.name || c.title}</span>
            <span className='text-muted-foreground block truncate text-xs'>{c.name ? c.title : c.body}</span>
          </span>
        </div>
      )
    },
    { key: 'status', header: 'Status', cell: c => <StatusBadge value={c.status} /> },
    { key: 'audience', header: 'Audience', cell: c => <span className='block max-w-36 truncate text-xs'>{audienceText(c.audience)}</span> },
    {
      key: 'numbers',
      header: 'Target · accepted · bell',
      align: 'right',
      cell: c => (
        <span className='font-mono text-xs' title='Players targeted · accepted by OneSignal (not delivered) · inbox rows written'>
          {c.recipients} · {c.accepted} · {c.inboxRows}
        </span>
      )
    },
    {
      key: 'when',
      header: 'When',
      cell: c =>
        c.status === 'scheduled' && c.sendAt ? (
          <span className='text-xs'>
            due <DateTime value={c.sendAt} />
          </span>
        ) : c.sentAt ? (
          <DateTime value={c.sentAt} relative />
        ) : (
          <DateTime value={c.createdAt} relative />
        )
    },
    { key: 'error', header: 'Note', cell: c => (c.error ? <span className='text-muted-foreground block max-w-40 truncate text-xs' title={c.error}>{c.error}</span> : null) },
    { key: 'actions', header: '', align: 'right', cell: c => <Actions c={c} onOpen={() => setOpen(c)} /> }
  ]

  return (
    <div>
      <PageHeader
        title='Push campaigns'
        description='Every composed push and what happened to it. “Accepted” is what OneSignal accepted for delivery — OneSignal delivers asynchronously and does not report per-device delivery here.'
        actions={
          <Can permission='config:write'>
            <Button onClick={() => router.push('/push/compose')}>
              <PlusIcon /> Compose
            </Button>
          </Can>
        }
      />
      <PushStatusCard />
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={c => c.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        onRowClick={c => setOpen(c)}
        dense
        emptyMessage='No campaign yet. Compose one to reach your players on their devices and in the site bell.'
        toolbar={
          <Select value={String(state.status || 'any')} onValueChange={v => set({ status: !v || v === 'any' ? null : v })}>
            <SelectTrigger className='w-40' aria-label='Status'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='any'>Any status</SelectItem>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <Dialog open={open !== null} onOpenChange={o => !o && setOpen(null)}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Campaign #{open.id} <StatusBadge value={open.status} />
                </DialogTitle>
              </DialogHeader>
              <div className='grid gap-4'>
                <NotificationPreview title={open.title} body={open.body} imageUrl={open.imageUrl} iconUrl={open.iconUrl} url={open.url} buttons={open.buttons} />
                <dl className='grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 text-sm'>
                  <dt className='text-muted-foreground'>Audience</dt>
                  <dd>{audienceText(open.audience)}</dd>
                  <dt className='text-muted-foreground'>Bell rows</dt>
                  <dd>{open.inbox ? `${open.inboxRows} written` : 'off'}</dd>
                  <dt className='text-muted-foreground'>Targeted</dt>
                  <dd>{open.recipients}</dd>
                  <dt className='text-muted-foreground'>Accepted</dt>
                  <dd>{open.accepted} (by OneSignal, not delivered)</dd>
                  <dt className='text-muted-foreground'>OneSignal ids</dt>
                  <dd className='font-mono text-xs break-all'>{open.onesignalIds.length ? open.onesignalIds.join(', ') : '—'}</dd>
                  <dt className='text-muted-foreground'>Created</dt>
                  <dd>
                    <DateTime value={open.createdAt} /> {open.createdByName ? `by ${open.createdByName}` : ''}
                  </dd>
                  {open.sendAt && (
                    <>
                      <dt className='text-muted-foreground'>Scheduled</dt>
                      <dd>
                        <DateTime value={open.sendAt} />
                      </dd>
                    </>
                  )}
                  {open.sentAt && (
                    <>
                      <dt className='text-muted-foreground'>Sent</dt>
                      <dd>
                        <DateTime value={open.sentAt} />
                      </dd>
                    </>
                  )}
                  {open.error && (
                    <>
                      <dt className='text-muted-foreground'>Note</dt>
                      <dd className='text-xs break-words'>{open.error}</dd>
                    </>
                  )}
                  <dt className='text-muted-foreground'>Priority / TTL</dt>
                  <dd>
                    <Badge variant='outline'>{open.priority}</Badge> {open.ttlSeconds != null ? `${open.ttlSeconds}s` : 'default'}
                    {open.topic ? ` · topic ${open.topic}` : ''}
                  </dd>
                </dl>
                {open.data && <JsonView value={open.data} />}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default PushCampaigns
