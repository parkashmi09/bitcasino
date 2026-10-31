'use client'

import { useState } from 'react'

import { MegaphoneIcon, PencilIcon, SendIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextAreaField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { NOTIFICATION_TYPES, type Device, type NotificationRow, type SentNotification } from './types'

const TYPE_OPTIONS = NOTIFICATION_TYPES.map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))

const SENDS = 'admin/notifications/sends'


const Compose = ({ channel }: { channel: Channel }) => {
  const [mode, setMode] = useState<'broadcast' | 'user'>('broadcast')
  const [form, setForm] = useState({ userId: '', title: '', body: '', type: 'general' })

  // Agent users get general notifications only.
  const agentTab = channel === 'agent'
  const audience = agentTab ? 'agent users' : 'direct users'

  const send = useApiMutation({
    fn: () => {
      const message: Record<string, string> = { title: form.title, type: agentTab ? 'general' : form.type, channel }

      if (form.body) message.body = form.body

      return mode === 'broadcast'
        ? api.post<{ sent?: number; devices?: number }>('admin/notifications/broadcast', message)
        : api.post<{ sent?: number; devices?: number }>('admin/notifications/send', { userId: Number(form.userId), ...message })
    },
    success: r => `Queued — ${r?.sent ?? r?.devices ?? 0} device(s)`,
    invalidate: [['paged', SENDS]],
    onSuccess: () => setForm({ ...form, title: '', body: '' })
  })

  const userIdError = mode === 'user' && form.userId ? check.id(form.userId, 'User id') : undefined
  const ready = form.title.trim().length > 0 && form.title.length <= 200 && form.body.length <= 1000 && (mode === 'broadcast' || (!!form.userId && !userIdError))

  return (
    <Card className='max-w-2xl shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Send a push notification</CardTitle>
        <CardDescription>
          {agentTab ? 'Goes to agent users only, general notifications only.' : 'Goes to direct users only.'} A broadcast is capped by the platform so a mistake is refused rather than delivered.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        <Tabs value={mode} onValueChange={v => setMode(v as 'broadcast' | 'user')}>
          <TabsList>
            <TabsTrigger value='broadcast'>All users</TabsTrigger>
            <TabsTrigger value='user'>One user</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'user' && (
          <TextField id='n-uid' label='User id' required inputMode='numeric' error={userIdError} value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value.replace(/\D/g, '') })} />
        )}
        <TextField id='n-title' label='Title' required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        <TextAreaField id='n-body' label='Body' rows={3} maxLength={1000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
        <SelectField id='n-type' label='Type' value={agentTab ? 'general' : form.type} onChange={type => setForm({ ...form, type })} options={agentTab ? TYPE_OPTIONS.filter(o => o.value === 'general') : TYPE_OPTIONS} />
        <Can permission='config:write'>
          <ConfirmDialog
            trigger={
              <Button disabled={!ready} className='justify-self-start'>
                {mode === 'broadcast' ? <MegaphoneIcon /> : <SendIcon />}
                {mode === 'broadcast' ? 'Broadcast' : 'Send'}
              </Button>
            }
            title={mode === 'broadcast' ? `Send to every ${audience.slice(0, -1)}?` : `Send to user ${form.userId}?`}
            description={`“${form.title}” goes to ${audience} only. A push cannot be recalled once it is delivered.`}
            confirmLabel='Send'
            onConfirm={() => send.mutateAsync()}
          />
        </Can>
        {!ready && <p className='text-muted-foreground -mt-2 text-xs'>{mode === 'user' && !form.userId ? 'Enter a user id and a title to send.' : 'A title is required to send.'}</p>}
      </CardContent>
    </Card>
  )
}

const EditSent = ({ row }: { row: SentNotification }) => {
  const [form, setForm] = useState({ title: row.title, body: row.body ?? '' })

  const save = useApiMutation({
    fn: () => api.patch(`${SENDS}/${row.sendId}`, { title: form.title, body: form.body }),
    success: 'Notification updated',
    invalidate: [['paged', SENDS]]
  })

  return (
    <FormDialog
      trigger={
        <Button size='icon' variant='ghost' aria-label='Edit'>
          <PencilIcon />
        </Button>
      }
      title='Edit notification'
      description='Changes the copy in every inbox it went to. A push already delivered stays as it was.'
      onOpenChange={open => open && setForm({ title: row.title, body: row.body ?? '' })}
      submitDisabled={!form.title.trim()}
      onSubmit={async () => {
        await save.mutateAsync()
      }}
    >
      <TextField id={`e-title-${row.sendId}`} label='Title' required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      <TextAreaField id={`e-body-${row.sendId}`} label='Body' rows={3} maxLength={1000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
    </FormDialog>
  )
}

/** What the admin has sent — beside Compose; edit or delete changes every inbox it reached. */
const SentList = ({ channel }: { channel: Channel }) => {
  const { set, query } = useListState()
  const list = usePagedApi<SentNotification>(SENDS, { limit: query.limit, page: query.page, channel })

  const remove = useApiMutation({
    fn: (sendId: string) => api.delete(`${SENDS}/${sendId}`),
    success: 'Notification deleted',
    invalidate: [['paged', SENDS]]
  })

  const columns: Column<SentNotification>[] = [
    { key: 'title', header: 'Notification', cell: n => <span className='block max-w-64'><span className='block truncate font-medium'>{n.title}</span><span className='text-muted-foreground block truncate text-xs'>{n.body ?? ''}</span></span> },
    { key: 'type', header: 'Type', cell: n => <Badge variant='outline'>{n.type}</Badge> },
    { key: 'to', header: 'To', cell: n => (n.userId != null ? `User #${n.userId}` : `${n.players} users`) },
    { key: 'at', header: 'Sent', cell: n => <DateTime value={n.sentAt} relative /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: n => (
        <Can permission='config:write'>
          <span className='flex justify-end'>
            <EditSent row={n} />
            <ConfirmDialog
              trigger={
                <Button size='icon' variant='ghost' aria-label='Delete'>
                  <Trash2Icon />
                </Button>
              }
              title='Delete this notification?'
              description={`“${n.title}” is removed from every inbox it went to.`}
              confirmLabel='Delete'
              destructive
              onConfirm={() => remove.mutateAsync(n.sendId)}
            />
          </span>
        </Can>
      )
    }
  ]

  return (
    <Card className='min-w-0 shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Sent notifications</CardTitle>
        <CardDescription>Everything sent to {channel === 'agent' ? 'agent' : 'direct'} users, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={n => n.sendId}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={page => set({ page })}
          onLimitChange={limit => set({ limit })}
          dense
          emptyMessage='Nothing sent yet.'
        />
      </CardContent>
    </Card>
  )
}

/** Devices list — Direct Users | Agent Users tab (`channel`). */
const Devices = ({ channel }: { channel: Channel }) => {
  const { state, set, query } = useListState(['userId'])
  const [activeOnly, setActiveOnly] = useState(true)

  const list = usePagedApi<Device>('admin/notifications/devices', {
    limit: query.limit,
    page: query.page,
    activeOnly,
    channel,
    userId: query.userId || undefined
  })

  const columns: Column<Device>[] = [
    { key: 'user', header: 'User', cell: d => <span>{d.name ?? `#${d.userId}`}<span className='text-muted-foreground block text-xs'>{d.email ?? d.userId}</span></span> },
    { key: 'platform', header: 'Platform', cell: d => <Badge variant='outline'>{d.platform ?? 'unknown'}</Badge> },
    { key: 'active', header: 'Status', cell: d => <StatusBadge value={d.active ? 'active' : 'inactive'} /> },
    { key: 'token', header: 'Token', cell: d => <span className='text-muted-foreground font-mono text-xs'>{d.token?.slice(0, 16)}…</span> },
    { key: 'at', header: 'Registered', cell: d => <DateTime value={d.registeredAt} relative /> }
  ]

  return (
    <DataTable
      columns={columns}
      rows={list.data?.rows}
      rowKey={d => d.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      dense
      emptyMessage='No device has registered for push yet.'
      toolbar={
        <>
          <Input placeholder='User id' className='w-32' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value.replace(/\D/g, '') })} />
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} /> Active only
          </label>
        </>
      }
    />
  )
}

const History = () => {
  const [userId, setUserId] = useState('')
  const { set, query } = useListState()
  const list = usePagedApi<NotificationRow>(/^\d+$/.test(userId) ? `admin/notifications/history/${userId}` : null, { limit: query.limit, page: query.page })

  const columns: Column<NotificationRow>[] = [
    { key: 'title', header: 'Notification', cell: n => <span className='block max-w-96'><span className='block truncate font-medium'>{n.title}</span><span className='text-muted-foreground block truncate text-xs'>{n.body ?? ''}</span></span> },
    { key: 'type', header: 'Type', cell: n => <Badge variant='outline'>{n.type}</Badge> },
    { key: 'read', header: 'Read', cell: n => <StatusBadge value={n.read ? 'completed' : 'pending'} /> },
    { key: 'at', header: 'Sent', cell: n => <DateTime value={n.createdAt} relative /> }
  ]

  return (
    <div className='grid gap-4'>
      <div className='flex items-center gap-2'>
        <Input placeholder='User id' className='w-48' value={userId} onChange={e => setUserId(e.target.value.replace(/\D/g, ''))} />
        <span className='text-muted-foreground text-sm'>Enter a user id to see everything sent to them.</span>
      </div>
      {/^\d+$/.test(userId) && (
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          rowKey={n => n.id}
          loading={list.isLoading}
          error={list.error}
          pagination={list.data?.pagination}
          onPageChange={page => set({ page })}
          onLimitChange={limit => set({ limit })}
          dense
        />
      )}
    </div>
  )
}

/**
 * Two grants meet here: sending is config:write, the device list and a user's history are
 * users:read (`admin/notifications/devices|history`). Each tab shows only for the grant it needs.
 */
const Notifications = () => {
  const { can } = useSession()
  const canSend = can('config:write')
  const canRead = can('users:read')

  return (
    <div>
      <PageHeader title='Notifications' description='Push messages to users’ devices, the devices registered for them, and what a given user has already been sent.' />
      <Tabs defaultValue={canSend ? 'compose' : 'devices'}>
        <TabsList className='mb-4'>
          {canSend && <TabsTrigger value='compose'>Compose</TabsTrigger>}
          {canRead && <TabsTrigger value='devices'>Devices</TabsTrigger>}
          {canRead && <TabsTrigger value='history'>User history</TabsTrigger>}
        </TabsList>
        {canSend && (
          <TabsContent value='compose'>
            <ChannelTabs>
              {channel => (
                <div className='grid items-start gap-4 xl:grid-cols-2'>
                  <Compose channel={channel} />
                  {canRead && <SentList channel={channel} />}
                </div>
              )}
            </ChannelTabs>
          </TabsContent>
        )}
        {canRead && (
          <TabsContent value='devices'>
            <ChannelTabs>{channel => <Devices channel={channel} />}</ChannelTabs>
          </TabsContent>
        )}
        {canRead && (
          <TabsContent value='history'>
            <History />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

export default Notifications
